using System.Reflection;

namespace WinOTP.Helpers;

public static class VersionHelper
{
    public static string GetAppVersion()
    {
        var assembly = Assembly.GetEntryAssembly();
        if (assembly is null)
        {
            return "0.0.0";
        }

        var informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return NormalizeVersionString(informationalVersion);
        }

        var version = assembly.GetName().Version;
        if (version is null)
        {
            return "0.0.0";
        }

        return $"{version.Major}.{version.Minor}.{version.Build}";
    }

    public static string NormalizeVersionString(string rawVersion)
    {
        var normalized = rawVersion.Trim();
        if (normalized.StartsWith('v') || normalized.StartsWith('V'))
        {
            normalized = normalized[1..];
        }

        return normalized;
    }
}
