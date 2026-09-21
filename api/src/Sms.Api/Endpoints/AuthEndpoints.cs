using Dapper;
using Sms.Api.Auth;
using Sms.Api.Data;

namespace Sms.Api.Endpoints;

public static class AuthEndpoints
{
    public sealed record LoginRequest(string Email, string Password);
    public sealed record RefreshRequest(string RefreshToken);
    public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

    public sealed class UserRow
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = "";
        public string FullName { get; set; } = "";
        public string? Phone { get; set; }
        public string Role { get; set; } = "";
        public bool IsActive { get; set; }
        public int SessionVersion { get; set; }
        public string PasswordHash { get; set; } = "";
    }

    public sealed class BuSummary
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public string Timezone { get; set; } = "";
        public bool IsDefault { get; set; }
    }

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth");

        g.MapPost("/login", async (LoginRequest req, Db db, JwtIssuer jwt, SmsOptions opt, HttpContext http) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                throw ApiException.Validation("Email and password are required");
            await using var conn = await db.Open();
            var user = await conn.QuerySingleOrDefaultAsync<UserRow>(
                "SELECT id, email::text AS email, full_name, phone, role::text AS role, is_active, session_version, password_hash FROM app_user WHERE email = @email",
                new { email = req.Email.Trim() });
            if (user is null || !user.IsActive || !Bootstrap.Verify(user.PasswordHash, req.Password))
            {
                await Task.Delay(Random.Shared.Next(150, 400));
                throw new ApiException(401, "invalid_credentials", "Email or password is incorrect");
            }

            var (access, expires) = jwt.IssueAccess(user.Id, user.Role, user.FullName, user.SessionVersion);
            var refresh = JwtIssuer.NewRefreshToken();
            await conn.ExecuteAsync(
                "INSERT INTO refresh_token(user_id, token_hash, expires_at) VALUES (@uid, @hash, @exp)",
                new { uid = user.Id, hash = JwtIssuer.Sha256(refresh), exp = DateTime.UtcNow.AddDays(opt.RefreshTokenDays) });
            await conn.ExecuteAsync("UPDATE app_user SET last_login_at = now() WHERE id = @Id", new { user.Id });

            return Results.Ok(new
            {
                access_token = access,
                refresh_token = refresh,
                expires_in = expires,
                user = Profile(user),
                business_units = await BusFor(conn, user),
            });
        }).AllowAnonymous();

        g.MapPost("/refresh", async (RefreshRequest req, Db db, JwtIssuer jwt, SmsOptions opt) =>
        {
            if (string.IsNullOrWhiteSpace(req.RefreshToken)) throw ApiException.Validation("refresh_token required");
            await using var conn = await db.Open();
            await using var tx = await conn.BeginTransactionAsync();
            var hash = JwtIssuer.Sha256(req.RefreshToken);
            var row = await conn.QuerySingleOrDefaultAsync<(Guid id, Guid user_id, DateTime expires_at, DateTime? revoked_at)>(
                "SELECT id, user_id, expires_at, revoked_at FROM refresh_token WHERE token_hash = @hash FOR UPDATE", new { hash }, tx);
            if (row.id == Guid.Empty || row.revoked_at is not null || row.expires_at < DateTime.UtcNow)
                throw new ApiException(401, "invalid_refresh", "Refresh token is invalid or expired");

            var user = await conn.QuerySingleOrDefaultAsync<UserRow>(
                "SELECT id, email::text AS email, full_name, phone, role::text AS role, is_active, session_version, password_hash FROM app_user WHERE id = @id",
                new { id = row.user_id }, tx);
            if (user is null || !user.IsActive) throw new ApiException(401, "invalid_refresh", "User is inactive");

            // Rotate: revoke the presented token, issue a new one.
            await conn.ExecuteAsync("UPDATE refresh_token SET revoked_at = now() WHERE id = @id", new { row.id }, tx);
            var refresh = JwtIssuer.NewRefreshToken();
            await conn.ExecuteAsync(
                "INSERT INTO refresh_token(user_id, token_hash, expires_at) VALUES (@uid, @hash, @exp)",
                new { uid = user.Id, hash = JwtIssuer.Sha256(refresh), exp = DateTime.UtcNow.AddDays(opt.RefreshTokenDays) }, tx);
            await tx.CommitAsync();

            var (access, expires) = jwt.IssueAccess(user.Id, user.Role, user.FullName, user.SessionVersion);
            return Results.Ok(new { access_token = access, refresh_token = refresh, expires_in = expires, user = Profile(user), business_units = await BusFor(conn, user) });
        }).AllowAnonymous();

        g.MapPost("/logout", async (RefreshRequest req, Db db) =>
        {
            await using var conn = await db.Open();
            await conn.ExecuteAsync("UPDATE refresh_token SET revoked_at = now() WHERE token_hash = @hash AND revoked_at IS NULL",
                new { hash = JwtIssuer.Sha256(req.RefreshToken ?? "") });
            return Results.NoContent();
        }).AllowAnonymous();

        g.MapPost("/logout-all", async (HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            await conn.ExecuteAsync("UPDATE refresh_token SET revoked_at = now() WHERE user_id = @id AND revoked_at IS NULL; UPDATE app_user SET session_version = session_version + 1 WHERE id = @id",
                new { id = me.UserId });
            return Results.NoContent();
        }).RequireAuthorization(Policies.User);

        g.MapGet("/me", async (HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            await using var conn = await db.Open();
            var user = await conn.QuerySingleAsync<UserRow>(
                "SELECT id, email::text AS email, full_name, phone, role::text AS role, is_active, session_version, password_hash FROM app_user WHERE id = @id", new { id = me.UserId });
            return Results.Ok(new { user = Profile(user), business_units = await BusFor(conn, user) });
        }).RequireAuthorization(Policies.User);

        g.MapPost("/change-password", async (ChangePasswordRequest req, HttpContext http, Db db) =>
        {
            var me = Current.From(http.User);
            if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 8)
                throw ApiException.Validation("New password must be at least 8 characters");
            await using var conn = await db.Open();
            var hash = await conn.ExecuteScalarAsync<string>("SELECT password_hash FROM app_user WHERE id = @id", new { id = me.UserId });
            if (hash is null || !Bootstrap.Verify(hash, req.CurrentPassword)) throw new ApiException(400, "wrong_password", "Current password is incorrect");
            await conn.ExecuteAsync("UPDATE app_user SET password_hash = @hash WHERE id = @id", new { hash = Bootstrap.Hash(req.NewPassword), id = me.UserId });
            await Audit.Write(conn, null, me, "user.change_password", "app_user", me.UserId, null, http: http);
            return Results.NoContent();
        }).RequireAuthorization(Policies.User);
    }

    public static object Profile(UserRow u) => new
    {
        id = u.Id, email = u.Email, full_name = u.FullName, phone = u.Phone, role = u.Role,
        capabilities = Roles.Capabilities(u.Role),
    };

    public static async Task<IReadOnlyList<BuSummary>> BusFor(Npgsql.NpgsqlConnection conn, UserRow u)
    {
        var sql = Roles.IsGlobal(u.Role)
            ? "SELECT id, code, name, timezone, false AS is_default FROM business_unit WHERE is_active ORDER BY code"
            : "SELECT b.id, b.code, b.name, b.timezone, m.is_default FROM bu_membership m JOIN business_unit b ON b.id = m.bu_id WHERE m.user_id = @id AND b.is_active ORDER BY m.is_default DESC, b.code";
        return (await conn.QueryAsync<BuSummary>(sql, new { id = u.Id })).ToList();
    }
}
