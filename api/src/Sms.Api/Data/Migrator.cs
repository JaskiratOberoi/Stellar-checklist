using Dapper;
using Npgsql;

namespace Sms.Api.Data;

/// <summary>
/// Applies db/sql/*.sql in filename order, once each, recorded in sms_migration.
/// Each script runs inside one transaction. Mirrors Infinity's apply.ps1 but
/// runs at API start so a compose deploy is self-contained.
/// </summary>
public sealed class Migrator(Db db, SmsOptions options, ILogger<Migrator> log)
{
    public async Task ApplyAsync(CancellationToken ct)
    {
        if (!Directory.Exists(options.SqlDir))
        {
            log.LogWarning("SQL directory {Dir} not found; skipping migrations", options.SqlDir);
            return;
        }

        await using var conn = await db.Open(ct);
        await conn.ExecuteAsync("CREATE TABLE IF NOT EXISTS sms_migration (script text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        var applied = (await conn.QueryAsync<string>("SELECT script FROM sms_migration")).ToHashSet(StringComparer.Ordinal);

        var any = false;
        foreach (var file in Directory.GetFiles(options.SqlDir, "*.sql").OrderBy(f => Path.GetFileName(f), StringComparer.Ordinal))
        {
            var name = Path.GetFileName(file);
            if (applied.Contains(name)) continue;
            var sql = await File.ReadAllTextAsync(file, ct);
            log.LogInformation("Applying {Script}", name);
            await using var tx = await conn.BeginTransactionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition(sql, transaction: tx, cancellationToken: ct));
            await conn.ExecuteAsync("INSERT INTO sms_migration(script) VALUES (@name) ON CONFLICT DO NOTHING", new { name }, tx);
            await tx.CommitAsync(ct);
            any = true;
        }
        // Scripts create enums and extensions (citext); Npgsql cached the type catalog before they existed.
        if (any) await db.ReloadTypes(ct);
    }

    /// <summary>Dev-only sample data. Applied when SMS_SEED_DEV=true and no business unit exists.</summary>
    public async Task SeedDevAsync(CancellationToken ct)
    {
        if (!options.SeedDev) return;
        var file = Path.Combine(options.SeedDir, "dev.sql");
        if (!File.Exists(file)) { log.LogWarning("Seed file {File} not found", file); return; }
        await using var conn = await db.Open(ct);
        var buCount = await conn.ExecuteScalarAsync<int>("SELECT count(*) FROM business_unit");
        if (buCount > 0) return;
        log.LogInformation("Seeding dev data from {File}", file);
        var sql = await File.ReadAllTextAsync(file, ct);
        await conn.ExecuteAsync(sql);
    }
}
