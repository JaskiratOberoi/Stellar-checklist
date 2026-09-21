using System.Text;
using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;
using Sms.Api.Jobs;

namespace Sms.Api.Endpoints;

/// <summary>
/// The only place consumption leaves the database for a human. Every route
/// here requires super_admin; the policy is applied at the group level so a
/// forgotten attribute cannot widen access.
/// </summary>
public static class ReportEndpoints
{
    private const string DailyBase = """
         FROM v_daily_consumption d
        JOIN bu_item bi ON bi.id = d.bu_item_id
        JOIN business_unit b ON b.id = d.bu_id
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
        WHERE d.count_date BETWEEN @from AND @to
          AND (@bu IS NULL OR d.bu_id = @bu) AND (@item IS NULL OR bi.item_id = @item)
          AND (@kind IS NULL OR i.kind::text = @kind) AND (@instrument IS NULL OR bi.instrument_id = @instrument)
        """;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/reports").RequireAuthorization(Policies.SuperAdmin);

        g.MapGet("/consumption", async (Db db, string? group_by, DateOnly? from, DateOnly? to, Guid? bu_id, Guid? item_id, string? kind, Guid? instrument_id) =>
        {
            var (f, t) = Window(from, to);
            var groupSql = (group_by ?? "bu") switch
            {
                "bu" => "SELECT b.id AS key_id, b.code AS key_code, b.name AS key_name, NULL::text AS base_uom, ",
                "instrument" => "SELECT ins.id AS key_id, ins.serial_no AS key_code, COALESCE(ins.label, m.manufacturer || ' ' || m.model_name || ' · ' || ins.serial_no) AS key_name, NULL::text AS base_uom, ",
                "item" => "SELECT i.id AS key_id, i.code AS key_code, i.name AS key_name, i.base_uom, ",
                "bu_item" => "SELECT bi.id AS key_id, i.code || ' @ ' || b.code AS key_code, i.name || ' · ' || b.code || COALESCE(' · ' || ins.serial_no, '') AS key_name, i.base_uom, ",
                _ => throw ApiException.Validation("group_by must be bu, instrument, item or bu_item"),
            };
            var groupBy = (group_by ?? "bu") switch
            {
                "bu" => "b.id, b.code, b.name",
                "instrument" => "ins.id, ins.serial_no, ins.label, m.manufacturer, m.model_name",
                "item" => "i.id, i.code, i.name, i.base_uom",
                _ => "bi.id, i.code, i.name, i.base_uom, b.code, ins.serial_no",
            };
            await using var conn = await db.Open();
            var groups = await conn.QueryAsync(groupSql + """
                       SUM(d.consumed_qty) AS consumed_qty, SUM(d.received_qty) AS received_qty, SUM(d.wastage_qty) AS wastage_qty,
                       count(DISTINCT d.count_date) AS days, count(DISTINCT d.bu_item_id) AS items
                """ + DailyBase + $" GROUP BY {groupBy} ORDER BY consumed_qty DESC NULLS LAST",
                new { from = f, to = t, bu = bu_id, item = item_id, kind, instrument = instrument_id });
            var series = await conn.QueryAsync("SELECT d.count_date, SUM(d.consumed_qty) AS consumed_qty, SUM(d.received_qty) AS received_qty, SUM(d.wastage_qty) AS wastage_qty " + DailyBase + " GROUP BY d.count_date ORDER BY d.count_date",
                new { from = f, to = t, bu = bu_id, item = item_id, kind, instrument = instrument_id });
            return Results.Ok(new { from = f, to = t, group_by = group_by ?? "bu", groups, series });
        });

        g.MapGet("/consumption/daily", async (Db db, DateOnly? from, DateOnly? to, Guid? bu_id, Guid? item_id, string? kind, Guid? instrument_id, Guid? bu_item_id) =>
        {
            var (f, t) = Window(from, to);
            await using var conn = await db.Open();
            var rows = await conn.QueryAsync("""
                SELECT d.count_date, d.bu_id, b.code AS bu_code, d.bu_item_id, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom,
                       COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
                       d.opening_qty, d.received_qty, d.wastage_qty, d.transfer_qty, d.adjustment_qty, d.closing_qty, d.consumed_qty
                """ + DailyBase + " AND (@buItem IS NULL OR d.bu_item_id = @buItem) ORDER BY d.count_date DESC, b.code, i.name",
                new { from = f, to = t, bu = bu_id, item = item_id, kind, instrument = instrument_id, buItem = bu_item_id });
            return Results.Ok(rows);
        });

        g.MapGet("/consumption/export.csv", async (Db db, DateOnly? from, DateOnly? to, Guid? bu_id, Guid? item_id, string? kind, Guid? instrument_id) =>
        {
            var (f, t) = Window(from, to);
            await using var conn = await db.Open();
            var rows = await conn.QueryAsync("""
                SELECT d.count_date, b.code AS bu_code, b.name AS bu_name, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom,
                       COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label, ins.serial_no,
                       d.opening_qty, d.received_qty, d.wastage_qty, d.transfer_qty, d.adjustment_qty, d.closing_qty, d.consumed_qty
                """ + DailyBase + " ORDER BY d.count_date, b.code, i.name",
                new { from = f, to = t, bu = bu_id, item = item_id, kind, instrument = instrument_id });
            var sb = new StringBuilder("date,bu_code,bu_name,item_code,item_name,kind,uom,instrument,serial_no,opening,received,wastage,transfer,adjustment,closing,consumed\n");
            foreach (var r in rows)
            {
                var d = (IDictionary<string, object>)r;
                sb.AppendJoin(',', new object?[] { d["count_date"], d["bu_code"], d["bu_name"], d["item_code"], d["item_name"], d["kind"], d["base_uom"], d["instrument_label"], d["serial_no"],
                    d["opening_qty"], d["received_qty"], d["wastage_qty"], d["transfer_qty"], d["adjustment_qty"], d["closing_qty"], d["consumed_qty"] }.Select(Csv)).Append('\n');
            }
            return Results.File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv", $"consumption_{f:yyyyMMdd}_{t:yyyyMMdd}.csv");
        });

        g.MapGet("/snapshots", async (Db db, SnapshotBuilder builder, SmsOptions opt, string? period_type, DateOnly? period_start, Guid? bu_id, bool? rebuild) =>
        {
            var type = period_type ?? "month";
            var (start, end) = Periods.Range(type, period_start ?? Periods.TodayIn(opt.DefaultTimezone));
            await using var conn = await db.Open();
            var bus = (await conn.QueryAsync<Guid>("SELECT id FROM business_unit WHERE is_active AND (@bu IS NULL OR id = @bu)", new { bu = bu_id })).ToList();
            foreach (var b in bus)
            {
                var has = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM period_snapshot s JOIN bu_item bi ON bi.id = s.bu_item_id WHERE bi.bu_id = @b AND s.period_type = @type::period_type AND s.period_start = @start)", new { b, type, start });
                if (rebuild == true || !has) await builder.BuildAsync(b, type, start);
            }
            var rows = await conn.QueryAsync("""
                SELECT s.id, s.bu_item_id, bi.bu_id, b.code AS bu_code, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom,
                       COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
                       s.period_type::text AS period_type, s.period_start, s.period_end, s.opening_qty, s.received_qty, s.wastage_qty, s.transfer_qty, s.adjustment_qty,
                       s.closing_qty, s.consumed_qty, s.count_days, s.missing_days, s.is_locked, s.computed_at
                FROM period_snapshot s JOIN bu_item bi ON bi.id = s.bu_item_id JOIN business_unit b ON b.id = bi.bu_id JOIN item i ON i.id = bi.item_id
                LEFT JOIN instrument ins ON ins.id = bi.instrument_id LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
                WHERE s.period_type = @type::period_type AND s.period_start = @start AND (@bu IS NULL OR bi.bu_id = @bu)
                ORDER BY b.code, bi.instrument_id IS NULL, m.manufacturer, m.model_name, ins.serial_no, i.kind, i.name
                """, new { type, start, bu = bu_id });
            var locks = await conn.QueryAsync<Guid>("SELECT bu_id FROM period_lock WHERE period_type = @type::period_type AND period_start = @start AND unlocked_at IS NULL", new { type, start });
            return Results.Ok(new { period_type = type, period_start = start, period_end = end, locked_bus = locks, items = rows });
        });

        g.MapGet("/missed-counts", async (Db db, SmsOptions opt, DateOnly? from, DateOnly? to, Guid? bu_id) =>
        {
            var (f, t) = Window(from, to, 30);
            await using var conn = await db.Open();
            var rows = await conn.QueryAsync("""
                WITH days AS (SELECT generate_series(@from::date, LEAST(@to::date, CURRENT_DATE), interval '1 day')::date AS d),
                sessions AS (SELECT unnest(ARRAY['opening','closing']) AS s)
                SELECT b.id AS bu_id, b.code AS bu_code, b.name AS bu_name, days.d AS count_date, sessions.s AS session,
                       c.status::text AS status, u.full_name AS submitted_by, c.submitted_at
                FROM business_unit b CROSS JOIN days CROSS JOIN sessions
                LEFT JOIN stock_count c ON c.bu_id = b.id AND c.count_date = days.d AND c.session::text = sessions.s
                LEFT JOIN app_user u ON u.id = c.submitted_by
                WHERE b.is_active AND (@bu IS NULL OR b.id = @bu) AND days.d >= b.created_at::date
                ORDER BY days.d DESC, b.code, sessions.s
                """, new { from = f, to = t, bu = bu_id });
            return Results.Ok(new { from = f, to = t, cells = rows });
        });

        g.MapGet("/overview", async (Db db, SmsOptions opt) =>
        {
            var today = Periods.TodayIn(opt.DefaultTimezone);
            await using var conn = await db.Open();
            var month = await conn.QueryAsync("""
                SELECT b.id AS bu_id, b.code AS bu_code, b.name AS bu_name,
                       SUM(d.consumed_qty) FILTER (WHERE i.kind = 'reagent') AS reagent_consumed,
                       count(DISTINCT d.count_date) AS counted_days,
                       (SELECT count(*) FROM bu_item bi2 WHERE bi2.bu_id = b.id AND bi2.is_active) AS items,
                       (SELECT count(*) FROM v_current_stock cs WHERE cs.bu_id = b.id AND cs.is_low) AS low_items
                FROM business_unit b
                LEFT JOIN v_daily_consumption d ON d.bu_id = b.id AND d.count_date >= @monthStart
                LEFT JOIN bu_item bi ON bi.id = d.bu_item_id LEFT JOIN item i ON i.id = bi.item_id
                WHERE b.is_active GROUP BY b.id, b.code, b.name ORDER BY b.code
                """, new { monthStart = Periods.MonthStart(today) });
            var top = await conn.QueryAsync("""
                SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.base_uom, SUM(d.consumed_qty) AS consumed_qty
                FROM v_daily_consumption d JOIN bu_item bi ON bi.id = d.bu_item_id JOIN item i ON i.id = bi.item_id
                WHERE d.count_date >= @from GROUP BY i.id, i.code, i.name, i.base_uom ORDER BY consumed_qty DESC NULLS LAST LIMIT 10
                """, new { from = today.AddDays(-30) });
            return Results.Ok(new { month_start = Periods.MonthStart(today), business_units = month, top_items_30d = top });
        });
    }

    private static (DateOnly from, DateOnly to) Window(DateOnly? from, DateOnly? to, int defaultDays = 30)
    {
        var t = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var f = from ?? t.AddDays(-defaultDays);
        if (f > t) throw ApiException.Validation("from must be before to");
        if (t.DayNumber - f.DayNumber > 400) throw ApiException.Validation("Range cannot exceed 400 days");
        return (f, t);
    }

    private static string Csv(object? v)
    {
        if (v is null) return "";
        var s = v is DateOnly d ? d.ToString("yyyy-MM-dd") : v.ToString() ?? "";
        return s.Contains(',') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }
}
