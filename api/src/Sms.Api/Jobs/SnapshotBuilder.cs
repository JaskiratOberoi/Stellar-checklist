using Dapper;
using Npgsql;
using Sms.Api.Data;

namespace Sms.Api.Jobs;

/// <summary>
/// Builds period_snapshot rows (week / month) per bu_item. Idempotent: rows
/// are upserted unless the snapshot is locked. consumed_qty is written here and
/// read only by super_admin-guarded code.
/// </summary>
public sealed class SnapshotBuilder(Db db, ILogger<SnapshotBuilder> log)
{
    private const string Sql = """
        WITH p AS (SELECT @start::date AS s, @end::date AS e, @buId::uuid AS bu, LEAST(@end::date, @today::date) AS upto),
        items AS (SELECT bi.id FROM bu_item bi, p WHERE bi.bu_id = p.bu),
        open_cnt AS (
          SELECT l.bu_item_id, SUM(l.qty) AS qty, c.submitted_at
          FROM stock_count_line l JOIN stock_count c ON c.id = l.count_id, p
          WHERE c.bu_id = p.bu AND c.count_date = p.s AND c.session = 'opening' AND c.status IN ('submitted','locked')
          GROUP BY l.bu_item_id, c.submitted_at),
        prev AS (
          SELECT DISTINCT ON (l.bu_item_id) l.bu_item_id, SUM(l.qty) OVER (PARTITION BY l.count_id, l.bu_item_id) AS qty, c.submitted_at
          FROM stock_count_line l JOIN stock_count c ON c.id = l.count_id, p
          WHERE c.bu_id = p.bu AND c.count_date < p.s AND c.status IN ('submitted','locked')
          ORDER BY l.bu_item_id, c.count_date DESC, (c.session = 'closing') DESC, c.submitted_at DESC),
        close_cnt AS (
          SELECT DISTINCT ON (l.bu_item_id) l.bu_item_id, SUM(l.qty) OVER (PARTITION BY l.count_id, l.bu_item_id) AS qty, c.submitted_at
          FROM stock_count_line l JOIN stock_count c ON c.id = l.count_id, p
          WHERE c.bu_id = p.bu AND c.count_date BETWEEN p.s AND p.e AND c.session = 'closing' AND c.status IN ('submitted','locked')
          ORDER BY l.bu_item_id, c.count_date DESC, c.submitted_at DESC),
        days AS (
          SELECT count(*) AS n FROM (
            SELECT count_date FROM stock_count c, p
            WHERE c.bu_id = p.bu AND c.count_date BETWEEN p.s AND p.e AND c.status IN ('submitted','locked')
            GROUP BY count_date HAVING count(DISTINCT session) = 2) d)
        SELECT i.id AS bu_item_id,
               COALESCE(oc.qty, prev.qty + COALESCE((SELECT SUM(qty_delta) FROM stock_movement m
                                                     WHERE m.bu_item_id = i.id AND m.occurred_on < p.s
                                                       AND (prev.submitted_at IS NULL OR m.occurred_at > prev.submitted_at)), 0)) AS opening_qty,
               COALESCE(mv.received, 0) AS received_qty,
               COALESCE(mv.wastage, 0) AS wastage_qty,
               COALESCE(mv.transfer_net, 0) AS transfer_qty,
               COALESCE(mv.adjustment, 0) AS adjustment_qty,
               cc.qty AS closing_qty,
               (SELECT n FROM days) AS count_days,
               GREATEST((p.upto - p.s + 1) - (SELECT n FROM days), 0) AS missing_days
        FROM items i CROSS JOIN p
        LEFT JOIN open_cnt oc ON oc.bu_item_id = i.id
        LEFT JOIN prev ON prev.bu_item_id = i.id
        LEFT JOIN close_cnt cc ON cc.bu_item_id = i.id
        -- Movements between the opening figure's timestamp and the closing count, same rule as v_daily_consumption.
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(qty_delta) FILTER (WHERE movement_type = 'receipt'), 0) AS received,
                 COALESCE(SUM(qty_delta) FILTER (WHERE movement_type IN ('wastage','expiry_writeoff')), 0) AS wastage,
                 COALESCE(SUM(qty_delta) FILTER (WHERE movement_type IN ('transfer_in','transfer_out')), 0) AS transfer_net,
                 COALESCE(SUM(qty_delta) FILTER (WHERE movement_type IN ('adjustment','return_to_supplier')), 0) AS adjustment
          FROM stock_movement m
          WHERE m.bu_item_id = i.id AND m.occurred_on BETWEEN p.s AND p.e
            AND (COALESCE(oc.submitted_at, prev.submitted_at) IS NULL OR m.occurred_at > COALESCE(oc.submitted_at, prev.submitted_at))
            AND (cc.submitted_at IS NULL OR m.occurred_at <= cc.submitted_at)
        ) mv ON true
        """;

    public async Task<int> BuildAsync(Guid buId, string periodType, DateOnly anyDateInPeriod, CancellationToken ct = default)
    {
        var (start, end) = Periods.Range(periodType, anyDateInPeriod);
        await using var conn = await db.Open(ct);
        var tz = await conn.ExecuteScalarAsync<string>("SELECT timezone FROM business_unit WHERE id = @buId", new { buId }) ?? "Asia/Kolkata";
        var today = Periods.TodayIn(tz);
        var rows = await conn.QueryAsync<SnapshotRow>(Sql, new { start, end, buId, today });

        var n = 0;
        await using var tx = await conn.BeginTransactionAsync(ct);
        foreach (var r in rows)
        {
            decimal? consumed = r.OpeningQty is null || r.ClosingQty is null ? null
                : r.OpeningQty + r.ReceivedQty + r.WastageQty + r.TransferQty + r.AdjustmentQty - r.ClosingQty;
            n += await conn.ExecuteAsync("""
                INSERT INTO period_snapshot(bu_item_id, period_type, period_start, period_end, opening_qty, received_qty, wastage_qty, transfer_qty, adjustment_qty, closing_qty, consumed_qty, count_days, missing_days, computed_at)
                VALUES (@BuItemId, @periodType::period_type, @start, @end, @OpeningQty, @ReceivedQty, @WastageQty, @TransferQty, @AdjustmentQty, @ClosingQty, @consumed, @CountDays, @MissingDays, now())
                ON CONFLICT (bu_item_id, period_type, period_start) DO UPDATE SET
                  opening_qty = EXCLUDED.opening_qty, received_qty = EXCLUDED.received_qty, wastage_qty = EXCLUDED.wastage_qty, transfer_qty = EXCLUDED.transfer_qty,
                  adjustment_qty = EXCLUDED.adjustment_qty, closing_qty = EXCLUDED.closing_qty, consumed_qty = EXCLUDED.consumed_qty,
                  count_days = EXCLUDED.count_days, missing_days = EXCLUDED.missing_days, computed_at = now()
                WHERE NOT period_snapshot.is_locked
                """, new { r.BuItemId, periodType, start, end, r.OpeningQty, r.ReceivedQty, r.WastageQty, r.TransferQty, r.AdjustmentQty, r.ClosingQty, consumed, r.CountDays, r.MissingDays }, tx);
        }
        await tx.CommitAsync(ct);
        return n;
    }

    /// <summary>Current and previous week and month for every active BU.</summary>
    public async Task RunAllAsync(CancellationToken ct)
    {
        await using var conn = await db.Open(ct);
        var runId = await conn.ExecuteScalarAsync<long>("INSERT INTO job_run(job_name) VALUES ('snapshots') RETURNING id");
        try
        {
            var bus = (await conn.QueryAsync<(Guid id, string timezone)>("SELECT id, timezone FROM business_unit WHERE is_active")).ToList();
            var total = 0;
            foreach (var (id, tz) in bus)
            {
                var today = Periods.TodayIn(tz);
                total += await BuildAsync(id, "week", today, ct);
                total += await BuildAsync(id, "week", today.AddDays(-7), ct);
                total += await BuildAsync(id, "month", today, ct);
                total += await BuildAsync(id, "month", today.AddMonths(-1), ct);
            }
            await conn.ExecuteAsync("UPDATE job_run SET finished_at = now(), status = 'ok', message = @m WHERE id = @runId", new { runId, m = $"{bus.Count} BUs, {total} snapshot rows" });
            log.LogInformation("Snapshots built for {Count} BUs ({Rows} rows)", bus.Count, total);
        }
        catch (Exception ex)
        {
            await conn.ExecuteAsync("UPDATE job_run SET finished_at = now(), status = 'failed', message = @m WHERE id = @runId", new { runId, m = ex.Message });
            log.LogError(ex, "Snapshot job failed");
        }
    }

    private sealed class SnapshotRow
    {
        public Guid BuItemId { get; set; }
        public decimal? OpeningQty { get; set; }
        public decimal ReceivedQty { get; set; }
        public decimal WastageQty { get; set; }
        public decimal TransferQty { get; set; }
        public decimal AdjustmentQty { get; set; }
        public decimal? ClosingQty { get; set; }
        public int CountDays { get; set; }
        public int MissingDays { get; set; }
    }
}

/// <summary>Runs the snapshot builder once a day at SMS_SNAPSHOT_JOB_TIME (default timezone), and once shortly after start.</summary>
public sealed class SnapshotJob(SnapshotBuilder builder, SmsOptions options, ILogger<SnapshotJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), ct); await builder.RunAllAsync(ct); } catch (OperationCanceledException) { return; }
        var at = TimeOnly.TryParse(options.SnapshotJobTime, out var t) ? t : new TimeOnly(0, 30);
        while (!ct.IsCancellationRequested)
        {
            var now = Periods.NowIn(options.DefaultTimezone);
            var next = now.Date.Add(at.ToTimeSpan());
            if (next <= now) next = next.AddDays(1);
            log.LogInformation("Next snapshot run at {Next} ({Tz})", next, options.DefaultTimezone);
            try { await Task.Delay(next - now, ct); } catch (OperationCanceledException) { return; }
            await builder.RunAllAsync(ct);
        }
    }
}
