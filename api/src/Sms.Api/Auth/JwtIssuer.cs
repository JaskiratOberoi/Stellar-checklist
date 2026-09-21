using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace Sms.Api.Auth;

public sealed class JwtIssuer(SmsOptions options)
{
    private readonly SigningCredentials _creds = new(new SymmetricSecurityKey(options.JwtKey), SecurityAlgorithms.HmacSha256);

    public (string token, int expiresInSeconds) IssueAccess(Guid userId, string role, string name, int sessionVersion)
    {
        var now = DateTime.UtcNow;
        var exp = now.AddMinutes(options.AccessTokenMinutes);
        var claims = new[]
        {
            new Claim("sub", userId.ToString()),
            new Claim("typ", "user"),
            new Claim("role", role),
            new Claim("name", name),
            new Claim("sv", sessionVersion.ToString()),
        };
        var jwt = new JwtSecurityToken(options.JwtIssuer, null, claims, now, exp, _creds);
        return (new JwtSecurityTokenHandler().WriteToken(jwt), (int)(exp - now).TotalSeconds);
    }

    public static string NewRefreshToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Sha256(string value)
        => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
