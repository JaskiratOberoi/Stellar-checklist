using Dapper;
using Microsoft.AspNetCore.Identity;
using Sms.Api.Data;

namespace Sms.Api.Auth;

/// <summary>
/// Creates the first super_admin when the user table is empty, so a fresh
/// deployment can be signed into without touching the database by hand.
/// With SMS_SEED_DEV=true also creates a manager and a tech on the seed BUs.
/// </summary>
public sealed class Bootstrap(Db db, SmsOptions options, ILogger<Bootstrap> log)
{
    public static readonly PasswordHasher<object> Hasher = new();
    public static string Hash(string password) => Hasher.HashPassword(new object(), password);
    public static bool Verify(string hash, string password)
        => Hasher.VerifyHashedPassword(new object(), hash, password) != PasswordVerificationResult.Failed;

    public async Task RunAsync(CancellationToken ct)
    {
        await using var conn = await db.Open(ct);
        var users = await conn.ExecuteScalarAsync<int>("SELECT count(*) FROM app_user");
        if (users > 0) return;

        await conn.ExecuteAsync(
            "INSERT INTO app_user(email, full_name, password_hash, role) VALUES (@email, 'Super Admin', @hash, 'super_admin')",
            new { email = options.BootstrapAdminEmail, hash = Hash(options.BootstrapAdminPassword) });
        log.LogWarning("Bootstrapped super_admin {Email}. Change the password after first sign-in.", options.BootstrapAdminEmail);

        if (!options.SeedDev) return;
        var bus = (await conn.QueryAsync<(Guid id, string code)>("SELECT id, code FROM business_unit ORDER BY code")).ToList();
        if (bus.Count == 0) return;

        async Task Add(string email, string name, string role, string password, IEnumerable<Guid> buIds)
        {
            var id = await conn.ExecuteScalarAsync<Guid>(
                "INSERT INTO app_user(email, full_name, password_hash, role) VALUES (@email, @name, @hash, @role::user_role) RETURNING id",
                new { email, name, hash = Hash(password), role });
            var first = true;
            foreach (var bu in buIds)
            {
                await conn.ExecuteAsync("INSERT INTO bu_membership(user_id, bu_id, is_default) VALUES (@id, @bu, @first)", new { id, bu, first });
                first = false;
            }
        }

        await Add("admin.ops@sms.local", "Ops Admin", Roles.Admin, "Admin123!", []);
        await Add("manager@sms.local", "Priya Manager", Roles.BuManager, "Manager123!", bus.Select(b => b.id));
        await Add("tech@sms.local", "Rahul Tech", Roles.LabTech, "Tech123!", [bus[0].id]);
        await Add("viewer@sms.local", "QA Viewer", Roles.Viewer, "Viewer123!", bus.Select(b => b.id));
        log.LogWarning("Dev users seeded: admin.ops@sms.local / manager@sms.local / tech@sms.local / viewer@sms.local");
    }
}
