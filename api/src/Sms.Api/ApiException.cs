namespace Sms.Api;

/// <summary>
/// Thrown anywhere in a request; the exception handler in Program.cs turns it
/// into <c>{ error: { code, message, details } }</c> with the given status.
/// </summary>
public sealed class ApiException(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;

    public static ApiException NotFound(string what) => new(404, "not_found", $"{what} not found");
    public static ApiException Forbidden(string message = "You do not have access to this resource") => new(403, "forbidden", message);
    public static ApiException Validation(string message, object? details = null) => new(400, "validation", message, details);
    public static ApiException Conflict(string code, string message) => new(409, code, message);
    public static ApiException Locked(string message = "This period is locked") => new(423, "period_locked", message);
}
