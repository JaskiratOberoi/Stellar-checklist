using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;
using Sms.Api.Jobs;

namespace Sms.Api.Endpoints;

/// <summary>
/// Period snapshots for BU roles (opening / closing, never consumption) and
/// super_admin period locks.
/// </summary>
public static class SnapshotEndpoints
{
    public sealed class SnapshotRow
    {
        public Guid Id { get; set; }
        public Guid BuItemId { get; set; }
        public Guid BuId { get; set; }
        public string BuCode { get; set; } = "";
        public string ItemCode { get; set; } = "";
        public string ItemName { get; set; } = "";
        public string Kind { get; set; } = "";
        public string BaseUom { get; set; } = "";
        public string? InstrumentLabel { get; set; }
        public string PeriodType { get; set; } = "";
        public DateOnly PeriodStart { get; set; }
        public DateOnly PeriodEnd { get; set; }
        public decimal? OpeningQty { get; set; }
        public decimal ReceivedQty { get; set; }
        public decimal WastageQty { get; set; }
        public decimal TransferQty { get; set; }
        public decimal AdjustmentQty { get; set; }
        public decimal? ClosingQty { get; set; }
        public int CountDays { get; set; }
        public int MissingDays { get; set; }
        public bool IsLocked { get; set; }
        public DateTime ComputedAt { get; set; }
    }

    public sealed record LockRequest(Guid BuId, string PeriodType, DateOnly PeriodStart, string? Reason);

    /// <summary>No consumed_qty here on purpose.</summary>
    public const string Select = """
        SELECT s.id, s.bu_item_id, bi.bu_id, b.code AS bu_code, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom,
               COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
               s.period_type::text AS period_type, s.period_start, s.period_end, s.opening_qty, s.received_qty, s.wastage_qty, s.transfer_qty, s.adjustment_qty,
               s.closing_qty, s.count_days, s.missing_days, s.is_locked, s.computed_at
        FROM period_snapshot s
        JOIN bu_item bi ON bi.id = s.bu_item_id
        JOIN business_unit b ON b.id = bi.bu_id
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
        """;

    public const string Order = " ORDER BY bi.instrument_id IS NULL, m.manufacturer, m.model_name, ins.serial_no, i.kind, i.name";

    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/bus/{buId:guid}/snapshots", async (Guid buId, HttpContext http, Db db, SnapshotBuilder builder, string? period_type, DateOnly? period_start, bool? rebuild) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var type = period_type ?? "month";
            var tz = await conn.ExecuteScalarAsync<string>("SELECT timezone FROM business_unit WHERE id = @buId", new { buId }) ?? "Asia/Kolkata";
            var (start, end) = Periods.Range(type, period_start ?? Periods.TodayIn(tz));
            if (rebuild == true || !await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM period_snapshot s JOIN bu_item bi ON bi.id = s.bu_item_id WHERE bi.bu_id = @buId AND s.period_type = @type::period_type AND s.period_start = @start)", new { buId, type, start }))
                await builder.BuildAsync(buId, type, start);
            var rows = await conn.QueryAsync<SnapshotRow>(Select + " WHERE bi.bu_id = @buId AND s.period_type = @type::period_type AND s.period_start = @start" + Order, new { buId, type, start });
            var locked = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM period_lock WHERE bu_id = @buId AND period_type = @type::period_type AND period_start = @start AND unlocked_at IS NULL)", new { buId, type, start });
            return Results.Ok(new { period_type = type, period_start = start, period_end = end, is_locked = locked, items = rows });
        }).RequireAuthorization(Policies.User);

        var periods = api.MapGroup("/periods").RequireAuthorization(Policies.SuperAdmin);

        periods.MapGet("", async (Db db, Guid? bu_id) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync("""
                SELECT p.id, p.bu_id, b.code AS bu_code, p.period_type::text AS period_type, p.period_start, p.period_end, lu.full_name AS locked_by, p.locked_at, uu.full_name AS unlocked_by, p.unlocked_at, p.reason
                FROM period_lock p JOIN business_unit b ON b.id = p.bu_id LEFT JOIN app_user lu ON lu.id = p.locked_by LEFT JOIN app_user uu ON uu.id = p.unlocked_by
                WHERE (@bu IS NULL OR p.bu_id = @bu) ORDER BY p.period_start DESC, b.code
                """, new { bu = bu_id }));
        });

        periods.MapPost("/lock", async (LockRequest req, HttpContext http, Db db, SnapshotBuilder builder) =>
        {
            var me = Current.From(http.User);
            var (start, end) = Periods.Range(req.PeriodType, req.PeriodStart);
            await using var conn = await db.Open();
            var tz = await conn.ExecuteScalarAsync<string>("SELECT timezone FROM business_unit WHERE id = @id", new { id = req.BuId }) ?? throw ApiException.NotFound("Business unit");
            if (end >= Periods.TodayIn(tz)) throw ApiException.Validation("A period can only be locked after it has ended");
            await builder.BuildAsync(req.BuId, req.PeriodType, start);
            await using var tx = await conn.BeginTransactionAsync();
            await conn.ExecuteAsync("""
                INSERT INTO period_lock(bu_id, period_type, period_start, period_end, locked_by, reason) VALUES (@bu, @type::period_type, @start, @end, @uid, @reason)
                ON CONFLICT (bu_id, period_type, period_start) DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_at = now(), unlocked_by = NULL, unlocked_at = NULL, reason = EXCLUDED.reason
                """, new { bu = req.BuId, type = req.PeriodType, start, end, uid = me.UserId, req.Reason }, tx);
            await conn.ExecuteAsync("UPDATE period_snapshot s SET is_locked = true, locked_by = @uid, locked_at = now() FROM bu_item bi WHERE bi.id = s.bu_item_id AND bi.bu_id = @bu AND s.period_type = @type::period_type AND s.period_start = @start",
                new { bu = req.BuId, type = req.PeriodType, start, uid = me.UserId }, tx);
            await conn.ExecuteAsync("UPDATE stock_count SET status = 'locked', locked_at = now() WHERE bu_id = @bu AND status = 'submitted' AND count_date BETWEEN @start AND @end", new { bu = req.BuId, start, end }, tx);
            await Audit.Write(conn, tx, me, "period.lock", "period_lock", $"{req.BuId}:{req.PeriodType}:{start:yyyy-MM-dd}", req.BuId, null, new { req.PeriodType, start, end, req.Reason }, http);
            await tx.CommitAsync();
            return Results.Ok(new { locked = true, period_type = req.PeriodType, period_start = start, period_end = end });
        });

        periods.MapPost("/unlock", async (LockRequest req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            if (string.IsNullOrWhiteSpace(req.Reason)) throw ApiException.Validation("A reason is required to unlock a period");
            var (start, end) = Periods.Range(req.PeriodType, req.PeriodStart);
            await using var conn = await db.Open();
            await using var tx = await conn.BeginTransactionAsync();
            var n = await conn.ExecuteAsync("UPDATE period_lock SET unlocked_by = @uid, unlocked_at = now(), reason = @reason WHERE bu_id = @bu AND period_type = @type::period_type AND period_start = @start AND unlocked_at IS NULL",
                new { bu = req.BuId, type = req.PeriodType, start, uid = me.UserId, req.Reason }, tx);
            if (n == 0) throw ApiException.NotFound("Active period lock");
            await conn.ExecuteAsync("UPDATE period_snapshot s SET is_locked = false FROM bu_item bi WHERE bi.id = s.bu_item_id AND bi.bu_id = @bu AND s.period_type = @type::period_type AND s.period_start = @start",
                new { bu = req.BuId, type = req.PeriodType, start }, tx);
            // Counts return to submitted only if no other active lock still covers them.
            await conn.ExecuteAsync("""
                UPDATE stock_count c SET status = 'submitted', locked_at = NULL WHERE c.bu_id = @bu AND c.status = 'locked' AND c.count_date BETWEEN @start AND @end
                  AND NOT EXISTS (SELECT 1 FROM period_lock p WHERE p.bu_id = c.bu_id AND p.unlocked_at IS NULL AND c.count_date BETWEEN p.period_start AND p.period_end)
                """, new { bu = req.BuId, start, end }, tx);
            await Audit.Write(conn, tx, me, "period.unlock", "period_lock", $"{req.BuId}:{req.PeriodType}:{start:yyyy-MM-dd}", req.BuId, null, new { req.PeriodType, start, end, req.Reason }, http);
            await tx.CommitAsync();
            return Results.Ok(new { locked = false, period_type = req.PeriodType, period_start = start, period_end = end });
        });
    }
}
