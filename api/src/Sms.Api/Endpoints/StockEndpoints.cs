using Dapper;
using Npgsql;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

/// <summary>Lots, receipts, the movement ledger, current levels and alerts.</summary>
public static class StockEndpoints
{
    public sealed class LotRow
    {
        public Guid Id { get; set; }
        public Guid BuItemId { get; set; }
        public Guid BuId { get; set; }
        public string ItemCode { get; set; } = "";
        public string ItemName { get; set; } = "";
        public string BaseUom { get; set; } = "";
        public decimal PackSize { get; set; }
        public string? InstrumentLabel { get; set; }
        public string LotNo { get; set; } = "";
        public DateOnly? ExpiryDate { get; set; }
        public Guid? SupplierId { get; set; }
        public string? SupplierName { get; set; }
        public DateOnly ReceivedOn { get; set; }
        public decimal ReceivedQty { get; set; }
        public decimal? UnitCost { get; set; }
        public string Status { get; set; } = "";
        public decimal QtyOnHand { get; set; }
        public int? DaysToExpiry { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public sealed class MovementRow
    {
        public Guid Id { get; set; }
        public Guid BuItemId { get; set; }
        public Guid BuId { get; set; }
        public string ItemCode { get; set; } = "";
        public string ItemName { get; set; } = "";
        public string BaseUom { get; set; } = "";
        public string? InstrumentLabel { get; set; }
        public Guid? LotId { get; set; }
        public string? LotNo { get; set; }
        public string MovementType { get; set; } = "";
        public decimal QtyDelta { get; set; }
        public DateOnly OccurredOn { get; set; }
        public DateTime OccurredAt { get; set; }
        public string? ReferenceType { get; set; }
        public string? ReferenceId { get; set; }
        public Guid? CounterpartBuItemId { get; set; }
        public string? CounterpartBuCode { get; set; }
        public string? Note { get; set; }
        public string? CreatedBy { get; set; }
        public string? ApiClient { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public sealed record ReceiptWrite(Guid BuItemId, string? LotNo, DateOnly? ExpiryDate, Guid? SupplierId, decimal? ReceivedQty, decimal? Packs, decimal? Loose, DateOnly? ReceivedOn, decimal? UnitCost, string? Note);
    public sealed record LotPatch(string? Status, DateOnly? ExpiryDate, string? Reason);
    public sealed record MovementWrite(Guid BuItemId, Guid? LotId, string MovementType, decimal? Qty, decimal? Packs, decimal? Loose, DateOnly? OccurredOn, string? Note);
    public sealed record TransferWrite(Guid FromBuItemId, Guid ToBuId, Guid? ToBuItemId, Guid? ToInstrumentId, Guid? LotId, decimal? Qty, decimal? Packs, decimal? Loose, DateOnly? OccurredOn, string? Note);

    public const string LotSelect = """
        SELECT l.id, l.bu_item_id, bi.bu_id, i.code AS item_code, i.name AS item_name, i.base_uom, i.pack_size,
               COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
               l.lot_no, l.expiry_date, l.supplier_id, s.name AS supplier_name, l.received_on, l.received_qty, l.unit_cost, l.status::text AS status,
               COALESCE(lc.qty, 0) + COALESCE((SELECT SUM(mv.qty_delta) FROM stock_movement mv WHERE mv.lot_id = l.id AND (lc.submitted_at IS NULL OR mv.occurred_at > lc.submitted_at)), 0) AS qty_on_hand,
               CASE WHEN l.expiry_date IS NULL THEN NULL ELSE (l.expiry_date - CURRENT_DATE) END AS days_to_expiry,
               l.created_at, l.updated_at
        FROM stock_lot l
        JOIN bu_item bi ON bi.id = l.bu_item_id
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
        LEFT JOIN supplier s ON s.id = l.supplier_id
        LEFT JOIN LATERAL (
          SELECT cl.qty, c.submitted_at FROM stock_count_line cl JOIN stock_count c ON c.id = cl.count_id
          WHERE cl.lot_id = l.id AND c.status IN ('submitted','locked')
          ORDER BY c.count_date DESC, (c.session = 'closing') DESC, c.submitted_at DESC LIMIT 1
        ) lc ON true
        """;

    public const string MovementSelect = """
        SELECT m.id, m.bu_item_id, bi.bu_id, i.code AS item_code, i.name AS item_name, i.base_uom,
               COALESCE(ins.label, im.model_name || ' · ' || ins.serial_no) AS instrument_label,
               m.lot_id, sl.lot_no, m.movement_type::text AS movement_type, m.qty_delta, m.occurred_on, m.occurred_at,
               m.reference_type, m.reference_id, m.counterpart_bu_item_id, cb.code AS counterpart_bu_code, m.note,
               u.full_name AS created_by, ac.name AS api_client, m.created_at
        FROM stock_movement m
        JOIN bu_item bi ON bi.id = m.bu_item_id
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model im ON im.id = ins.instrument_model_id
        LEFT JOIN stock_lot sl ON sl.id = m.lot_id
        LEFT JOIN bu_item cbi ON cbi.id = m.counterpart_bu_item_id
        LEFT JOIN business_unit cb ON cb.id = cbi.bu_id
        LEFT JOIN app_user u ON u.id = m.created_by
        LEFT JOIN api_client ac ON ac.id = m.api_client_id
        """;

    private static readonly string[] NegativeTypes = ["wastage", "expiry_writeoff", "return_to_supplier"];
    private static readonly string[] ManagerTypes = ["adjustment", "return_to_supplier", "expiry_writeoff"];

    public static void Map(RouteGroupBuilder api)
    {
        var bu = api.MapGroup("/bus/{buId:guid}").RequireAuthorization(Policies.User);

        // ---- levels + alerts ------------------------------------------------
        bu.MapGet("/levels", async (Guid buId, HttpContext http, Db db, bool? low_only) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<BuItemEndpoints.BuItemRow>(BuItemEndpoints.Select + " WHERE bi.bu_id = @buId AND bi.is_active AND (NOT @low OR COALESCE(cs.is_low, false))" + BuItemEndpoints.Order,
                new { buId, low = low_only == true });
            return Results.Ok(rows);
        });

        bu.MapGet("/alerts", async (Guid buId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var b = await conn.QuerySingleOrDefaultAsync<BusinessUnitEndpoints.BuRow>("SELECT id, timezone, opening_due_time, closing_due_time, grace_minutes FROM business_unit WHERE id = @buId", new { buId })
                    ?? throw ApiException.NotFound("Business unit");
            var now = Periods.NowIn(b.Timezone);
            var today = DateOnly.FromDateTime(now);

            var low = await conn.QueryAsync<BuItemEndpoints.BuItemRow>(BuItemEndpoints.Select + " WHERE bi.bu_id = @buId AND bi.is_active AND COALESCE(cs.is_low, false)" + BuItemEndpoints.Order, new { buId });
            var expiring = await conn.QueryAsync<LotRow>(LotSelect + " WHERE bi.bu_id = @buId AND l.status = 'active' AND l.expiry_date IS NOT NULL AND l.expiry_date <= @limit ORDER BY l.expiry_date", new { buId, limit = today.AddDays(30) });
            var submitted = (await conn.QueryAsync<(DateOnly count_date, string session)>(
                "SELECT count_date, session::text FROM stock_count WHERE bu_id = @buId AND status IN ('submitted','locked') AND count_date >= @from", new { buId, from = today.AddDays(-7) })).ToHashSet();
            var missed = new List<object>();
            for (var d = today.AddDays(-7); d <= today; d = d.AddDays(1))
            {
                foreach (var (session, due) in new[] { ("opening", b.OpeningDueTime), ("closing", b.ClosingDueTime) })
                {
                    if (submitted.Contains((d, session))) continue;
                    var isPast = d < today || now.TimeOfDay > due.ToTimeSpan() + TimeSpan.FromMinutes(b.GraceMinutes);
                    if (isPast) missed.Add(new { date = d, session });
                }
            }
            var variances = await conn.QueryAsync("""
                SELECT c.count_date, c.session::text AS session, i.name AS item_name, sl.lot_no, l.qty, l.expected_qty, l.variance, l.note, u.full_name AS submitted_by
                FROM stock_count_line l JOIN stock_count c ON c.id = l.count_id JOIN business_unit b ON b.id = c.bu_id
                JOIN bu_item bi ON bi.id = l.bu_item_id JOIN item i ON i.id = bi.item_id LEFT JOIN stock_lot sl ON sl.id = l.lot_id LEFT JOIN app_user u ON u.id = c.submitted_by
                WHERE c.bu_id = @buId AND c.status IN ('submitted','locked') AND c.count_date >= @from AND l.expected_qty IS NOT NULL
                  AND ((l.expected_qty = 0 AND l.qty <> 0) OR (l.expected_qty <> 0 AND abs(l.qty - l.expected_qty) / l.expected_qty * 100 > b.variance_tolerance_pct))
                ORDER BY c.count_date DESC, c.session DESC, i.name
                """, new { buId, from = today.AddDays(-7) });
            return Results.Ok(new { low_stock = low, expiring_lots = expiring, missed_counts = missed, recent_variances = variances });
        });

        // ---- lots / receipts ------------------------------------------------
        bu.MapGet("/lots", async (Guid buId, HttpContext http, Db db, Guid? bu_item_id, string? status, int? expiring_within_days) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<LotRow>(LotSelect + """
                 WHERE bi.bu_id = @buId AND (@bi IS NULL OR l.bu_item_id = @bi) AND (@status IS NULL OR l.status::text = @status)
                   AND (@days IS NULL OR (l.expiry_date IS NOT NULL AND l.expiry_date <= CURRENT_DATE + @days))
                 ORDER BY l.status = 'active' DESC, i.name, l.expiry_date NULLS LAST
                """, new { buId, bi = bu_item_id, status, days = expiring_within_days });
            return Results.Ok(rows);
        });

        bu.MapPost("/lots", async (Guid buId, ReceiptWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var item = await conn.QuerySingleOrDefaultAsync<(Guid id, decimal pack_size, bool tracks_lot, bool tracks_expiry)>(
                "SELECT bi.id, i.pack_size, i.tracks_lot, i.tracks_expiry FROM bu_item bi JOIN item i ON i.id = bi.item_id WHERE bi.id = @id AND bi.bu_id = @buId AND bi.is_active", new { id = req.BuItemId, buId });
            if (item.id == Guid.Empty) throw ApiException.NotFound("BU item");
            var qty = req.ReceivedQty ?? ((req.Packs ?? 0) * item.pack_size + (req.Loose ?? 0));
            if (qty <= 0) throw ApiException.Validation("Received quantity must be positive");
            var on = req.ReceivedOn ?? DateOnly.FromDateTime(DateTime.UtcNow);
            await Periods.EnsureUnlocked(conn, buId, on);
            if (item.tracks_expiry && req.ExpiryDate is null) throw ApiException.Validation("expiry_date is required for this item");

            await using var tx = await conn.BeginTransactionAsync();
            Guid? lotId = null;
            if (item.tracks_lot)
            {
                if (string.IsNullOrWhiteSpace(req.LotNo)) throw ApiException.Validation("lot_no is required for this item");
                var lotNo = req.LotNo.Trim();
                var existing = await conn.QuerySingleOrDefaultAsync<(Guid id, string status)>("SELECT id, status::text FROM stock_lot WHERE bu_item_id = @bi AND lot_no = @lotNo", new { bi = item.id, lotNo }, tx);
                if (existing.id != Guid.Empty)
                {
                    // Same lot received again: top up and re-activate.
                    await conn.ExecuteAsync("UPDATE stock_lot SET received_qty = received_qty + @qty, status = 'active', expiry_date = COALESCE(@exp, expiry_date), supplier_id = COALESCE(@sup, supplier_id) WHERE id = @id",
                        new { id = existing.id, qty, exp = req.ExpiryDate, sup = req.SupplierId }, tx);
                    lotId = existing.id;
                }
                else
                {
                    lotId = await conn.ExecuteScalarAsync<Guid>("""
                        INSERT INTO stock_lot(bu_item_id, lot_no, expiry_date, supplier_id, received_on, received_qty, unit_cost, created_by)
                        VALUES (@bi, @lotNo, @exp, @sup, @on, @qty, @cost, @uid) RETURNING id
                        """, new { bi = item.id, lotNo, exp = req.ExpiryDate, sup = req.SupplierId, on, qty, cost = req.UnitCost, uid = me.UserId }, tx);
                }
            }
            var mid = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO stock_movement(bu_item_id, lot_id, movement_type, qty_delta, occurred_on, occurred_at, reference_type, note, created_by)
                VALUES (@bi, @lot, 'receipt', @qty, @on, CASE WHEN @on = CURRENT_DATE THEN now() ELSE (@on::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END, 'grn', @note, @uid) RETURNING id
                """, new { bi = item.id, lot = lotId, qty, on, note = req.Note, uid = me.UserId }, tx);
            await Audit.Write(conn, tx, me, "stock.receipt", "stock_movement", mid, buId, null, new { req.BuItemId, lot_id = lotId, req.LotNo, qty, on }, http);
            await tx.CommitAsync();

            var lot = lotId is null ? null : await conn.QuerySingleAsync<LotRow>(LotSelect + " WHERE l.id = @id", new { id = lotId });
            var movement = await conn.QuerySingleAsync<MovementRow>(MovementSelect + " WHERE m.id = @id", new { id = mid });
            return Results.Created($"/api/v1/bus/{buId}/lots/{lotId}", new { lot, movement });
        });

        api.MapPatch("/lots/{lotId:guid}", async (Guid lotId, LotPatch req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<LotRow>(LotSelect + " WHERE l.id = @lotId", new { lotId }) ?? throw ApiException.NotFound("Lot");
            await me.RequireBu(conn, before.BuId);
            if (req.Status is not null && req.Status is not ("active" or "exhausted" or "expired" or "quarantined")) throw ApiException.Validation("Invalid lot status");
            await conn.ExecuteAsync("UPDATE stock_lot SET status = COALESCE(@status::lot_status, status), expiry_date = COALESCE(@exp, expiry_date) WHERE id = @lotId", new { lotId, status = req.Status, exp = req.ExpiryDate });
            var after = await conn.QuerySingleAsync<LotRow>(LotSelect + " WHERE l.id = @lotId", new { lotId });
            await Audit.Write(conn, null, me, "lot.update", "stock_lot", lotId, before.BuId, new { before.Status, before.ExpiryDate }, new { after.Status, after.ExpiryDate, req.Reason }, http);
            return Results.Ok(after);
        }).RequireAuthorization(Policies.User);

        // ---- movements ------------------------------------------------------
        bu.MapGet("/movements", async (Guid buId, HttpContext http, Db db, DateOnly? from, DateOnly? to, string? type, Guid? bu_item_id, int? limit) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<MovementRow>(MovementSelect + """
                 WHERE bi.bu_id = @buId AND (@from::date IS NULL OR m.occurred_on >= @from::date) AND (@to::date IS NULL OR m.occurred_on <= @to::date)
                   AND (@type IS NULL OR m.movement_type::text = @type) AND (@bi IS NULL OR m.bu_item_id = @bi)
                 ORDER BY m.occurred_at DESC LIMIT @limit
                """, new { buId, from, to, type, bi = bu_item_id, limit = Math.Clamp(limit ?? 200, 1, 1000) });
            return Results.Ok(rows);
        });

        bu.MapPost("/movements", async (Guid buId, MovementWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireEditor();
            if (req.MovementType is not ("wastage" or "adjustment" or "return_to_supplier" or "expiry_writeoff"))
                throw ApiException.Validation("movement_type must be wastage, adjustment, return_to_supplier or expiry_writeoff (use /lots for receipts, /transfers for transfers)");
            if (ManagerTypes.Contains(req.MovementType)) me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var item = await conn.QuerySingleOrDefaultAsync<(Guid id, decimal pack_size, bool tracks_lot)>(
                "SELECT bi.id, i.pack_size, i.tracks_lot FROM bu_item bi JOIN item i ON i.id = bi.item_id WHERE bi.id = @id AND bi.bu_id = @buId", new { id = req.BuItemId, buId });
            if (item.id == Guid.Empty) throw ApiException.NotFound("BU item");
            if (item.tracks_lot && req.LotId is null) throw ApiException.Validation("lot_id is required for this item");
            if (req.LotId is not null)
            {
                var lotOk = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM stock_lot WHERE id = @lot AND bu_item_id = @bi)", new { lot = req.LotId, bi = item.id });
                if (!lotOk) throw ApiException.Validation("lot_id does not belong to this item");
            }
            var qty = req.Qty ?? ((req.Packs ?? 0) * item.pack_size + (req.Loose ?? 0));
            if (qty == 0) throw ApiException.Validation("Quantity cannot be zero");
            var delta = NegativeTypes.Contains(req.MovementType) ? -Math.Abs(qty) : qty; // adjustment keeps the caller's sign
            var on = req.OccurredOn ?? DateOnly.FromDateTime(DateTime.UtcNow);
            await Periods.EnsureUnlocked(conn, buId, on);
            if (req.MovementType == "adjustment" && string.IsNullOrWhiteSpace(req.Note)) throw ApiException.Validation("Adjustments need a note");

            var mid = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO stock_movement(bu_item_id, lot_id, movement_type, qty_delta, occurred_on, occurred_at, note, created_by)
                VALUES (@bi, @lot, @type::movement_type, @delta, @on, CASE WHEN @on = CURRENT_DATE THEN now() ELSE (@on::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END, @note, @uid) RETURNING id
                """, new { bi = item.id, lot = req.LotId, type = req.MovementType, delta, on, note = req.Note, uid = me.UserId });
            await Audit.Write(conn, null, me, "stock." + req.MovementType, "stock_movement", mid, buId, null, new { req.BuItemId, req.LotId, delta, on, req.Note }, http);
            return Results.Created($"/api/v1/bus/{buId}/movements/{mid}", await conn.QuerySingleAsync<MovementRow>(MovementSelect + " WHERE m.id = @id", new { id = mid }));
        });

        bu.MapPost("/transfers", async (Guid buId, TransferWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            await me.RequireBu(conn, req.ToBuId);
            if (req.ToBuId == buId && req.ToBuItemId is null && req.ToInstrumentId is null) throw ApiException.Validation("Transfers within a business unit need a target bu_item or instrument");

            var src = await conn.QuerySingleOrDefaultAsync<(Guid id, Guid item_id, decimal pack_size, bool tracks_lot)>(
                "SELECT bi.id, bi.item_id, i.pack_size, i.tracks_lot FROM bu_item bi JOIN item i ON i.id = bi.item_id WHERE bi.id = @id AND bi.bu_id = @buId", new { id = req.FromBuItemId, buId });
            if (src.id == Guid.Empty) throw ApiException.NotFound("Source BU item");
            if (src.tracks_lot && req.LotId is null) throw ApiException.Validation("lot_id is required for this item");
            var qty = req.Qty ?? ((req.Packs ?? 0) * src.pack_size + (req.Loose ?? 0));
            if (qty <= 0) throw ApiException.Validation("Quantity must be positive");
            var on = req.OccurredOn ?? DateOnly.FromDateTime(DateTime.UtcNow);
            await Periods.EnsureUnlocked(conn, buId, on);
            await Periods.EnsureUnlocked(conn, req.ToBuId, on);

            await using var tx = await conn.BeginTransactionAsync();
            // Destination bu_item: given, or found/created for the same item (and optional instrument) in the target BU.
            Guid dstId;
            if (req.ToBuItemId is not null)
            {
                var ok = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM bu_item WHERE id = @id AND bu_id = @to AND item_id = @item)", new { id = req.ToBuItemId, to = req.ToBuId, item = src.item_id }, tx);
                if (!ok) throw ApiException.Validation("to_bu_item_id must be the same item in the target business unit");
                dstId = req.ToBuItemId.Value;
            }
            else
            {
                var found = await conn.ExecuteScalarAsync<Guid?>("SELECT id FROM bu_item WHERE bu_id = @to AND item_id = @item AND instrument_id IS NOT DISTINCT FROM @ins", new { to = req.ToBuId, item = src.item_id, ins = req.ToInstrumentId }, tx);
                dstId = found ?? await conn.ExecuteScalarAsync<Guid>("INSERT INTO bu_item(bu_id, item_id, instrument_id) VALUES (@to, @item, @ins) RETURNING id", new { to = req.ToBuId, item = src.item_id, ins = req.ToInstrumentId }, tx);
                await conn.ExecuteAsync("UPDATE bu_item SET is_active = true WHERE id = @dstId", new { dstId }, tx);
            }
            if (dstId == src.id) throw ApiException.Validation("Source and destination are the same");

            // Destination lot mirrors the source lot.
            Guid? dstLot = null;
            if (req.LotId is not null)
            {
                var lot = await conn.QuerySingleOrDefaultAsync<(Guid id, string lot_no, DateOnly? expiry_date, Guid? supplier_id, decimal? unit_cost)>(
                    "SELECT id, lot_no, expiry_date, supplier_id, unit_cost FROM stock_lot WHERE id = @lot AND bu_item_id = @bi", new { lot = req.LotId, bi = src.id }, tx);
                if (lot.id == Guid.Empty) throw ApiException.Validation("lot_id does not belong to the source item");
                dstLot = await conn.ExecuteScalarAsync<Guid?>("SELECT id FROM stock_lot WHERE bu_item_id = @dstId AND lot_no = @lotNo", new { dstId, lotNo = lot.lot_no }, tx)
                         ?? await conn.ExecuteScalarAsync<Guid>("INSERT INTO stock_lot(bu_item_id, lot_no, expiry_date, supplier_id, received_on, received_qty, unit_cost, created_by) VALUES (@dstId, @lotNo, @exp, @sup, @on, 0, @cost, @uid) RETURNING id",
                             new { dstId, lotNo = lot.lot_no, exp = lot.expiry_date, sup = lot.supplier_id, on, cost = lot.unit_cost, uid = me.UserId }, tx);
                await conn.ExecuteAsync("UPDATE stock_lot SET status = 'active', received_qty = received_qty + @qty WHERE id = @dstLot", new { dstLot, qty }, tx);
            }

            var reference = Guid.NewGuid().ToString("N")[..12];
            const string ins = """
                INSERT INTO stock_movement(bu_item_id, lot_id, movement_type, qty_delta, occurred_on, occurred_at, reference_type, reference_id, counterpart_bu_item_id, note, created_by)
                VALUES (@bi, @lot, @type::movement_type, @delta, @on, CASE WHEN @on = CURRENT_DATE THEN now() ELSE (@on::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END, 'transfer', @ref, @cp, @note, @uid) RETURNING id
                """;
            var outId = await conn.ExecuteScalarAsync<Guid>(ins, new { bi = src.id, lot = req.LotId, type = "transfer_out", delta = -qty, on, @ref = reference, cp = dstId, note = req.Note, uid = me.UserId }, tx);
            var inId = await conn.ExecuteScalarAsync<Guid>(ins, new { bi = dstId, lot = dstLot, type = "transfer_in", delta = qty, on, @ref = reference, cp = src.id, note = req.Note, uid = me.UserId }, tx);
            await Audit.Write(conn, tx, me, "stock.transfer", "stock_movement", reference, buId, null, new { from = src.id, to = dstId, req.ToBuId, qty, on, req.LotId }, http);
            await tx.CommitAsync();

            var rows = await conn.QueryAsync<MovementRow>(MovementSelect + " WHERE m.id = ANY(@ids)", new { ids = new[] { outId, inId } });
            return Results.Created($"/api/v1/bus/{buId}/movements/{outId}", new { transfer_out = rows.First(r => r.Id == outId), transfer_in = rows.First(r => r.Id == inId) });
        });
    }
}
