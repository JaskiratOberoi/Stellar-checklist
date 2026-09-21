namespace Sms.Api.Auth;

/// <summary>
/// Roles as capability sets. A user has exactly one role. super_admin and admin
/// see every business unit; the rest are scoped by bu_membership.
/// Keep in step with the user_role enum in db/sql/001_schema.sql.
/// </summary>
public static class Roles
{
    public const string SuperAdmin = "super_admin";
    public const string Admin = "admin";
    public const string BuManager = "bu_manager";
    public const string LabTech = "lab_tech";
    public const string Viewer = "viewer";

    public static readonly string[] All = [SuperAdmin, Admin, BuManager, LabTech, Viewer];

    public static bool IsGlobal(string role) => role is SuperAdmin or Admin;

    /// <summary>Capability names the SPA uses to shape navigation. Never trusted for authorization.</summary>
    public static string[] Capabilities(string role) => role switch
    {
        SuperAdmin => ["counts.edit", "counts.reopen", "stock.receive", "stock.wastage", "stock.adjust", "stock.transfer",
                       "bu.items", "bu.instruments", "bu.members", "catalogue", "bus", "users", "reports", "periods.lock", "api_keys", "audit"],
        Admin      => ["counts.edit", "counts.reopen", "stock.receive", "stock.wastage", "stock.adjust", "stock.transfer",
                       "bu.items", "bu.instruments", "bu.members", "catalogue", "bus", "users", "audit"],
        BuManager  => ["counts.edit", "counts.reopen", "stock.receive", "stock.wastage", "stock.adjust", "stock.transfer",
                       "bu.items", "bu.instruments", "bu.members"],
        LabTech    => ["counts.edit", "stock.receive", "stock.wastage"],
        _          => [],
    };
}

public static class Policies
{
    public const string User = "user";
    public const string SuperAdmin = "super_admin";
    public const string Admin = "admin";
    public const string Manager = "manager";
    public const string Tech = "tech";
    public const string ApiKey = "api_key";
}

public static class Scopes
{
    public const string CatalogueRead = "catalogue:read";
    public const string ExportCounts = "export:counts";
    public const string ExportMovements = "export:movements";
    public const string ExportLevels = "export:levels";
    public const string ExportSnapshots = "export:snapshots";
    public const string ExportConsumption = "export:consumption";
    public const string IngestMovements = "ingest:movements";
    public const string WebhooksManage = "webhooks:manage";

    public static readonly string[] All =
        [CatalogueRead, ExportCounts, ExportMovements, ExportLevels, ExportSnapshots, ExportConsumption, IngestMovements, WebhooksManage];
}
