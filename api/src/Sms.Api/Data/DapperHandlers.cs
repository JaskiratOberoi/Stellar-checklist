using System.Data;
using Dapper;

namespace Sms.Api.Data;

/// <summary>
/// Dapper has no built-in DateOnly / TimeOnly support; Npgsql does. These
/// handlers bridge the two and, unlike TypeHandler&lt;T&gt;, also stamp the DbType
/// on NULL parameters so PostgreSQL never sees an untyped null in a date comparison.
/// </summary>
public static class DapperHandlers
{
    private static bool _registered;

    public static void Register()
    {
        if (_registered) return;
        _registered = true;
        SqlMapper.AddTypeHandler(typeof(DateOnly), new DateOnlyHandler());
        SqlMapper.AddTypeHandler(typeof(DateOnly?), new DateOnlyHandler());
        SqlMapper.AddTypeHandler(typeof(TimeOnly), new TimeOnlyHandler());
        SqlMapper.AddTypeHandler(typeof(TimeOnly?), new TimeOnlyHandler());
    }

    private sealed class DateOnlyHandler : SqlMapper.ITypeHandler
    {
        public void SetValue(IDbDataParameter parameter, object? value)
        {
            parameter.DbType = DbType.Date;
            parameter.Value = value is DateOnly d ? d : DBNull.Value;
        }

        public object? Parse(Type destinationType, object value) => value switch
        {
            null or DBNull => null,
            DateOnly d => d,
            DateTime dt => DateOnly.FromDateTime(dt),
            string s => DateOnly.Parse(s),
            _ => throw new InvalidCastException($"Cannot convert {value.GetType()} to DateOnly"),
        };
    }

    private sealed class TimeOnlyHandler : SqlMapper.ITypeHandler
    {
        public void SetValue(IDbDataParameter parameter, object? value)
        {
            parameter.DbType = DbType.Time;
            parameter.Value = value is TimeOnly t ? t : DBNull.Value;
        }

        public object? Parse(Type destinationType, object value) => value switch
        {
            null or DBNull => null,
            TimeOnly t => t,
            TimeSpan ts => TimeOnly.FromTimeSpan(ts),
            DateTime dt => TimeOnly.FromDateTime(dt),
            string s => TimeOnly.Parse(s),
            _ => throw new InvalidCastException($"Cannot convert {value.GetType()} to TimeOnly"),
        };
    }
}
