using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

public static class BuItemEndpoints
{
    /// <summary>A bu_item joined with its catalogue item, instrument and current level. Never carries consumption.</summary>
    public sealed class BuItemRow
    {
        public Guid Id { get; set; }
        public Guid BuId { get; set; }
        public Guid ItemId { get; set; }
        public string ItemCode { get; set; } = "";
        public string ItemName { get; set; } = "";
        public string Kind { get; set; } = "";
        public string? Category { get; set; }
        public string BaseUom { get; set; } = "";
        public decimal PackSize { get; set; }
        public string PackUom { get; set; } = "";
        public bool TracksLot { get; set; }
        public bool TracksExpiry { get; set; }
        public string Storage { get; set; } = "";
        public Guid? InstrumentId { get; set; }
        public string? InstrumentLabel { get; set; }
        public string? InstrumentModel { get; set; }
        public string? InstrumentSerial { get; set; }
        public decimal? MinLevel { get; set; }
        public decimal? MaxLevel { get; set; }
        public decimal? ReorderQty { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; }
        public decimal QtyOnHand { get; set; }
        public bool IsLow { get; set; }
        public DateOnly? LastCountDate { get; set; }
        public string? LastCountSession { get; set; }
        public int ActiveLotCount { get; set; }
        public DateOnly? NearestExpiry { get; set; }
    }

    public sealed record BuItemWrite(Guid? ItemId, Guid? InstrumentId, decimal? MinLevel, decimal? MaxLevel, decimal? ReorderQty, int? SortOrder, bool? IsActive);

    public const string Select = """
        SELECT bi.id, bi.bu_id, bi.item_id, i.code AS item_code, i.name AS item_name, i.kind::text AS kind, i.category, i.base_uom, i.pack_size, i.pack_uom,
               i.tracks_lot, i.tracks_expiry, i.storage::text AS storage,
               bi.instrument_id, COALESCE(ins.label, m.model_name || ' · ' || ins.serial_no) AS instrument_label,
               CASE WHEN m.id IS NULL THEN NULL ELSE m.manufacturer || ' ' || m.model_name END AS instrument_model, ins.serial_no AS instrument_serial,
               bi.min_level, bi.max_level, bi.reorder_qty, bi.sort_order, bi.is_active,
               COALESCE(cs.qty_on_hand, 0) AS qty_on_hand, COALESCE(cs.is_low, false) AS is_low, cs.last_count_date, cs.last_count_session::text AS last_count_session,
               (SELECT count(*) FROM stock_lot l WHERE l.bu_item_id = bi.id AND l.status = 'active') AS active_lot_count,
               (SELECT min(l.expiry_date) FROM stock_lot l WHERE l.bu_item_id = bi.id AND l.status = 'active') AS nearest_expiry
        FROM bu_item bi
        JOIN item i ON i.id = bi.item_id
        LEFT JOIN instrument ins ON ins.id = bi.instrument_id
        LEFT JOIN instrument_model m ON m.id = ins.instrument_model_id
        LEFT JOIN v_current_stock cs ON cs.bu_item_id = bi.id
        """;

    public const string Order = " ORDER BY bi.instrument_id IS NULL, m.manufacturer, m.model_name, ins.serial_no, bi.sort_order, i.kind, i.name";

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/bus/{buId:guid}/items").RequireAuthorization(Policies.User);

        g.MapGet("", async (Guid buId, HttpContext http, Db db, bool? include_inactive, bool? low_only, Guid? instrument_id) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<BuItemRow>(Select + """
                 WHERE bi.bu_id = @buId AND (@inactive OR bi.is_active)
                   AND (NOT @low OR COALESCE(cs.is_low, false))
                   AND (@instrument IS NULL OR bi.instrument_id = @instrument)
                """ + Order, new { buId, inactive = include_inactive == true, low = low_only == true, instrument = instrument_id });
            return Results.Ok(rows);
        });

        g.MapGet("/suggestions", async (Guid buId, HttpContext http, Db db, Guid? instrument_id) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = instrument_id is null
                ? await conn.QueryAsync<CatalogueEndpoints.ItemRow>(CatalogueEndpoints.ItemSelect + " WHERE i.is_active AND i.instrument_model_id IS NULL AND NOT EXISTS (SELECT 1 FROM bu_item bi WHERE bi.bu_id = @buId AND bi.item_id = i.id AND bi.instrument_id IS NULL) ORDER BY i.kind, i.name", new { buId })
                : await conn.QueryAsync<CatalogueEndpoints.ItemRow>(CatalogueEndpoints.ItemSelect + " WHERE i.is_active AND i.instrument_model_id = (SELECT instrument_model_id FROM instrument WHERE id = @ins) AND NOT EXISTS (SELECT 1 FROM bu_item bi WHERE bi.bu_id = @buId AND bi.item_id = i.id AND bi.instrument_id = @ins) ORDER BY i.kind, i.name", new { buId, ins = instrument_id });
            return Results.Ok(rows);
        });

        g.MapPost("", async (Guid buId, BuItemWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var id = await Insert(conn, buId, req);
            await Audit.Write(conn, null, me, "bu_item.create", "bu_item", id, buId, null, req, http);
            return Results.Created($"/api/v1/bus/{buId}/items/{id}", await conn.QuerySingleAsync<BuItemRow>(Select + " WHERE bi.id = @id", new { id }));
        });

        g.MapPost("/bulk", async (Guid buId, BuItemWrite[] reqs, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            await using var tx = await conn.BeginTransactionAsync();
            var ids = new List<Guid>();
            foreach (var req in reqs) ids.Add(await Insert(conn, buId, req, tx));
            await Audit.Write(conn, tx, me, "bu_item.bulk_create", "bu_item", string.Join(",", ids), buId, null, reqs, http);
            await tx.CommitAsync();
            return Results.Ok(await conn.QueryAsync<BuItemRow>(Select + " WHERE bi.id = ANY(@ids)" + Order, new { ids = ids.ToArray() }));
        });

        g.MapPatch("/{buItemId:guid}", async (Guid buId, Guid buItemId, BuItemWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var before = await conn.QuerySingleOrDefaultAsync<BuItemRow>(Select + " WHERE bi.id = @buItemId AND bi.bu_id = @buId", new { buItemId, buId }) ?? throw ApiException.NotFound("BU item");
            await conn.ExecuteAsync("""
                UPDATE bu_item SET min_level = COALESCE(@min, min_level), max_level = COALESCE(@max, max_level), reorder_qty = COALESCE(@reorder, reorder_qty),
                  sort_order = COALESCE(@sort, sort_order), is_active = COALESCE(@active, is_active)
                WHERE id = @buItemId
                """, new { buItemId, min = req.MinLevel, max = req.MaxLevel, reorder = req.ReorderQty, sort = req.SortOrder, active = req.IsActive });
            var after = await conn.QuerySingleAsync<BuItemRow>(Select + " WHERE bi.id = @buItemId", new { buItemId });
            await Audit.Write(conn, null, me, "bu_item.update", "bu_item", buItemId, buId, before, after, http);
            return Results.Ok(after);
        });

        // Item drawer: lots, recent counts and movements for one bu_item.
        g.MapGet("/{buItemId:guid}/history", async (Guid buId, Guid buItemId, HttpContext http, Db db, int? days) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var item = await conn.QuerySingleOrDefaultAsync<BuItemRow>(Select + " WHERE bi.id = @buItemId AND bi.bu_id = @buId", new { buItemId, buId }) ?? throw ApiException.NotFound("BU item");
            var since = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-(days ?? 30));
            var lots = await conn.QueryAsync<StockEndpoints.LotRow>(StockEndpoints.LotSelect + " WHERE l.bu_item_id = @buItemId ORDER BY l.status = 'active' DESC, l.expiry_date NULLS LAST", new { buItemId });
            var counts = await conn.QueryAsync("""
                SELECT c.count_date, c.session::text AS session, c.status::text AS status, SUM(cl.qty) AS qty, SUM(cl.expected_qty) AS expected_qty, u.full_name AS submitted_by
                FROM stock_count_line cl JOIN stock_count c ON c.id = cl.count_id LEFT JOIN app_user u ON u.id = c.submitted_by
                WHERE cl.bu_item_id = @buItemId AND c.count_date >= @since
                GROUP BY c.count_date, c.session, c.status, u.full_name ORDER BY c.count_date DESC, c.session DESC
                """, new { buItemId, since });
            var movements = await conn.QueryAsync<StockEndpoints.MovementRow>(StockEndpoints.MovementSelect + " WHERE m.bu_item_id = @buItemId AND m.occurred_on >= @since ORDER BY m.occurred_at DESC", new { buItemId, since });
            return Results.Ok(new { item, lots, counts, movements });
        });
    }

    private static async Task<Guid> Insert(Npgsql.NpgsqlConnection conn, Guid buId, BuItemWrite req, Npgsql.NpgsqlTransaction? tx = null)
    {
        if (req.ItemId is null) throw ApiException.Validation("item_id is required");
        if (req.InstrumentId is not null)
        {
            var ok = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM instrument WHERE id = @i AND bu_id = @buId)", new { i = req.InstrumentId, buId }, tx);
            if (!ok) throw ApiException.Validation("instrument_id does not belong to this business unit");
        }
        var minDefault = await conn.ExecuteScalarAsync<decimal?>("SELECT default_min_level FROM item WHERE id = @i AND is_active", new { i = req.ItemId }, tx);
        var existing = await conn.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM bu_item WHERE bu_id = @buId AND item_id = @item AND instrument_id IS NOT DISTINCT FROM @ins", new { buId, item = req.ItemId, ins = req.InstrumentId }, tx);
        if (existing is not null)
        {
            // Re-activate rather than duplicate.
            await conn.ExecuteAsync("UPDATE bu_item SET is_active = true, min_level = COALESCE(@min, min_level), max_level = COALESCE(@max, max_level), reorder_qty = COALESCE(@reorder, reorder_qty) WHERE id = @id",
                new { id = existing, min = req.MinLevel, max = req.MaxLevel, reorder = req.ReorderQty }, tx);
            return existing.Value;
        }
        return await conn.ExecuteScalarAsync<Guid>("""
            INSERT INTO bu_item(bu_id, item_id, instrument_id, min_level, max_level, reorder_qty, sort_order)
            VALUES (@buId, @item, @ins, COALESCE(@min, @minDefault), @max, @reorder, COALESCE(@sort, 0)) RETURNING id
            """, new { buId, item = req.ItemId, ins = req.InstrumentId, min = req.MinLevel, minDefault, max = req.MaxLevel, reorder = req.ReorderQty, sort = req.SortOrder }, tx);
    }
}
