using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

/// <summary>
/// Integration surface for Matter and Infinity: API-key authenticated, scope
/// gated, cursor paginated, incremental via updated_since. Natural keys
/// (bu_code, item_code, serial numbers) travel with every row.
/// </summary>
public static class ExportEndpoints
{
    public sealed record IngestMovement(string BuCode, string ItemCode, string? InstrumentSerial, string? LotNo, DateOnly? ExpiryDate, string MovementType, decimal Qty, DateOnly? OccurredOn, string ReferenceType, string ReferenceId, string? Note);

    public static void Map(RouteGroupBuilder export, RouteGroupBuilder ingest)
    {
        export.RequireAuthorization(Policies.ApiKey);
        ingest.RequireAuthorization(Policies.ApiKey);

        export.MapGet("/business-units", async (HttpContext http, Db db) =>
        {
            Current.From(http.User).RequireScope(Scopes.CatalogueRead);
            await using var conn = await db.Open();
            var bus = (await conn.QueryAsync("SELECT id, code, name, bu_type::text AS bu_type, timezone, is_active, updated_at FROM business_unit ORDER BY code")).ToList();
            var instruments = await conn.QueryAsync("SELECT i.id, i.bu_id, i.serial_no, i.label, i.status::text AS status, m.manufacturer, m.model_name, m.category FROM instrument i JOIN instrument_model m ON m.id = i.instrument_model_id ORDER BY i.bu_id, i.serial_no");
            var byBu = instruments.GroupBy(x => (Guid)x.bu_id).ToDictionary(g => g.Key, g => g.ToList());
            return Results.Ok(new { items = bus.Select(b => new { b.id, b.code, b.name, b.bu_type, b.timezone, b.is_active, b.updated_at, instruments = byBu.GetValueOrDefault((Guid)b.id) ?? [] }) });
        });

        export.MapGet("/items", async (HttpContext http, Db db, DateTime? updated_since) =>
        {
            Current.From(http.User).RequireScope(Scopes.CatalogueRead);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync(CatalogueEndpoints.ItemSelect + " WHERE (@since::timestamptz IS NULL OR i.updated_at > @since::timestamptz) ORDER BY i.code", new { since = updated_since?.ToUniversalTime() }) });
        });

        export.MapGet("/bu-items", async (HttpContext http, Db db, string? bu) =>
        {
            Current.From(http.User).RequireScope(Scopes.CatalogueRead);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync("""
                SELECT bi.id, bi.bu_id, b.code AS bu_code, bi.item_id, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom, i.pack_size,
                       bi.instrument_id, ins.serial_no AS instrument_serial, bi.min_level, bi.max_level, bi.reorder_qty, bi.is_active, bi.updated_at
                FROM bu_item bi JOIN business_unit b ON b.id = bi.bu_id JOIN item i ON i.id = bi.item_id LEFT JOIN instrument ins ON ins.id = bi.instrument_id
                WHERE (@bu IS NULL OR b.code = @bu) ORDER BY b.code, i.code
                """, new { bu }) });
        });

        export.MapGet("/counts", async (HttpContext http, Db db, string? bu, DateOnly? from, DateOnly? to, DateTime? updated_since, string? cursor, int? limit) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportCounts);
            var take = Math.Clamp(limit ?? 100, 1, 500);
            var cur = Cursor.Decode(cursor);
            await using var conn = await db.Open();
            var headers = (await conn.QueryAsync<CountEndpoints.CountHeader>(CountEndpoints.HeaderSelect + """
                 WHERE c.status IN ('submitted','locked') AND (@bu IS NULL OR b.code = @bu) AND (@from::date IS NULL OR c.count_date >= @from::date) AND (@to::date IS NULL OR c.count_date <= @to::date)
                   AND (@since::timestamptz IS NULL OR c.updated_at > @since::timestamptz) AND (@curTs::timestamptz IS NULL OR (c.updated_at, c.id) > (@curTs::timestamptz, @curId::uuid))
                 ORDER BY c.updated_at, c.id LIMIT @take
                """, new { bu, from, to, since = updated_since?.ToUniversalTime(), curTs = cur?.ts, curId = cur?.id, take })).ToList();
            var ids = headers.Select(h => h.Id).ToArray();
            var lines = await conn.QueryAsync("""
                SELECT l.count_id, l.id, l.bu_item_id, i.code AS item_code, i.name AS item_name, i.base_uom, i.pack_size, ins.serial_no AS instrument_serial,
                       COALESCE(ins.label, m.manufacturer || ' ' || m.model_name) AS instrument_label, sl.lot_no, sl.expiry_date, l.qty, l.expected_qty, l.variance, l.note
                FROM stock_count_line l JOIN bu_item bi ON bi.id = l.bu_item_id JOIN item i ON i.id = bi.item_id
                LEFT JOIN stock_lot sl ON sl.id = l.lot_id LEFT JOIN instrument ins ON ins.id = bi.instrument_id LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
                WHERE l.count_id = ANY(@ids)
                """, new { ids });
            var byCount = lines.GroupBy(l => (Guid)l.count_id).ToDictionary(g => g.Key, g => g.Select(l => new
            {
                l.id, l.bu_item_id, item = new { code = l.item_code, name = l.item_name, base_uom = l.base_uom, pack_size = l.pack_size },
                instrument = l.instrument_serial is null ? null : new { serial_no = l.instrument_serial, label = l.instrument_label },
                lot = l.lot_no is null ? null : new { lot_no = l.lot_no, expiry_date = l.expiry_date },
                l.qty, l.expected_qty, l.variance, l.note,
            }).ToList());
            var items = headers.Select(h => new
            {
                h.Id, bu = new { id = h.BuId, code = h.BuCode }, h.CountDate, h.Session, h.Status, h.SubmittedAt, h.SubmittedBy, h.Note,
                lines = byCount.GetValueOrDefault(h.Id) ?? [], h.UpdatedAt,
            }).ToList();
            return Results.Ok(new { items, next_cursor = headers.Count == take ? Cursor.Encode(headers[^1].UpdatedAt, headers[^1].Id) : null });
        });

        export.MapGet("/movements", async (HttpContext http, Db db, string? bu, DateOnly? from, DateOnly? to, DateTime? updated_since, string? cursor, int? limit) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportMovements);
            var take = Math.Clamp(limit ?? 200, 1, 500);
            var cur = Cursor.Decode(cursor);
            await using var conn = await db.Open();
            var rows = (await conn.QueryAsync<StockEndpoints.MovementRow>(StockEndpoints.MovementSelect + """
                 JOIN business_unit b ON b.id = bi.bu_id
                 WHERE (@bu IS NULL OR b.code = @bu) AND (@from::date IS NULL OR m.occurred_on >= @from::date) AND (@to::date IS NULL OR m.occurred_on <= @to::date)
                   AND (@since::timestamptz IS NULL OR m.created_at > @since::timestamptz) AND (@curTs::timestamptz IS NULL OR (m.created_at, m.id) > (@curTs::timestamptz, @curId::uuid))
                 ORDER BY m.created_at, m.id LIMIT @take
                """, new { bu, from, to, since = updated_since?.ToUniversalTime(), curTs = cur?.ts, curId = cur?.id, take })).ToList();
            return Results.Ok(new { items = rows, next_cursor = rows.Count == take ? Cursor.Encode(rows[^1].CreatedAt, rows[^1].Id) : null });
        });

        export.MapGet("/lots", async (HttpContext http, Db db, string? bu, string? status, DateTime? updated_since) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportMovements);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync<StockEndpoints.LotRow>(StockEndpoints.LotSelect + " JOIN business_unit b ON b.id = bi.bu_id WHERE (@bu IS NULL OR b.code = @bu) AND (@status IS NULL OR l.status::text = @status) AND (@since::timestamptz IS NULL OR l.updated_at > @since::timestamptz) ORDER BY l.updated_at, l.id",
                new { bu, status, since = updated_since?.ToUniversalTime() }) });
        });

        export.MapGet("/levels", async (HttpContext http, Db db, string? bu) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportLevels);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync("""
                SELECT cs.bu_item_id, cs.bu_id, b.code AS bu_code, i.code AS item_code, i.name AS item_name, i.base_uom, ins.serial_no AS instrument_serial,
                       cs.qty_on_hand, cs.min_level, cs.max_level, cs.is_low, cs.last_count_date, cs.last_count_session::text AS last_count_session
                FROM v_current_stock cs JOIN business_unit b ON b.id = cs.bu_id JOIN item i ON i.id = cs.item_id LEFT JOIN instrument ins ON ins.id = cs.instrument_id
                WHERE (@bu IS NULL OR b.code = @bu) ORDER BY b.code, i.code
                """, new { bu }) });
        });

        export.MapGet("/snapshots", async (HttpContext http, Db db, string? bu, string? period_type, DateOnly? period_start, DateTime? updated_since) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportSnapshots);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync<SnapshotEndpoints.SnapshotRow>(SnapshotEndpoints.Select + """
                 WHERE (@bu IS NULL OR b.code = @bu) AND (@type IS NULL OR s.period_type::text = @type) AND (@start::date IS NULL OR s.period_start = @start::date) AND (@since::timestamptz IS NULL OR s.computed_at > @since::timestamptz)
                 ORDER BY s.period_start, b.code, i.code
                """, new { bu, type = period_type, start = period_start, since = updated_since?.ToUniversalTime() }) });
        });

        export.MapGet("/consumption/daily", async (HttpContext http, Db db, string? bu, DateOnly? from, DateOnly? to) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportConsumption);
            var t = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var f = from ?? t.AddDays(-30);
            await using var conn = await db.Open();
            return Results.Ok(new { from = f, to = t, items = await conn.QueryAsync("""
                SELECT d.count_date, d.bu_id, b.code AS bu_code, d.bu_item_id, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom, ins.serial_no AS instrument_serial,
                       d.opening_qty, d.received_qty, d.wastage_qty, d.transfer_qty, d.adjustment_qty, d.closing_qty, d.consumed_qty
                FROM v_daily_consumption d JOIN business_unit b ON b.id = d.bu_id JOIN bu_item bi ON bi.id = d.bu_item_id JOIN item i ON i.id = bi.item_id LEFT JOIN instrument ins ON ins.id = bi.instrument_id
                WHERE d.count_date BETWEEN @f AND @t AND (@bu IS NULL OR b.code = @bu) ORDER BY d.count_date, b.code, i.code
                """, new { f, t, bu }) });
        });

        export.MapGet("/consumption/periods", async (HttpContext http, Db db, string? bu, string? period_type, DateOnly? period_start) =>
        {
            Current.From(http.User).RequireScope(Scopes.ExportConsumption);
            await using var conn = await db.Open();
            return Results.Ok(new { items = await conn.QueryAsync("""
                SELECT s.id, s.bu_item_id, bi.bu_id, b.code AS bu_code, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.base_uom, ins.serial_no AS instrument_serial,
                       s.period_type::text AS period_type, s.period_start, s.period_end, s.opening_qty, s.received_qty, s.wastage_qty, s.transfer_qty, s.adjustment_qty, s.closing_qty, s.consumed_qty,
                       s.count_days, s.missing_days, s.is_locked, s.computed_at
                FROM period_snapshot s JOIN bu_item bi ON bi.id = s.bu_item_id JOIN business_unit b ON b.id = bi.bu_id JOIN item i ON i.id = bi.item_id LEFT JOIN instrument ins ON ins.id = bi.instrument_id
                WHERE (@bu IS NULL OR b.code = @bu) AND (@type IS NULL OR s.period_type::text = @type) AND (@start::date IS NULL OR s.period_start = @start::date)
                ORDER BY s.period_start, b.code, i.code
                """, new { bu, type = period_type, start = period_start }) });
        });

        ingest.MapPost("/movements", async (IngestMovement[] rows, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireScope(Scopes.IngestMovements);
            await using var conn = await db.Open();
            var results = new List<object>();
            foreach (var r in rows)
            {
                if (r.MovementType is not ("receipt" or "adjustment" or "wastage" or "return_to_supplier"))
                { results.Add(new { r.ReferenceId, status = "rejected", reason = "movement_type must be receipt, adjustment, wastage or return_to_supplier" }); continue; }
                var dup = await conn.ExecuteScalarAsync<Guid?>("SELECT id FROM stock_movement WHERE reference_type = @rt AND reference_id = @rid", new { rt = r.ReferenceType, rid = r.ReferenceId });
                if (dup is not null) { results.Add(new { r.ReferenceId, status = "duplicate", movement_id = dup }); continue; }
                var target = await conn.QuerySingleOrDefaultAsync<(Guid bu_item_id, Guid bu_id, decimal pack_size, bool tracks_lot)>("""
                    SELECT bi.id, bi.bu_id, i.pack_size, i.tracks_lot FROM bu_item bi JOIN business_unit b ON b.id = bi.bu_id JOIN item i ON i.id = bi.item_id LEFT JOIN instrument ins ON ins.id = bi.instrument_id
                    WHERE b.code = @bu AND i.code = @item AND (@serial IS NULL AND bi.instrument_id IS NULL OR ins.serial_no = @serial) AND bi.is_active LIMIT 1
                    """, new { bu = r.BuCode, item = r.ItemCode, serial = r.InstrumentSerial });
                if (target.bu_item_id == Guid.Empty) { results.Add(new { r.ReferenceId, status = "rejected", reason = "bu_item not found for bu_code/item_code/instrument_serial" }); continue; }
                var on = r.OccurredOn ?? DateOnly.FromDateTime(DateTime.UtcNow);
                try { await Periods.EnsureUnlocked(conn, target.bu_id, on); }
                catch (ApiException) { results.Add(new { r.ReferenceId, status = "rejected", reason = "period locked" }); continue; }

                await using var tx = await conn.BeginTransactionAsync();
                Guid? lotId = null;
                if (target.tracks_lot)
                {
                    if (string.IsNullOrWhiteSpace(r.LotNo)) { await tx.RollbackAsync(); results.Add(new { r.ReferenceId, status = "rejected", reason = "lot_no required" }); continue; }
                    lotId = await conn.ExecuteScalarAsync<Guid?>("SELECT id FROM stock_lot WHERE bu_item_id = @bi AND lot_no = @lot", new { bi = target.bu_item_id, lot = r.LotNo }, tx);
                    if (lotId is null)
                    {
                        if (r.MovementType != "receipt") { await tx.RollbackAsync(); results.Add(new { r.ReferenceId, status = "rejected", reason = "unknown lot" }); continue; }
                        lotId = await conn.ExecuteScalarAsync<Guid>("INSERT INTO stock_lot(bu_item_id, lot_no, expiry_date, received_on, received_qty) VALUES (@bi, @lot, @exp, @on, @qty) RETURNING id",
                            new { bi = target.bu_item_id, lot = r.LotNo, exp = r.ExpiryDate, on, qty = Math.Abs(r.Qty) }, tx);
                    }
                    else if (r.MovementType == "receipt")
                        await conn.ExecuteAsync("UPDATE stock_lot SET received_qty = received_qty + @qty, status = 'active' WHERE id = @lotId", new { lotId, qty = Math.Abs(r.Qty) }, tx);
                }
                var delta = r.MovementType switch { "receipt" => Math.Abs(r.Qty), "wastage" or "return_to_supplier" => -Math.Abs(r.Qty), _ => r.Qty };
                var id = await conn.ExecuteScalarAsync<Guid>("""
                    INSERT INTO stock_movement(bu_item_id, lot_id, movement_type, qty_delta, occurred_on, occurred_at, reference_type, reference_id, note, api_client_id)
                    VALUES (@bi, @lot, @type::movement_type, @delta, @on, (@on::timestamp + interval '12 hours') AT TIME ZONE 'UTC', @rt, @rid, @note, @client) RETURNING id
                    """, new { bi = target.bu_item_id, lot = lotId, type = r.MovementType, delta, on, rt = r.ReferenceType, rid = r.ReferenceId, r.Note, client = me.ClientId }, tx);
                await Audit.Write(conn, tx, me, "ingest.movement", "stock_movement", id, target.bu_id, null, r, http);
                await tx.CommitAsync();
                results.Add(new { r.ReferenceId, status = "created", movement_id = id });
            }
            return Results.Ok(new { results });
        });
    }
}
