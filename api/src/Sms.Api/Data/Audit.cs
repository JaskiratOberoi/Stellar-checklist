using System.Text.Json;
using Dapper;
using Npgsql;
using Sms.Api.Auth;

namespace Sms.Api.Data;

/// <summary>Append-only audit trail. Called inside the same transaction as the write it describes.</summary>
public static class Audit
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public static Task Write(NpgsqlConnection conn, NpgsqlTransaction? tx, Current who, string action,
        string entityType, object entityId, Guid? buId, object? before = null, object? after = null, HttpContext? http = null)
    {
        return conn.ExecuteAsync(
            """
            INSERT INTO audit_log(actor_user_id, actor_client_id, action, entity_type, entity_id, bu_id, before, after, ip, user_agent)
            VALUES (@user, @client, @action, @entityType, @entityId, @buId, @before::jsonb, @after::jsonb, @ip::inet, @ua)
            """,
            new
            {
                user = who.IsUser ? who.UserId : (Guid?)null,
                client = who.ClientId,
                action, entityType,
                entityId = entityId.ToString(),
                buId,
                before = before is null ? null : JsonSerializer.Serialize(before, Json),
                after = after is null ? null : JsonSerializer.Serialize(after, Json),
                ip = http?.Connection.RemoteIpAddress?.MapToIPv4().ToString(),
                ua = http?.Request.Headers.UserAgent.ToString() is { Length: > 0 } s ? s[..Math.Min(s.Length, 300)] : null,
            }, tx);
    }
}
