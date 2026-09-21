using Dapper;
using Npgsql;

namespace Sms.Api.Data;

public static class Periods
{
    public static DateOnly WeekStart(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7)); // Monday
    public static DateOnly MonthStart(DateOnly d) => new(d.Year, d.Month, 1);

    public static (DateOnly start, DateOnly end) Range(string periodType, DateOnly start)
    {
        return periodType switch
        {
            "week" => (WeekStart(start), WeekStart(start).AddDays(6)),
            "month" => (MonthStart(start), MonthStart(start).AddMonths(1).AddDays(-1)),
            _ => throw ApiException.Validation("period_type must be week or month"),
        };
    }

    /// <summary>Throws 423 when a locked period covers the date for this business unit.</summary>
    public static async Task EnsureUnlocked(NpgsqlConnection conn, Guid buId, DateOnly date, NpgsqlTransaction? tx = null)
    {
        var locked = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM period_lock WHERE bu_id = @buId AND unlocked_at IS NULL AND @date BETWEEN period_start AND period_end)",
            new { buId, date }, tx);
        if (locked) throw ApiException.Locked($"{date:yyyy-MM-dd} falls in a locked period");
    }

    public static DateOnly TodayIn(string timezone)
    {
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(timezone); }
        catch { tz = TimeZoneInfo.Utc; }
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz));
    }

    public static DateTime NowIn(string timezone)
    {
        TimeZoneInfo tz;
        try { tz = TimeZoneInfo.FindSystemTimeZoneById(timezone); }
        catch { tz = TimeZoneInfo.Utc; }
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
    }
}
