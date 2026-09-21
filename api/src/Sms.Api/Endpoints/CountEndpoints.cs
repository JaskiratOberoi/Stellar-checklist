using Dapper;
using Npgsql;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

/// <summary>
/// Daily opening / closing counts. Counts are facts: what was physically on the
/// shelf. Expected values are prefilled from the last submitted count plus the
/// movement ledger; nothing here derives or exposes consumption.
/// </summary>
public static class CountEndpoints
{
    public sealed class CountHeader
    {
        public Guid Id { get; set; }
        public Guid BuId { get; set; }
        public string BuCode { get; set; } = "";
        public DateOnly CountDate { get; set; }
        public string Session { get; set; } = "";
        public string Status { get; set; } = "";
        public string? Note { get; set; }
        public string? CreatedBy { get; set; }
        public string? SubmittedBy { get; set; }
        public DateTime? SubmittedAt { get; set; }
        public string? ReopenedBy { get; set; }
        public DateTime? ReopenedAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public int LineCount { get; set; }
        public int ConfirmedCount { get; set; }
        public int VarianceCount { get; set; }
    }

    public sealed class CountLine
    {
        public Guid Id { get; set; }
        public Guid BuItemId { get; set; }
        public Guid? LotId { get; set; }
        public string? LotNo { get; set; }
        public DateOnly? ExpiryDate { get; set; }
        public decimal Qty { get; set; }
        public decimal? PacksEntered { get; set; }
        public decimal? LooseEntered { get; set; }
        public decimal? ExpectedQty { get; set; }
        public decimal Variance { get; set; }
        public bool IsConfirmed { get; set; }
        public string? Note { get; set; }
        public string ItemCode { get; set; } = "";
        public string ItemName { get; set; } = "";
        public string Kind { get; set; } = "";
        public string BaseUom { get; set; } = "";
        public decimal PackSize { get; set; }
        public string PackUom { get; set; } = "";
        public bool TracksLot { get; set; }
        public Guid? InstrumentId { get; set; }
        public string? InstrumentLabel { get; set; }
        public string? InstrumentModel { get; set; }
        public bool RequiresNote { get; set; }
    }

    public sealed record CreateCount(DateOnly? CountDate, string Session);
    public sealed record LineWrite(Guid BuItemId, Guid? LotId, decimal? Qty, decimal? Packs, decimal? Loose, string? Note, bool? Confirmed);
    public sealed record ReopenRequest(string? Reason);
    public sealed record SubmitRequest(string? Note);

    public const string HeaderSelect = """
        SELECT c.id, c.bu_id, b.code AS bu_code, c.count_date, c.session::text AS session, c.status::text AS status, c.note,
               cu.full_name AS created_by, su.full_name AS submitted_by, c.submitted_at, ru.full_name AS reopened_by, c.reopened_at, c.created_at, c.updated_at,
               (SELECT count(*) FROM stock_count_line l WHERE l.count_id = c.id) AS line_count,
               (SELECT count(*) FROM stock_count_line l WHERE l.count_id = c.id AND l.is_confirmed) AS confirmed_count,
               (SELECT count(*) FROM stock_count_line l WHERE l.count_id = c.id AND l.expected_qty IS NOT NULL
                  AND ((l.expected_qty = 0 AND l.qty <> 0) OR (l.expected_qty <> 0 AND abs(l.qty - l.expected_qty) / l.expected_qty * 100 > b.variance_tolerance_pct))) AS variance_count
        FROM stock_count c
        JOIN business_unit b ON b.id = c.bu_id
        LEFT JOIN app_user cu ON cu.id = c.created_by
        LEFT JOIN app_user su ON su.id = c.submitted_by
        LEFT JOIN app_user ru ON ru.id = c.reopened_by
        """;

    private const string LineSelect = """
        SELECT l.id, l.bu_item_id, l.lot_id, sl.lot_no, sl.expiry_date, l.qty, l.packs_entered, l.loose_entered, l.expected_qty, l.variance, l.is_confirmed, l.note,
               i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom, i.pack_size, i.pack_uom, i.tracks_lot,
               bi.instrument_id, COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
               CASE WHEN m.id IS NULL THEN NULL ELSE m.manufacturer || ' ' || m.model_name END AS instrument_model,
               (l.expected_qty IS NOT NULL AND ((l.expected_qty = 0 AND l.qty <> 0) OR (l.expected_qty <> 0 AND abs(l.qty - l.expected_qty) / l.expected_qty * 100 > b.variance_tolerance_pct))) AS requires_note
        FROM stock_count_line l
        JOIN stock_count c ON c.id = l.count_id
        JOIN business_unit b ON b.id = c.bu_id
        JOIN bu_item bi ON bi.id = l.bu_item_id
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN stock_lot sl ON sl.id = l.lot_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
        WHERE l.count_id = @countId
        ORDER BY bi.instrument_id IS NULL, m.manufacturer, m.model_name, ins.serial_no, bi.sort_order, i.kind, i.name, sl.expiry_date NULLS LAST, sl.lot_no
        """;

    /// <summary>
    /// One row per thing that should be counted: each active non-lot item, and each
    /// active lot of a lot-tracked item. expected = last submitted count for that
    /// (item, lot) + movements since. Lines of the count being built are excluded.
    /// </summary>
    private const string PrefillSql = """
        WITH last_count AS (
          SELECT DISTINCT ON (l.bu_item_id, l.lot_id) l.bu_item_id, l.lot_id, l.qty, c.submitted_at
          FROM stock_count_line l JOIN stock_count c ON c.id = l.count_id
          WHERE c.bu_id = @buId AND c.status IN ('submitted','locked') AND c.id <> @countId
            AND (c.count_date < @countDate OR (c.count_date = @countDate AND c.session = 'opening' AND @session = 'closing'))
          ORDER BY l.bu_item_id, l.lot_id, c.count_date DESC, (c.session = 'closing') DESC, c.submitted_at DESC
        ),
        targets AS (
          SELECT bi.id AS bu_item_id, NULL::uuid AS lot_id
          FROM bu_item bi JOIN item i ON i.id = bi.item_id
          WHERE bi.bu_id = @buId AND bi.is_active AND i.is_active AND NOT i.tracks_lot
          UNION ALL
          SELECT bi.id, sl.id
          FROM bu_item bi JOIN item i ON i.id = bi.item_id JOIN stock_lot sl ON sl.bu_item_id = bi.id
          WHERE bi.bu_id = @buId AND bi.is_active AND i.is_active AND i.tracks_lot AND sl.status IN ('active','quarantined')
        )
        SELECT t.bu_item_id, t.lot_id,
               COALESCE(lc.qty, 0) + COALESCE((
                 SELECT SUM(m.qty_delta) FROM stock_movement m
                 WHERE m.bu_item_id = t.bu_item_id AND m.lot_id IS NOT DISTINCT FROM t.lot_id
                   AND m.occurred_on <= @countDate
                   AND (lc.submitted_at IS NULL OR m.occurred_at > lc.submitted_at)), 0) AS expected_qty
        FROM targets t
        LEFT JOIN last_count lc ON lc.bu_item_id = t.bu_item_id AND lc.lot_id IS NOT DISTINCT FROM t.lot_id
        """;

    public static void Map(RouteGroupBuilder api)
    {
        var bu = api.MapGroup("/bus/{buId:guid}/counts").RequireAuthorization(Policies.User);
        var one = api.MapGroup("/counts/{countId:guid}").RequireAuthorization(Policies.User);

        bu.MapGet("", async (Guid buId, HttpContext http, Db db, DateOnly? from, DateOnly? to, string? session, string? status, int? limit) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<CountHeader>(HeaderSelect + """
                 WHERE c.bu_id = @buId AND (@from::date IS NULL OR c.count_date >= @from::date) AND (@to::date IS NULL OR c.count_date <= @to::date)
                   AND (@session IS NULL OR c.session::text = @session) AND (@status IS NULL OR c.status::text = @status)
                 ORDER BY c.count_date DESC, c.session DESC LIMIT @limit
                """, new { buId, from, to, session, status, limit = Math.Clamp(limit ?? 60, 1, 500) });
            return Results.Ok(rows);
        });

        bu.MapGet("/today", async (Guid buId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var b = await conn.QuerySingleOrDefaultAsync<BusinessUnitEndpoints.BuRow>(
                "SELECT id, code, name, timezone, opening_due_time, closing_due_time, grace_minutes, variance_tolerance_pct FROM business_unit WHERE id = @buId", new { buId })
                ?? throw ApiException.NotFound("Business unit");
            var now = Periods.NowIn(b.Timezone);
            var today = DateOnly.FromDateTime(now);
            var counts = (await conn.QueryAsync<CountHeader>(HeaderSelect + " WHERE c.bu_id = @buId AND c.count_date = @today", new { buId, today })).ToList();
            var opening = counts.FirstOrDefault(c => c.Session == "opening");
            var closing = counts.FirstOrDefault(c => c.Session == "closing");
            return Results.Ok(new
            {
                date = today,
                local_time = now,
                opening_due_time = b.OpeningDueTime,
                closing_due_time = b.ClosingDueTime,
                grace_minutes = b.GraceMinutes,
                opening,
                closing,
                opening_status = StatusOf(opening, now, b.OpeningDueTime, b.GraceMinutes),
                closing_status = StatusOf(closing, now, b.ClosingDueTime, b.GraceMinutes),
            });
        });

        bu.MapPost("", async (Guid buId, CreateCount req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            if (req.Session is not ("opening" or "closing")) throw ApiException.Validation("session must be opening or closing");
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var tz = await conn.ExecuteScalarAsync<string>("SELECT timezone FROM business_unit WHERE id = @buId", new { buId }) ?? "Asia/Kolkata";
            var date = req.CountDate ?? Periods.TodayIn(tz);
            if (date > Periods.TodayIn(tz)) throw ApiException.Validation("Counts cannot be created for a future date");
            await Periods.EnsureUnlocked(conn, buId, date);

            var existing = await conn.QuerySingleOrDefaultAsync<CountHeader>(HeaderSelect + " WHERE c.bu_id = @buId AND c.count_date = @date AND c.session = @session::count_session", new { buId, date, session = req.Session });
            if (existing is not null)
            {
                if (existing.Status != "draft") throw ApiException.Conflict("already_submitted", $"The {req.Session} count for {date:yyyy-MM-dd} is already {existing.Status}");
                await SyncLines(conn, existing.Id, buId, date, req.Session);
                return Results.Ok(await Load(conn, existing.Id));
            }

            await using var tx = await conn.BeginTransactionAsync();
            var id = await conn.ExecuteScalarAsync<Guid>(
                "INSERT INTO stock_count(bu_id, count_date, session, created_by) VALUES (@buId, @date, @session::count_session, @uid) RETURNING id",
                new { buId, date, session = req.Session, uid = me.UserId }, tx);
            await SyncLines(conn, id, buId, date, req.Session, tx);
            await Audit.Write(conn, tx, me, "count.create", "stock_count", id, buId, null, new { date, req.Session }, http);
            await tx.CommitAsync();
            return Results.Created($"/api/v1/counts/{id}", await Load(conn, id));
        });

        one.MapGet("", async (Guid countId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status == "draft") await SyncLines(conn, countId, h.BuId, h.CountDate, h.Session);
            return Results.Ok(await Load(conn, countId));
        });

        one.MapPut("/lines", async (Guid countId, LineWrite[] writes, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status != "draft") throw ApiException.Conflict("not_draft", "Only draft counts can be edited");
            await using var tx = await conn.BeginTransactionAsync();
            foreach (var w in writes)
            {
                var line = await conn.QuerySingleOrDefaultAsync<(Guid id, decimal pack_size, decimal qty)>(
                    "SELECT l.id, i.pack_size, l.qty FROM stock_count_line l JOIN bu_item bi ON bi.id = l.bu_item_id JOIN item i ON i.id = bi.item_id WHERE l.count_id = @countId AND l.bu_item_id = @bi AND l.lot_id IS NOT DISTINCT FROM @lot",
                    new { countId, bi = w.BuItemId, lot = w.LotId }, tx);
                if (line.id == Guid.Empty) throw ApiException.NotFound($"Count line for bu_item {w.BuItemId}");
                decimal? qty = w.Qty;
                if (qty is null && (w.Packs is not null || w.Loose is not null))
                    qty = (w.Packs ?? 0) * line.pack_size + (w.Loose ?? 0);
                if (qty is < 0) throw ApiException.Validation("Quantity cannot be negative");
                var confirmed = w.Confirmed ?? (qty is not null);
                await conn.ExecuteAsync("""
                    UPDATE stock_count_line SET qty = COALESCE(@qty, qty), packs_entered = COALESCE(@packs, packs_entered), loose_entered = COALESCE(@loose, loose_entered),
                      note = COALESCE(@note, note), is_confirmed = @confirmed OR is_confirmed, updated_by = @uid, updated_at = now()
                    WHERE id = @id
                    """, new { id = line.id, qty, packs = w.Packs, loose = w.Loose, note = w.Note, confirmed, uid = me.UserId }, tx);
            }
            await conn.ExecuteAsync("UPDATE stock_count SET updated_at = now() WHERE id = @countId", new { countId }, tx);
            await tx.CommitAsync();
            return Results.Ok(await Load(conn, countId));
        });

        one.MapPost("/confirm-remaining", async (Guid countId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status != "draft") throw ApiException.Conflict("not_draft", "Only draft counts can be edited");
            await conn.ExecuteAsync("UPDATE stock_count_line SET is_confirmed = true, updated_by = @uid, updated_at = now() WHERE count_id = @countId AND NOT is_confirmed", new { countId, uid = me.UserId });
            return Results.Ok(await Load(conn, countId));
        });

        one.MapPost("/submit", async (Guid countId, SubmitRequest? req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status != "draft") throw ApiException.Conflict("already_submitted", "This count has already been submitted");
            await Periods.EnsureUnlocked(conn, h.BuId, h.CountDate);
            await SyncLines(conn, countId, h.BuId, h.CountDate, h.Session);

            var lines = (await conn.QueryAsync<CountLine>(LineSelect, new { countId })).ToList();
            var unconfirmed = lines.Where(l => !l.IsConfirmed).Select(l => new { l.BuItemId, l.LotId, l.ItemName, l.LotNo }).ToList();
            if (unconfirmed.Count > 0) throw ApiException.Validation($"{unconfirmed.Count} line(s) not confirmed", new { unconfirmed });
            var missingNotes = lines.Where(l => l.RequiresNote && string.IsNullOrWhiteSpace(l.Note)).Select(l => new { l.BuItemId, l.LotId, l.ItemName, l.LotNo, l.Qty, l.ExpectedQty }).ToList();
            if (missingNotes.Count > 0) throw ApiException.Validation($"{missingNotes.Count} line(s) differ from the expected quantity and need a note", new { missing_notes = missingNotes });

            await using var tx = await conn.BeginTransactionAsync();
            await conn.ExecuteAsync("UPDATE stock_count SET status = 'submitted', submitted_by = @uid, submitted_at = now(), note = COALESCE(@note, note) WHERE id = @countId",
                new { countId, uid = me.UserId, note = req?.Note }, tx);
            if (h.Session == "closing")
            {
                // A lot counted at zero on a closing count is finished.
                await conn.ExecuteAsync("UPDATE stock_lot SET status = 'exhausted' WHERE status = 'active' AND id IN (SELECT lot_id FROM stock_count_line WHERE count_id = @countId AND lot_id IS NOT NULL AND qty = 0)", new { countId }, tx);
            }
            await Audit.Write(conn, tx, me, "count.submit", "stock_count", countId, h.BuId, null, new { h.CountDate, h.Session, lines = lines.Count, variances = lines.Count(l => l.RequiresNote) }, http);
            await tx.CommitAsync();
            return Results.Ok(await Load(conn, countId));
        });

        one.MapPost("/reopen", async (Guid countId, ReopenRequest req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            if (string.IsNullOrWhiteSpace(req.Reason)) throw ApiException.Validation("A reason is required to reopen a count");
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status != "submitted") throw ApiException.Conflict("not_submitted", $"Cannot reopen a {h.Status} count");
            await Periods.EnsureUnlocked(conn, h.BuId, h.CountDate);
            await conn.ExecuteAsync("UPDATE stock_count SET status = 'draft', reopened_by = @uid, reopened_at = now() WHERE id = @countId", new { countId, uid = me.UserId });
            await Audit.Write(conn, null, me, "count.reopen", "stock_count", countId, h.BuId, new { h.Status, h.SubmittedBy, h.SubmittedAt }, new { req.Reason }, http);
            return Results.Ok(await Load(conn, countId));
        });

        one.MapDelete("", async (Guid countId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            var h = await Header(conn, countId);
            await me.RequireBu(conn, h.BuId);
            if (h.Status != "draft") throw ApiException.Conflict("not_draft", "Only draft counts can be deleted");
            await conn.ExecuteAsync("DELETE FROM stock_count WHERE id = @countId", new { countId });
            await Audit.Write(conn, null, me, "count.delete", "stock_count", countId, h.BuId, h, null, http);
            return Results.NoContent();
        });
    }

    public static string StatusOf(CountHeader? c, DateTime localNow, TimeOnly due, int grace)
    {
        if (c is not null) return c.Status == "draft" ? "draft" : "submitted";
        var deadline = due.ToTimeSpan() + TimeSpan.FromMinutes(grace);
        return localNow.TimeOfDay > deadline ? "missed" : "pending";
    }

    public static async Task<CountHeader> Header(NpgsqlConnection conn, Guid countId)
        => await conn.QuerySingleOrDefaultAsync<CountHeader>(HeaderSelect + " WHERE c.id = @countId", new { countId }) ?? throw ApiException.NotFound("Count");

    public static async Task<object> Load(NpgsqlConnection conn, Guid countId)
    {
        var header = await Header(conn, countId);
        var lines = await conn.QueryAsync<CountLine>(LineSelect, new { countId });
        var tolerance = await conn.ExecuteScalarAsync<decimal>("SELECT variance_tolerance_pct FROM business_unit WHERE id = @id", new { id = header.BuId });
        // Lot-tracked items with no lot on record cannot be counted until a lot exists; the sheet shows them so the
        // tech can book the opening stock (a receipt) right there instead of the item silently going uncounted.
        var uncounted = header.Status == "draft"
            ? await conn.QueryAsync<BuItemEndpoints.BuItemRow>(BuItemEndpoints.Select + """
                 WHERE bi.bu_id = @buId AND bi.is_active AND i.is_active AND i.tracks_lot
                   AND NOT EXISTS (SELECT 1 FROM stock_lot sl WHERE sl.bu_item_id = bi.id AND sl.status IN ('active','quarantined'))
                """ + BuItemEndpoints.Order, new { buId = header.BuId })
            : [];
        return new { header, lines, variance_tolerance_pct = tolerance, uncounted_lot_items = uncounted };
    }

    /// <summary>
    /// Brings a draft's lines in step with what should be counted now: adds lines
    /// for items/lots that appeared since the draft was created, removes
    /// unconfirmed lines whose target vanished, refreshes expected_qty on lines
    /// the tech has not touched yet.
    /// </summary>
    public static async Task SyncLines(NpgsqlConnection conn, Guid countId, Guid buId, DateOnly date, string session, NpgsqlTransaction? tx = null)
    {
        var targets = (await conn.QueryAsync<(Guid bu_item_id, Guid? lot_id, decimal expected_qty)>(PrefillSql, new { buId, countId, countDate = date, session }, tx)).ToList();
        var existing = (await conn.QueryAsync<(Guid id, Guid bu_item_id, Guid? lot_id, bool is_confirmed)>(
            "SELECT id, bu_item_id, lot_id, is_confirmed FROM stock_count_line WHERE count_id = @countId", new { countId }, tx)).ToList();

        var have = existing.ToDictionary(e => (e.bu_item_id, e.lot_id));
        foreach (var t in targets)
        {
            if (have.TryGetValue((t.bu_item_id, t.lot_id), out var line))
            {
                if (!line.is_confirmed)
                    await conn.ExecuteAsync("UPDATE stock_count_line SET expected_qty = @exp, qty = @exp WHERE id = @id", new { id = line.id, exp = t.expected_qty }, tx);
            }
            else
            {
                await conn.ExecuteAsync("INSERT INTO stock_count_line(count_id, bu_item_id, lot_id, qty, expected_qty) VALUES (@countId, @bi, @lot, @exp, @exp)",
                    new { countId, bi = t.bu_item_id, lot = t.lot_id, exp = t.expected_qty }, tx);
            }
        }
        var want = targets.Select(t => (t.bu_item_id, t.lot_id)).ToHashSet();
        foreach (var e in existing.Where(e => !e.is_confirmed && !want.Contains((e.bu_item_id, e.lot_id))))
            await conn.ExecuteAsync("DELETE FROM stock_count_line WHERE id = @id", new { e.id }, tx);
    }
}
