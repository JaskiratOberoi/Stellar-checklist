using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Sms.Api.Data;

namespace Sms.Api.Auth;

/// <summary>
/// X-Api-Key authentication for Matter, Infinity and other machines. The key is
/// looked up by SHA-256 hash; scopes become "scope" claims; the optional IP
/// allow-list is enforced here.
/// </summary>
public sealed class ApiKeyAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, Db db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiKey";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Api-Key", out var raw) || string.IsNullOrWhiteSpace(raw))
            return AuthenticateResult.NoResult();

        var hash = JwtIssuer.Sha256(raw.ToString().Trim());
        await using var conn = await db.Open(Context.RequestAborted);
        var client = await conn.QuerySingleOrDefaultAsync<ApiClientRow>(
            "SELECT id, name, scopes, allowed_ips::text[] AS allowed_ips FROM api_client WHERE key_hash = @hash AND is_active AND revoked_at IS NULL",
            new { hash });
        if (client is null) return AuthenticateResult.Fail("Invalid API key");

        var remote = Context.Connection.RemoteIpAddress;
        if (client.AllowedIps is { Length: > 0 } && remote is not null)
        {
            var ok = client.AllowedIps.Any(ip => IPAddress.TryParse(ip.Split('/')[0], out var a) && a.Equals(remote.MapToIPv4()));
            if (!ok) return AuthenticateResult.Fail("IP not allowed for this key");
        }

        await conn.ExecuteAsync("UPDATE api_client SET last_used_at = now() WHERE id = @Id", new { client.Id });

        var claims = new List<Claim>
        {
            new("sub", client.Id.ToString()),
            new("typ", "api_key"),
            new("name", client.Name),
        };
        claims.AddRange(client.Scopes.Select(s => new Claim("scope", s)));
        var identity = new ClaimsIdentity(claims, SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    private sealed class ApiClientRow
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = "";
        public string[] Scopes { get; set; } = [];
        public string[]? AllowedIps { get; set; }
    }
}
