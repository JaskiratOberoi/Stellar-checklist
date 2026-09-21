using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

public static class BusinessUnitEndpoints
{
    public sealed class BuRow
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public string BuType { get; set; } = "";
        public string? Address { get; set; }
        public string Timezone { get; set; } = "";
        public TimeOnly OpeningDueTime { get; set; }
        public TimeOnly ClosingDueTime { get; set; }
        public int GraceMinutes { get; set; }
        public decimal VarianceTolerancePct { get; set; }
        public bool IsActive { get; set; }
        public int InstrumentCount { get; set; }
        public int ItemCount { get; set; }
        public int MemberCount { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public sealed record BuWrite(string? Code, string? Name, string? BuType, string? Address, string? Timezone,
        TimeOnly? OpeningDueTime, TimeOnly? ClosingDueTime, int? GraceMinutes, decimal? VarianceTolerancePct, bool? IsActive);

    public sealed class InstrumentRow
    {
        public Guid Id { get; set; }
        public Guid BuId { get; set; }
        public Guid InstrumentModelId { get; set; }
        public string Manufacturer { get; set; } = "";
        public string ModelName { get; set; } = "";
        public string Category { get; set; } = "";
        public string SerialNo { get; set; } = "";
        public string? AssetTag { get; set; }
        public string? Label { get; set; }
        public DateOnly? InstalledOn { get; set; }
        public string Status { get; set; } = "";
        public string? Notes { get; set; }
        public int TrackedItemCount { get; set; }
    }

    public sealed record InstrumentWrite(Guid? InstrumentModelId, string? SerialNo, string? AssetTag, string? Label,
        DateOnly? InstalledOn, string? Status, string? Notes);

    public sealed record MemberWrite(Guid UserId, bool? IsDefault);

    private const string BuSelect = """
        SELECT b.*,
               (SELECT count(*) FROM instrument i WHERE i.bu_id = b.id AND i.status <> 'retired') AS instrument_count,
               (SELECT count(*) FROM bu_item bi WHERE bi.bu_id = b.id AND bi.is_active) AS item_count,
               (SELECT count(*) FROM bu_membership m WHERE m.bu_id = b.id) AS member_count
        FROM (SELECT id, code, name, bu_type::text AS bu_type, address, timezone, opening_due_time, closing_due_time,
                     grace_minutes, variance_tolerance_pct, is_active, created_at, updated_at FROM business_unit) b
        """;

    private const string InstrumentSelect = """
        SELECT i.id, i.bu_id, i.instrument_model_id, m.manufacturer, m.model_name, m.category, i.serial_no, i.asset_tag,
               i.label, i.installed_on, i.status::text AS status, i.notes,
               (SELECT count(*) FROM bu_item bi WHERE bi.instrument_id = i.id AND bi.is_active) AS tracked_item_count
        FROM instrument i JOIN instrument_model m ON m.id = i.instrument_model_id
        """;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/bus").RequireAuthorization(Policies.User);

        g.MapGet("", async (HttpContext http, Db db, bool? include_inactive) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            var visible = await me.VisibleBus(conn);
            var rows = await conn.QueryAsync<BuRow>(
                BuSelect + " WHERE (@all OR b.id = ANY(@ids)) AND (@inactive OR b.is_active) ORDER BY b.code",
                new { all = visible is null, ids = visible ?? [], inactive = include_inactive == true && me.IsAdmin });
            return Results.Ok(rows);
        });

        g.MapGet("/{buId:guid}", async (Guid buId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var row = await conn.QuerySingleOrDefaultAsync<BuRow>(BuSelect + " WHERE b.id = @buId", new { buId })
                      ?? throw ApiException.NotFound("Business unit");
            return Results.Ok(row);
        });

        g.MapPost("", async (BuWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name)) throw ApiException.Validation("code and name are required");
            await using var conn = await db.Open();
            var exists = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM business_unit WHERE code = @c)", new { c = req.Code.Trim().ToUpperInvariant() });
            if (exists) throw ApiException.Conflict("duplicate_code", "A business unit with this code already exists");
            var id = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO business_unit(code, name, bu_type, address, timezone, opening_due_time, closing_due_time, grace_minutes, variance_tolerance_pct)
                VALUES (@code, @name, COALESCE(@buType, 'lab')::bu_type, @address, COALESCE(@tz, 'Asia/Kolkata'),
                        COALESCE(@open, '09:00'::time), COALESCE(@close, '21:00'::time), COALESCE(@grace, 30), COALESCE(@tol, 5))
                RETURNING id
                """, new
            {
                code = req.Code.Trim().ToUpperInvariant(), name = req.Name.Trim(), buType = req.BuType, address = req.Address,
                tz = req.Timezone, open = req.OpeningDueTime, close = req.ClosingDueTime, grace = req.GraceMinutes, tol = req.VarianceTolerancePct,
            });
            await Audit.Write(conn, null, me, "bu.create", "business_unit", id, id, null, req, http);
            var row = await conn.QuerySingleAsync<BuRow>(BuSelect + " WHERE b.id = @id", new { id });
            return Results.Created($"/api/v1/bus/{id}", row);
        });

        g.MapPatch("/{buId:guid}", async (Guid buId, BuWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireAdmin();
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<BuRow>(BuSelect + " WHERE b.id = @buId", new { buId }) ?? throw ApiException.NotFound("Business unit");
            await conn.ExecuteAsync("""
                UPDATE business_unit SET
                  name = COALESCE(@name, name), bu_type = COALESCE(@buType::bu_type, bu_type), address = COALESCE(@address, address),
                  timezone = COALESCE(@tz, timezone), opening_due_time = COALESCE(@open, opening_due_time),
                  closing_due_time = COALESCE(@close, closing_due_time), grace_minutes = COALESCE(@grace, grace_minutes),
                  variance_tolerance_pct = COALESCE(@tol, variance_tolerance_pct), is_active = COALESCE(@active, is_active)
                WHERE id = @buId
                """, new
            {
                buId, name = req.Name?.Trim(), buType = req.BuType, address = req.Address, tz = req.Timezone, open = req.OpeningDueTime,
                close = req.ClosingDueTime, grace = req.GraceMinutes, tol = req.VarianceTolerancePct, active = req.IsActive,
            });
            var after = await conn.QuerySingleAsync<BuRow>(BuSelect + " WHERE b.id = @buId", new { buId });
            await Audit.Write(conn, null, me, "bu.update", "business_unit", buId, buId, before, after, http);
            return Results.Ok(after);
        });

        // ---- instruments ---------------------------------------------------
        g.MapGet("/{buId:guid}/instruments", async (Guid buId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync<InstrumentRow>(InstrumentSelect + " WHERE i.bu_id = @buId ORDER BY i.status = 'retired', m.manufacturer, m.model_name, i.serial_no", new { buId });
            return Results.Ok(rows);
        });

        g.MapPost("/{buId:guid}/instruments", async (Guid buId, InstrumentWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            if (req.InstrumentModelId is null || string.IsNullOrWhiteSpace(req.SerialNo)) throw ApiException.Validation("instrument_model_id and serial_no are required");
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM instrument WHERE bu_id = @buId AND serial_no = @s)", new { buId, s = req.SerialNo.Trim() });
            if (dup) throw ApiException.Conflict("duplicate_serial", "An instrument with this serial number already exists in this business unit");
            var id = await conn.ExecuteScalarAsync<Guid>("""
                INSERT INTO instrument(bu_id, instrument_model_id, serial_no, asset_tag, label, installed_on, notes)
                VALUES (@buId, @model, @serial, @tag, @label, @installed, @notes) RETURNING id
                """, new { buId, model = req.InstrumentModelId, serial = req.SerialNo.Trim(), tag = req.AssetTag, label = req.Label, installed = req.InstalledOn, notes = req.Notes });
            await Audit.Write(conn, null, me, "instrument.create", "instrument", id, buId, null, req, http);

            var row = await conn.QuerySingleAsync<InstrumentRow>(InstrumentSelect + " WHERE i.id = @id", new { id });
            var proposed = await conn.QueryAsync<CatalogueEndpoints.ItemRow>(
                CatalogueEndpoints.ItemSelect + " WHERE i.instrument_model_id = @model AND i.is_active AND NOT EXISTS (SELECT 1 FROM bu_item bi WHERE bi.bu_id = @buId AND bi.item_id = i.id AND bi.instrument_id = @id) ORDER BY i.kind, i.name",
                new { model = req.InstrumentModelId, buId, id });
            return Results.Created($"/api/v1/bus/{buId}/instruments/{id}", new { instrument = row, proposed_items = proposed });
        });

        api.MapPatch("/instruments/{id:guid}", async (Guid id, InstrumentWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<InstrumentRow>(InstrumentSelect + " WHERE i.id = @id", new { id }) ?? throw ApiException.NotFound("Instrument");
            await me.RequireBu(conn, before.BuId);
            if (req.Status is not null && req.Status is not ("active" or "down" or "retired")) throw ApiException.Validation("status must be active, down or retired");
            await conn.ExecuteAsync("""
                UPDATE instrument SET serial_no = COALESCE(@serial, serial_no), asset_tag = COALESCE(@tag, asset_tag), label = COALESCE(@label, label),
                  installed_on = COALESCE(@installed, installed_on), status = COALESCE(@status::instrument_status, status), notes = COALESCE(@notes, notes)
                WHERE id = @id
                """, new { id, serial = req.SerialNo?.Trim(), tag = req.AssetTag, label = req.Label, installed = req.InstalledOn, status = req.Status, notes = req.Notes });
            var after = await conn.QuerySingleAsync<InstrumentRow>(InstrumentSelect + " WHERE i.id = @id", new { id });
            await Audit.Write(conn, null, me, "instrument.update", "instrument", id, before.BuId, before, after, http);
            return Results.Ok(after);
        }).RequireAuthorization(Policies.User);

        // ---- members -------------------------------------------------------
        g.MapGet("/{buId:guid}/members", async (Guid buId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var rows = await conn.QueryAsync(
                "SELECT u.id, u.email::text AS email, u.full_name, u.role::text AS role, u.is_active, m.is_default, m.created_at FROM bu_membership m JOIN app_user u ON u.id = m.user_id WHERE m.bu_id = @buId ORDER BY u.full_name",
                new { buId });
            return Results.Ok(rows);
        });

        g.MapPost("/{buId:guid}/members", async (Guid buId, MemberWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            var role = await conn.ExecuteScalarAsync<string>("SELECT role::text FROM app_user WHERE id = @id", new { id = req.UserId }) ?? throw ApiException.NotFound("User");
            if (Roles.IsGlobal(role)) throw ApiException.Validation("Admins see every business unit; membership is not needed");
            await conn.ExecuteAsync("INSERT INTO bu_membership(user_id, bu_id, is_default) VALUES (@u, @b, @d) ON CONFLICT (user_id, bu_id) DO UPDATE SET is_default = EXCLUDED.is_default",
                new { u = req.UserId, b = buId, d = req.IsDefault == true });
            await Audit.Write(conn, null, me, "bu.member_add", "bu_membership", $"{req.UserId}:{buId}", buId, null, req, http);
            return Results.NoContent();
        });

        g.MapDelete("/{buId:guid}/members/{userId:guid}", async (Guid buId, Guid userId, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireManager();
            await using var conn = await db.Open();
            await me.RequireBu(conn, buId);
            await conn.ExecuteAsync("DELETE FROM bu_membership WHERE user_id = @userId AND bu_id = @buId", new { userId, buId });
            await Audit.Write(conn, null, me, "bu.member_remove", "bu_membership", $"{userId}:{buId}", buId, http: http);
            return Results.NoContent();
        });
    }
}
