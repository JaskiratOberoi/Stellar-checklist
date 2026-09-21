using System.Text;

namespace Sms.Api;

/// <summary>
/// Every runtime setting, read once from SMS_* environment variables (or
/// appsettings for local runs). Validated at startup so a half-configured
/// deployment fails the deploy rather than the first request.
/// </summary>
public sealed class SmsOptions
{
    public required string DbConnection { get; init; }
    public required byte[] JwtKey { get; init; }
    public required string JwtIssuer { get; init; }
    public int AccessTokenMinutes { get; init; } = 15;
    public int RefreshTokenDays { get; init; } = 30;
    public string[] CorsOrigins { get; init; } = [];
    public string PublicUrl { get; init; } = "";
    public string DefaultTimezone { get; init; } = "Asia/Kolkata";
    public string SqlDir { get; init; } = "";
    public string SeedDir { get; init; } = "";
    public bool SeedDev { get; init; }
    public string BootstrapAdminEmail { get; init; } = "admin@sms.local";
    public string BootstrapAdminPassword { get; init; } = "ChangeMe123!";
    public string SnapshotJobTime { get; init; } = "00:30";

    public static SmsOptions From(IConfiguration c)
    {
        string Get(string key, string? fallback = null)
            => c[key] ?? fallback ?? throw new InvalidOperationException($"{key} is not set");

        var key = Get("SMS_JWT_SIGNING_KEY");
        byte[] keyBytes;
        try { keyBytes = Convert.FromBase64String(key); }
        catch { keyBytes = Encoding.UTF8.GetBytes(key); }
        if (keyBytes.Length < 32)
            throw new InvalidOperationException("SMS_JWT_SIGNING_KEY must be at least 32 bytes");

        var baseDir = AppContext.BaseDirectory;
        return new SmsOptions
        {
            DbConnection = Get("SMS_DB_CONNECTION"),
            JwtKey = keyBytes,
            JwtIssuer = Get("SMS_JWT_ISSUER", "sms-api"),
            AccessTokenMinutes = int.TryParse(c["SMS_ACCESS_TOKEN_MINUTES"], out var am) ? am : 15,
            RefreshTokenDays = int.TryParse(c["SMS_REFRESH_TOKEN_DAYS"], out var rd) ? rd : 30,
            CorsOrigins = (c["SMS_CORS_ORIGINS"] ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            PublicUrl = c["SMS_PUBLIC_URL"] ?? "",
            DefaultTimezone = c["SMS_TIMEZONE_DEFAULT"] ?? "Asia/Kolkata",
            SqlDir = c["SMS_SQL_DIR"] ?? Path.Combine(baseDir, "db", "sql"),
            SeedDir = c["SMS_SEED_DIR"] ?? Path.Combine(baseDir, "db", "seed"),
            SeedDev = string.Equals(c["SMS_SEED_DEV"], "true", StringComparison.OrdinalIgnoreCase),
            BootstrapAdminEmail = c["SMS_BOOTSTRAP_ADMIN_EMAIL"] ?? "admin@sms.local",
            BootstrapAdminPassword = c["SMS_BOOTSTRAP_ADMIN_PASSWORD"] ?? "ChangeMe123!",
            SnapshotJobTime = c["SMS_SNAPSHOT_JOB_TIME"] ?? "00:30",
        };
    }
}
