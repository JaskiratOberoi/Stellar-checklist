using Dapper;
using Npgsql;

namespace Sms.Api.Data;

/// <summary>
/// The single connection entry point. NpgsqlDataSource owns the pool; every
/// repository opens a connection per unit of work and disposes it.
/// </summary>
public sealed class Db : IAsyncDisposable
{
    private readonly NpgsqlDataSource _source;

    public Db(SmsOptions options)
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        DapperHandlers.Register();
        var b = new NpgsqlDataSourceBuilder(options.DbConnection);
        _source = b.Build();
    }

    public ValueTask<NpgsqlConnection> Open(CancellationToken ct = default) => _source.OpenConnectionAsync(ct);

    /// <summary>After migrations create extensions or enums, the cached type catalog must be refreshed.</summary>
    public async Task ReloadTypes(CancellationToken ct = default)
    {
        await using var conn = await _source.OpenConnectionAsync(ct);
        await conn.ReloadTypesAsync(ct);
    }

    public ValueTask DisposeAsync() => _source.DisposeAsync();
}

/// <summary>Opaque keyset cursor for export endpoints: (timestamp, id) base64.</summary>
public static class Cursor
{
    public static string Encode(DateTime ts, Guid id)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{ts:O}|{id}"));

    public static (DateTime ts, Guid id)? Decode(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return null;
        try
        {
            var raw = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            var parts = raw.Split('|');
            return (DateTime.Parse(parts[0], null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime(), Guid.Parse(parts[1]));
        }
        catch { throw ApiException.Validation("Invalid cursor"); }
    }
}

public sealed class Page<T>
{
    public required IReadOnlyList<T> Items { get; init; }
    public string? NextCursor { get; init; }
}
