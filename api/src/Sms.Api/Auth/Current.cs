using System.Security.Claims;
using Dapper;
using Npgsql;

namespace Sms.Api.Auth;

/// <summary>
/// The caller of the current request, read from JWT claims. Business-unit
/// scope is resolved server-side here and nowhere else.
/// </summary>
public sealed class Current
{
    public Guid UserId { get; }
    public string Role { get; }
    public string Name { get; }
    public string? ClientName { get; }
    public Guid? ClientId { get; }
    public string[] ClientScopes { get; }

    public bool IsUser => UserId != Guid.Empty;
    public bool IsSuperAdmin => Role == Roles.SuperAdmin;
    public bool IsAdmin => Role is Roles.SuperAdmin or Roles.Admin;
    public bool IsManager => Role is Roles.SuperAdmin or Roles.Admin or Roles.BuManager;
    public bool CanEdit => IsManager || Role == Roles.LabTech;

    private Current(ClaimsPrincipal p)
    {
        var typ = p.FindFirstValue("typ");
        if (typ == "api_key")
        {
            ClientId = Guid.Parse(p.FindFirstValue("sub")!);
            ClientName = p.FindFirstValue("name") ?? "";
            ClientScopes = p.FindAll("scope").Select(c => c.Value).ToArray();
            Role = ""; Name = ClientName;
            return;
        }
        UserId = Guid.Parse(p.FindFirstValue("sub") ?? throw ApiException.Forbidden("Not signed in"));
        Role = p.FindFirstValue("role") ?? Roles.Viewer;
        Name = p.FindFirstValue("name") ?? "";
        ClientScopes = [];
    }

    public static Current From(ClaimsPrincipal p) => new(p);

    public void RequireScope(string scope)
    {
        if (!ClientScopes.Contains(scope)) throw new ApiException(403, "forbidden", $"API key lacks scope {scope}", new { scope });
    }

    public void RequireManager() { if (!IsManager) throw ApiException.Forbidden("Requires bu_manager or above"); }
    public void RequireAdmin() { if (!IsAdmin) throw ApiException.Forbidden("Requires admin or above"); }
    public void RequireSuperAdmin() { if (!IsSuperAdmin) throw ApiException.Forbidden("Requires super_admin"); }
    public void RequireEditor() { if (!CanEdit) throw ApiException.Forbidden("Read-only role"); }

    /// <summary>Throws 403 unless the caller can see this business unit.</summary>
    public async Task RequireBu(NpgsqlConnection conn, Guid buId)
    {
        if (IsAdmin) return;
        var ok = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM bu_membership WHERE user_id = @UserId AND bu_id = @buId)", new { UserId, buId });
        if (!ok) throw ApiException.Forbidden("You are not a member of this business unit");
    }

    /// <summary>Business-unit ids this caller may see; null means all.</summary>
    public async Task<Guid[]?> VisibleBus(NpgsqlConnection conn)
    {
        if (IsAdmin || !IsUser) return null;
        return (await conn.QueryAsync<Guid>("SELECT bu_id FROM bu_membership WHERE user_id = @UserId", new { UserId })).ToArray();
    }
}
