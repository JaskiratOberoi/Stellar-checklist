using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using Sms.Api;
using Sms.Api.Auth;
using Sms.Api.Data;
using Sms.Api.Endpoints;
using Sms.Api.Jobs;

var builder = WebApplication.CreateBuilder(args);
var options = SmsOptions.From(builder.Configuration);

// ---- services --------------------------------------------------------------
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<Migrator>();
builder.Services.AddSingleton<JwtIssuer>();
builder.Services.AddSingleton<Bootstrap>();
builder.Services.AddSingleton<SnapshotBuilder>();
builder.Services.AddHostedService<SnapshotJob>();
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();
builder.Services.AddOpenApi("v1");

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    o.SerializerOptions.PropertyNameCaseInsensitive = true;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
});

builder.Services.AddCors(c => c.AddDefaultPolicy(p =>
{
    if (options.CorsOrigins.Length > 0) p.WithOrigins(options.CorsOrigins);
    else p.SetIsOriginAllowed(_ => true);
    p.AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("X-Total-Count");
}));

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = options.JwtIssuer,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(options.JwtKey),
            ClockSkew = TimeSpan.FromSeconds(30),
            RoleClaimType = "role",
            NameClaimType = "name",
        };
        o.Events = new JwtBearerEvents
        {
            // Session-version check: a bumped version (logout-all, role change,
            // deactivation) invalidates every outstanding access token within
            // the cache window rather than at its natural expiry.
            OnTokenValidated = async ctx =>
            {
                var sub = ctx.Principal?.FindFirst("sub")?.Value;
                var sv = ctx.Principal?.FindFirst("sv")?.Value;
                if (sub is null || sv is null) { ctx.Fail("missing claims"); return; }
                var cache = ctx.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
                var db = ctx.HttpContext.RequestServices.GetRequiredService<Db>();
                var state = await cache.GetOrCreateAsync("sv:" + sub, async e =>
                {
                    e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
                    await using var conn = await db.Open();
                    return await conn.QuerySingleOrDefaultAsync<(int session_version, bool is_active, string role)>(
                        "SELECT session_version, is_active, role::text FROM app_user WHERE id = @id::uuid", new { id = sub });
                });
                if (state.role is null || !state.is_active || state.session_version.ToString() != sv)
                    ctx.Fail("session revoked");
            },
        };
    })
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthHandler>(ApiKeyAuthHandler.SchemeName, null);

builder.Services.AddAuthorization(o =>
{
    o.AddPolicy(Policies.User, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser().RequireClaim("typ", "user"));
    o.AddPolicy(Policies.SuperAdmin, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser().RequireRole(Roles.SuperAdmin));
    o.AddPolicy(Policies.Admin, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser().RequireRole(Roles.SuperAdmin, Roles.Admin));
    o.AddPolicy(Policies.Manager, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser().RequireRole(Roles.SuperAdmin, Roles.Admin, Roles.BuManager));
    o.AddPolicy(Policies.Tech, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser().RequireRole(Roles.SuperAdmin, Roles.Admin, Roles.BuManager, Roles.LabTech));
    o.AddPolicy(Policies.ApiKey, p => p.AddAuthenticationSchemes(ApiKeyAuthHandler.SchemeName).RequireAuthenticatedUser().RequireClaim("typ", "api_key"));
});

var app = builder.Build();

// ---- pipeline --------------------------------------------------------------
app.UseExceptionHandler(a => a.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, code, message, details) = ex switch
    {
        ApiException api => (api.Status, api.Code, api.Message, api.Details),
        BadHttpRequestException bad => (400, "bad_request", bad.Message, null),
        JsonException j => (400, "bad_json", j.Message, null),
        _ => (500, "internal", "Unexpected error", null),
    };
    if (status == 500) app.Logger.LogError(ex, "Unhandled exception");
    ctx.Response.StatusCode = status;
    await ctx.Response.WriteAsJsonAsync(new { error = new { code, message, details } });
}));
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// 401/403 bodies in the same envelope as every other error.
app.UseStatusCodePages(async ctx =>
{
    var s = ctx.HttpContext.Response.StatusCode;
    if (s is 401 or 403 or 404 or 405)
        await ctx.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = new { code = s switch { 401 => "unauthenticated", 403 => "forbidden", 404 => "not_found", _ => "method_not_allowed" }, message = s switch { 401 => "Sign in required", 403 => "Forbidden", 404 => "Route not found", _ => "Method not allowed" } },
        });
});

app.MapOpenApi("/openapi/{documentName}.json");
app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));
app.MapGet("/health/db", async (Db db) =>
{
    await using var conn = await db.Open();
    var n = await conn.ExecuteScalarAsync<int>("SELECT count(*) FROM sms_migration");
    return Results.Ok(new { status = "ok", migrations = n });
});

var api = app.MapGroup("/api/v1");
AuthEndpoints.Map(api);
BusinessUnitEndpoints.Map(api);
CatalogueEndpoints.Map(api);
BuItemEndpoints.Map(api);
CountEndpoints.Map(api);
StockEndpoints.Map(api);
SnapshotEndpoints.Map(api);
ReportEndpoints.Map(api);
AdminEndpoints.Map(api);
ExportEndpoints.Map(app.MapGroup("/export/v1"), app.MapGroup("/ingest/v1"));

// ---- startup work ----------------------------------------------------------
await app.Services.GetRequiredService<Migrator>().ApplyAsync(CancellationToken.None);
await app.Services.GetRequiredService<Migrator>().SeedDevAsync(CancellationToken.None);
await app.Services.GetRequiredService<Bootstrap>().RunAsync(CancellationToken.None);

app.Run();
