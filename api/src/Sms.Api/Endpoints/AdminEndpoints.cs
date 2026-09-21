using System.Security.Cryptography;
using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;
using Sms.Api.Jobs;

namespace Sms.Api.Endpoints;

public static class AdminEndpoints
{
    public sealed class UserRow
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = "";
        public string FullName { get; set; } = "";
        public string? Phone { get; set; }
        public string Role { get; set; } = "";
        public bool IsActive { get; set; }
        public DateTime? LastLoginAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public string[] BuCodes { get; set; } = [];
        public Guid[] BuIds { get; set; } = [];
    }

    public sealed record UserWrite(string? Email, string? FullName, string? Phone, string? Role, string? Password, bool? IsActive, Guid[]? BuIds);
    public sealed record ApiKeyWrite(string Name, string[] Scopes, string[]? AllowedIps);
    public sealed record RunSnapshots(Guid? BuId, string? PeriodType, DateOnly? PeriodStart);

    private const string UserSelect = """
        SELECT u.id, u.email::text AS email, u.full_name, u.phone, u.role::text AS role, u.is_active, u.last_login_at, u.created_at,
               COALESCE(ARRAY(SELECT b.code FROM bu_membership m JOIN business_unit b ON b.id = m.bu_id WHERE m.user_id = u.id ORDER BY b.code), '{}') AS bu_codes,
               COALESCE(ARRAY(SELECT m.bu_id FROM bu_membership m WHERE m.user_id = u.id), '{}'::uuid[]) AS bu_ids
        FROM app_user u
        """;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin").RequireAuthorization(Policies.Admin);

        // ---- users ---------------------------------------------------------
        g.MapGet("/users", async (Db db, string? q, string? role, bool? include_inactive) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync<UserRow>(UserSelect + """
                 WHERE (@q IS NULL OR u.full_name ILIKE '%' || @q || '%' OR u.email ILIKE '%' || @q || '%')
                   AND (@role IS NULL OR u.role::text = @role) AND (@inactive OR u.is_active)
                 ORDER BY u.role, u.full_name
                """, new { q, role, inactive = include_inactive == true }));
        });

        g.MapPost("/users", async (UserWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.FullName)) throw ApiException.Validation("email and full_name are required");
            var role = req.Role ?? Roles.LabTech;
            if (!Roles.All.Contains(role)) throw ApiException.Validation("Invalid role");
            if (role == Roles.SuperAdmin && !me.IsSuperAdmin) throw ApiException.Forbidden("Only a super_admin can create super_admins");
            if (role == Roles.Admin && !me.IsSuperAdmin) throw ApiException.Forbidden("Only a super_admin can create admins");
            var password = string.IsNullOrWhiteSpace(req.Password) ? TempPassword() : req.Password;
            if (password.Length < 8) throw ApiException.Validation("Password must be at least 8 characters");

            await using var conn = await db.Open();
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM app_user WHERE email = @e)", new { e = req.Email.Trim() });
            if (dup) throw ApiException.Conflict("duplicate_email", "A user with this email already exists");
            await using var tx = await conn.BeginTransactionAsync();
            var id = await conn.ExecuteScalarAsync<Guid>("INSERT INTO app_user(email, full_name, phone, password_hash, role) VALUES (@e, @n, @p, @h, @r::user_role) RETURNING id",
                new { e = req.Email.Trim(), n = req.FullName.Trim(), p = req.Phone, h = Bootstrap.Hash(password), r = role }, tx);
            if (!Roles.IsGlobal(role))
            {
                var first = true;
                foreach (var bu in req.BuIds ?? [])
                {
                    await conn.ExecuteAsync("INSERT INTO bu_membership(user_id, bu_id, is_default) VALUES (@id, @bu, @first)", new { id, bu, first }, tx);
                    first = false;
                }
            }
            await Audit.Write(conn, tx, me, "user.create", "app_user", id, null, null, new { req.Email, req.FullName, role, req.BuIds }, http);
            await tx.CommitAsync();
            var row = await conn.QuerySingleAsync<UserRow>(UserSelect + " WHERE u.id = @id", new { id });
            return Results.Created($"/api/v1/admin/users/{id}", new { user = row, temporary_password = string.IsNullOrWhiteSpace(req.Password) ? password : null });
        });

        g.MapPatch("/users/{id:guid}", async (Guid id, UserWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            var before = await conn.QuerySingleOrDefaultAsync<UserRow>(UserSelect + " WHERE u.id = @id", new { id }) ?? throw ApiException.NotFound("User");
            if ((before.Role is Roles.SuperAdmin or Roles.Admin || req.Role is Roles.SuperAdmin or Roles.Admin) && !me.IsSuperAdmin)
                throw ApiException.Forbidden("Only a super_admin can manage admins");
            if (req.Role is not null && !Roles.All.Contains(req.Role)) throw ApiException.Validation("Invalid role");
            if (id == me.UserId && (req.IsActive == false || (req.Role is not null && req.Role != before.Role))) throw ApiException.Validation("You cannot deactivate or change the role of your own account");

            await using var tx = await conn.BeginTransactionAsync();
            var roleChanged = req.Role is not null && req.Role != before.Role;
            var deactivated = req.IsActive == false && before.IsActive;
            await conn.ExecuteAsync("""
                UPDATE app_user SET full_name = COALESCE(@n, full_name), phone = COALESCE(@p, phone), role = COALESCE(@r::user_role, role), is_active = COALESCE(@a, is_active),
                  session_version = session_version + CASE WHEN @bump THEN 1 ELSE 0 END
                WHERE id = @id
                """, new { id, n = req.FullName?.Trim(), p = req.Phone, r = req.Role, a = req.IsActive, bump = roleChanged || deactivated }, tx);
            if (deactivated) await conn.ExecuteAsync("UPDATE refresh_token SET revoked_at = now() WHERE user_id = @id AND revoked_at IS NULL", new { id }, tx);
            if (req.BuIds is not null)
            {
                await conn.ExecuteAsync("DELETE FROM bu_membership WHERE user_id = @id", new { id }, tx);
                var newRole = req.Role ?? before.Role;
                if (!Roles.IsGlobal(newRole))
                {
                    var first = true;
                    foreach (var bu in req.BuIds) { await conn.ExecuteAsync("INSERT INTO bu_membership(user_id, bu_id, is_default) VALUES (@id, @bu, @first)", new { id, bu, first }, tx); first = false; }
                }
            }
            var after = await conn.QuerySingleAsync<UserRow>(UserSelect + " WHERE u.id = @id", new { id }, tx);
            await Audit.Write(conn, tx, me, "user.update", "app_user", id, null, before, after, http);
            await tx.CommitAsync();
            return Results.Ok(after);
        });

        g.MapPost("/users/{id:guid}/reset-password", async (Guid id, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            var target = await conn.QuerySingleOrDefaultAsync<UserRow>(UserSelect + " WHERE u.id = @id", new { id }) ?? throw ApiException.NotFound("User");
            if (target.Role is Roles.SuperAdmin or Roles.Admin && !me.IsSuperAdmin) throw ApiException.Forbidden("Only a super_admin can reset an admin's password");
            var password = TempPassword();
            await conn.ExecuteAsync("UPDATE app_user SET password_hash = @h, session_version = session_version + 1 WHERE id = @id; UPDATE refresh_token SET revoked_at = now() WHERE user_id = @id AND revoked_at IS NULL",
                new { id, h = Bootstrap.Hash(password) });
            await Audit.Write(conn, null, me, "user.reset_password", "app_user", id, null, http: http);
            return Results.Ok(new { temporary_password = password });
        });

        // ---- api keys (super_admin) ----------------------------------------
        g.MapGet("/api-keys", async (HttpContext http, Db db) =>
        {
            Current.From(http.User).RequireSuperAdmin();
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync("SELECT id, name, key_prefix, scopes, allowed_ips::text[] AS allowed_ips, is_active, last_used_at, created_at, revoked_at FROM api_client ORDER BY created_at DESC"));
        });

        g.MapPost("/api-keys", async (ApiKeyWrite req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireSuperAdmin();
            if (string.IsNullOrWhiteSpace(req.Name)) throw ApiException.Validation("name is required");
            var bad = (req.Scopes ?? []).Where(s => !Scopes.All.Contains(s)).ToArray();
            if (bad.Length > 0) throw ApiException.Validation("Unknown scopes: " + string.Join(", ", bad), new { valid = Scopes.All });
            var key = "sms_live_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            await using var conn = await db.Open();
            var dup = await conn.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM api_client WHERE name = @n)", new { n = req.Name.Trim() });
            if (dup) throw ApiException.Conflict("duplicate_name", "An API key with this name already exists");
            var id = await conn.ExecuteScalarAsync<Guid>("INSERT INTO api_client(name, key_prefix, key_hash, scopes, allowed_ips, created_by) VALUES (@n, @prefix, @hash, @scopes, @ips::inet[], @uid) RETURNING id",
                new { n = req.Name.Trim(), prefix = key[..17], hash = JwtIssuer.Sha256(key), scopes = req.Scopes ?? [], ips = req.AllowedIps is { Length: > 0 } ? req.AllowedIps : null, uid = me.UserId });
            await Audit.Write(conn, null, me, "api_key.create", "api_client", id, null, null, new { req.Name, req.Scopes, req.AllowedIps }, http);
            return Results.Created($"/api/v1/admin/api-keys/{id}", new { id, name = req.Name, key, scopes = req.Scopes, note = "Store this key now; it is not shown again." });
        });

        g.MapPost("/api-keys/{id:guid}/revoke", async (Guid id, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User); me.RequireSuperAdmin();
            await using var conn = await db.Open();
            var n = await conn.ExecuteAsync("UPDATE api_client SET is_active = false, revoked_at = now() WHERE id = @id AND revoked_at IS NULL", new { id });
            if (n == 0) throw ApiException.NotFound("Active API key");
            await Audit.Write(conn, null, me, "api_key.revoke", "api_client", id, null, http: http);
            return Results.NoContent();
        });

        // ---- audit + jobs --------------------------------------------------
        g.MapGet("/audit", async (Db db, string? entity_type, string? entity_id, Guid? bu_id, Guid? actor, string? action, DateTime? from, DateTime? to, int? limit, long? before_id) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync("""
                SELECT a.id, a.at, a.actor_user_id, u.full_name AS actor_name, a.actor_client_id, c.name AS client_name, a.action, a.entity_type, a.entity_id, a.bu_id, b.code AS bu_code,
                       a.before::text AS before, a.after::text AS after, a.ip::text AS ip
                FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id LEFT JOIN api_client c ON c.id = a.actor_client_id LEFT JOIN business_unit b ON b.id = a.bu_id
                WHERE (@et IS NULL OR a.entity_type = @et) AND (@eid IS NULL OR a.entity_id = @eid) AND (@bu IS NULL OR a.bu_id = @bu) AND (@actor IS NULL OR a.actor_user_id = @actor)
                  AND (@action IS NULL OR a.action ILIKE @action || '%') AND (@from::timestamptz IS NULL OR a.at >= @from::timestamptz) AND (@to::timestamptz IS NULL OR a.at <= @to::timestamptz) AND (@before IS NULL OR a.id < @before)
                ORDER BY a.id DESC LIMIT @limit
                """, new { et = entity_type, eid = entity_id, bu = bu_id, actor, action, from = from?.ToUniversalTime(), to = to?.ToUniversalTime(), before = before_id, limit = Math.Clamp(limit ?? 100, 1, 500) }));
        });

        g.MapGet("/jobs", async (Db db) =>
        {
            await using var conn = await db.Open();
            return Results.Ok(await conn.QueryAsync("SELECT id, job_name, started_at, finished_at, status, message FROM job_run ORDER BY id DESC LIMIT 50"));
        });

        g.MapPost("/jobs/snapshots/run", async (RunSnapshots? req, HttpContext http, Db db, SnapshotBuilder builder, SmsOptions opt) =>
        {
            var me = Current.From(http.User); me.RequireSuperAdmin();
            if (req?.BuId is null) { await builder.RunAllAsync(http.RequestAborted); return Results.Ok(new { ran = "all" }); }
            var n = await builder.BuildAsync(req.BuId.Value, req.PeriodType ?? "month", req.PeriodStart ?? Periods.TodayIn(opt.DefaultTimezone), http.RequestAborted);
            return Results.Ok(new { ran = req.BuId, rows = n });
        });
    }

    private static string TempPassword()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        var bytes = RandomNumberGenerator.GetBytes(10);
        return "Sms-" + new string(bytes.Select(b => alphabet[b % alphabet.Length]).ToArray());
    }
}
