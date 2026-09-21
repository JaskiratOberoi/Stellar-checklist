using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

public static class CatalogueEndpoints
{
    public sealed class ItemRow
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string? Category { get; set; }
        public string? Manufacturer { get; set; }
        public string? CatalogueNo { get; set; }
        public string BaseUom { get; set; } = "";
        public decimal PackSize { get; set; }
        public string PackUom { get; set; } = "";
        public bool TracksLot { get; set; }
        public bool TracksExpiry { get; set; }
        public string Storage { get; set; } = "";
        public string? Hazard { get; set; }
        public Guid? InstrumentModelId { get; set; }
        public string? InstrumentModelName { get; set; }
        public decimal? DefaultMinLevel { get; set; }
        public bool IsActive { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public sealed record ItemWrite(string? Code, string? Name, string? Kind, string? Category, string? Manufacturer, string? CatalogueNo,
        string? BaseUom, decimal? PackSize, string? PackUom, bool? TracksLot, bool? TracksExpiry, string? Storage, string? Hazard,
        Guid? InstrumentModelId, bool? ClearInstrumentModel, decimal? DefaultMinLevel, bool? IsActive);

    public sealed class ModelRow
    {
        public Guid Id { get; set; }
        public string Manufacturer { get; set; } = "";
        public string ModelName { get; set; } = "";
        public string Category { get; set; } = "";
        public string? Notes { get; set; }
        public bool IsActive { get; set; }
        public int ItemCount { get; set; }
        public int InstrumentCount { get; set; }
    }

    public sealed record ModelWrite(string? Manufacturer, string? ModelName, string? Category, string? Notes, bool? IsActive);

    public sealed class SupplierRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string? Contact { get; set; }
        public string? Gstin { get; set; }
        public bool IsActive { get; set; }
    }

    public sealed record SupplierWrite(string? Name, string? Contact, string? Gstin, bool? IsActive);

    public const string ItemSelect = """
        SELECT i.id, i.code, i.name, i.kind::text AS kind, i.category, i.manufacturer, i.catalogue_no, i.base_uom, i.pack_size, i.pack_uom,
               i.tracks_lot, i.tracks_expiry, i.storage::text AS storage, i.hazard, i.instrument_model_id,
               CASE WHEN m.id IS NULL THEN NULL ELSE m.manufacturer || ' ' || m.model_name END AS instrument_model_name,
               i.default_min_level, i.is_active, i.updated_at
        FROM item i LEFT JOIN instrument_model m ON m.id = i.instrument_model_id
        """;

    private const string ModelSelect = """
        SELECT m.id, m.manufacturer, m.model_name, m.category, m.notes, m.is_active,
               (SELECT count(*) FROM item i WHERE i.instrument_model_id = m.id AND i.is_active) AS item_count,
               (SELECT count(*) FROM instrument x WHERE x.instrument_model_id = m.id AND x.status <> 'retired') AS instrument_count
        FROM instrument_model m
        """;

    private static readonly string[] Kinds = ["reagent", "calibrator", "control", "consumable", "material"];
    private static readonly string[] Storages = ["room", "fridge_2_8", "freezer_minus20", "freezer_minus80"];

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/catalogue").RequireAuthorization(Policies.User);

        // ---- items ---------------------------------------------------------
        g.MapGet("/items", async (Db db, string? kind, Guid? instrument_model_id, string? q, bool? include_inactive, bool? general_only) =>
        {
            await using var conn = await db.Open();
            var rows = await conn.QueryAsync<ItemRow>(ItemSelect + """
                 WHERE (@kind IS NULL OR i.kind::text = @kind)
                   AND (@model IS NULL OR i.instrument_model_id = @model)
                   AND (NOT @general OR i.instrument_model_id IS NULL)
                   AND (@q IS NULL OR i.name ILIKE '%' || @q || '%' OR i.code ILIKE '%' || @q || '%' OR i.manufacturer ILIKE '%' || @q || '%')
                   AND (@inactive OR i.is_active)
                 ORDER BY i.instrument_model_id NULLS LAST, i.kind, i.name
                """, new { kind, model = instrument_model_id, q, inactive = include_inactive == true, general = general_only == true });
            return Results.Ok(rows);
        });

        g.MapGet("/items/{id:guid}", async (Guid id, Db db) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QuerySingleOrDefaultAsync<ItemRow>(ItemSelect + " WHERE i.id = @id", new { id }) ?? throw ApiException.NotFound("Item"));
        });

        g.MapPost("/items", async (ItemWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.BaseUom))
                throw ApiException.Validation("code, name and base_uom are required");
            if (req.Kind is null || !Kinds.Contains(req.Kind)) throw ApiException.Validation("kind must be one of " + string.Join(", ", Kinds));
            if (req.Storage is not null && !Storages.Contains(req.Storage)) throw ApiException.Validation("storage must be one of " + string.Join(", ", Storages));
            if (req.PackSize is <= 0) throw ApiException.Validation("pack_size must be positive");
            await using var conn = await db.Open();
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM item WHERE code = @c)", new { c = req.Code.Trim().ToUpperInvariant() });
            if (dup) throw ApiException.Conflict("duplicate_code", "An item with this code already exists");
            var id = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO item(code, name, kind, category, manufacturer, catalogue_no, base_uom, pack_size, pack_uom, tracks_lot, tracks_expiry, storage, hazard, instrument_model_id, default_min_level)
                VALUES (@code, @name, @kind::item_kind, @category, @manufacturer, @catNo, @uom, COALESCE(@pack, 1), COALESCE(@packUom, 'pack'),
                        COALESCE(@lot, true), COALESCE(@exp, true), COALESCE(@storage, 'room')::storage_condition, @hazard, @model, @minLevel)
                RETURNING id
                """, new
            {
                code = req.Code.Trim().ToUpperInvariant(), name = req.Name.Trim(), kind = req.Kind, category = req.Category, manufacturer = req.Manufacturer,
                catNo = req.CatalogueNo, uom = req.BaseUom.Trim(), pack = req.PackSize, packUom = req.PackUom, lot = req.TracksLot, exp = req.TracksExpiry,
                storage = req.Storage, hazard = req.Hazard, model = req.InstrumentModelId, minLevel = req.DefaultMinLevel,
            });
            await Audit.Write(conn, null, me, "item.create", "item", id, null, null, req, http);
            return Results.Created($"/api/v1/catalogue/items/{id}", await conn.QuerySingleAsync<ItemRow>(ItemSelect + " WHERE i.id = @id", new { id }));
        });

        g.MapPatch("/items/{id:guid}", async (Guid id, ItemWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            if (req.Kind is not null && !Kinds.Contains(req.Kind)) throw ApiException.Validation("kind must be one of " + string.Join(", ", Kinds));
            if (req.Storage is not null && !Storages.Contains(req.Storage)) throw ApiException.Validation("storage must be one of " + string.Join(", ", Storages));
            if (req.PackSize is <= 0) throw ApiException.Validation("pack_size must be positive");
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<ItemRow>(ItemSelect + " WHERE i.id = @id", new { id }) ?? throw ApiException.NotFound("Item");
            await conn.ExecuteAsync("""
                UPDATE item SET name = COALESCE(@name, name), kind = COALESCE(@kind::item_kind, kind), category = COALESCE(@category, category),
                  manufacturer = COALESCE(@manufacturer, manufacturer), catalogue_no = COALESCE(@catNo, catalogue_no), base_uom = COALESCE(@uom, base_uom),
                  pack_size = COALESCE(@pack, pack_size), pack_uom = COALESCE(@packUom, pack_uom), tracks_lot = COALESCE(@lot, tracks_lot),
                  tracks_expiry = COALESCE(@exp, tracks_expiry), storage = COALESCE(@storage::storage_condition, storage), hazard = COALESCE(@hazard, hazard),
                  instrument_model_id = CASE WHEN @clearModel THEN NULL ELSE COALESCE(@model, instrument_model_id) END,
                  default_min_level = COALESCE(@minLevel, default_min_level), is_active = COALESCE(@active, is_active)
                WHERE id = @id
                """, new
            {
                id, name = req.Name?.Trim(), kind = req.Kind, category = req.Category, manufacturer = req.Manufacturer, catNo = req.CatalogueNo, uom = req.BaseUom?.Trim(),
                pack = req.PackSize, packUom = req.PackUom, lot = req.TracksLot, exp = req.TracksExpiry, storage = req.Storage, hazard = req.Hazard,
                clearModel = req.ClearInstrumentModel == true, model = req.InstrumentModelId, minLevel = req.DefaultMinLevel, active = req.IsActive,
            });
            var after = await conn.QuerySingleAsync<ItemRow>(ItemSelect + " WHERE i.id = @id", new { id });
            await Audit.Write(conn, null, me, "item.update", "item", id, null, before, after, http);
            return Results.Ok(after);
        });

        // ---- instrument models ---------------------------------------------
        g.MapGet("/instrument-models", async (Db db, bool? include_inactive) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync<ModelRow>(ModelSelect + " WHERE (@inactive OR m.is_active) ORDER BY m.manufacturer, m.model_name", new { inactive = include_inactive == true }));
        });

        g.MapGet("/instrument-models/{id:guid}/items", async (Guid id, Db db) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync<ItemRow>(ItemSelect + " WHERE i.instrument_model_id = @id AND i.is_active ORDER BY i.kind, i.name", new { id }));
        });

        g.MapPost("/instrument-models", async (ModelWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            if (string.IsNullOrWhiteSpace(req.Manufacturer) || string.IsNullOrWhiteSpace(req.ModelName) || string.IsNullOrWhiteSpace(req.Category))
                throw ApiException.Validation("manufacturer, model_name and category are required");
            await using var conn = await db.Open();
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM instrument_model WHERE manufacturer = @m AND model_name = @n)", new { m = req.Manufacturer.Trim(), n = req.ModelName.Trim() });
            if (dup) throw ApiException.Conflict("duplicate_model", "This instrument model already exists");
            var id = await conn.ExecuteScalarAsync<Guid>("INSERT INTO instrument_model(manufacturer, model_name, category, notes) VALUES (@m, @n, @c, @notes) RETURNING id",
                new { m = req.Manufacturer.Trim(), n = req.ModelName.Trim(), c = req.Category.Trim(), notes = req.Notes });
            await Audit.Write(conn, null, me, "instrument_model.create", "instrument_model", id, null, null, req, http);
            return Results.Created($"/api/v1/catalogue/instrument-models/{id}", await conn.QuerySingleAsync<ModelRow>(ModelSelect + " WHERE m.id = @id", new { id }));
        });

        g.MapPatch("/instrument-models/{id:guid}", async (Guid id, ModelWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<ModelRow>(ModelSelect + " WHERE m.id = @id", new { id }) ?? throw ApiException.NotFound("Instrument model");
            await conn.ExecuteAsync("UPDATE instrument_model SET manufacturer = COALESCE(@m, manufacturer), model_name = COALESCE(@n, model_name), category = COALESCE(@c, category), notes = COALESCE(@notes, notes), is_active = COALESCE(@active, is_active) WHERE id = @id",
                new { id, m = req.Manufacturer?.Trim(), n = req.ModelName?.Trim(), c = req.Category?.Trim(), notes = req.Notes, active = req.IsActive });
            var after = await conn.QuerySingleAsync<ModelRow>(ModelSelect + " WHERE m.id = @id", new { id });
            await Audit.Write(conn, null, me, "instrument_model.update", "instrument_model", id, null, before, after, http);
            return Results.Ok(after);
        });

        // ---- suppliers -----------------------------------------------------
        g.MapGet("/suppliers", async (Db db, bool? include_inactive) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync<SupplierRow>("SELECT id, name, contact, gstin, is_active FROM supplier WHERE (@inactive OR is_active) ORDER BY name", new { inactive = include_inactive == true }));
        });

        g.MapPost("/suppliers", async (SupplierWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            if (string.IsNullOrWhiteSpace(req.Name)) throw ApiException.Validation("name is required");
            await using var conn = await db.Open();
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM supplier WHERE name = @n)", new { n = req.Name.Trim() });
            if (dup) throw ApiException.Conflict("duplicate_supplier", "This supplier already exists");
            var id = await conn.ExecuteScalarAsync<Guid>("INSERT INTO supplier(name, contact, gstin) VALUES (@n, @c, @g) RETURNING id", new { n = req.Name.Trim(), c = req.Contact, g = req.Gstin });
            await Audit.Write(conn, null, me, "supplier.create", "supplier", id, null, null, req, http);
            return Results.Created($"/api/v1/catalogue/suppliers/{id}", await conn.QuerySingleAsync<SupplierRow>("SELECT id, name, contact, gstin, is_active FROM supplier WHERE id = @id", new { id }));
        });

        g.MapPatch("/suppliers/{id:guid}", async (Guid id, SupplierWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<SupplierRow>("SELECT id, name, contact, gstin, is_active FROM supplier WHERE id = @id", new { id }) ?? throw ApiException.NotFound("Supplier");
            await conn.ExecuteAsync("UPDATE supplier SET name = COALESCE(@n, name), contact = COALESCE(@c, contact), gstin = COALESCE(@g, gstin), is_active = COALESCE(@active, is_active) WHERE id = @id",
                new { id, n = req.Name?.Trim(), c = req.Contact, g = req.Gstin, active = req.IsActive });
            var after = await conn.QuerySingleAsync<SupplierRow>("SELECT id, name, contact, gstin, is_active FROM supplier WHERE id = @id", new { id });
            await Audit.Write(conn, null, me, "supplier.update", "supplier", id, null, before, after, http);
            return Results.Ok(after);
        });
    }
}
