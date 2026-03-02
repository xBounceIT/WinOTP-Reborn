using System.Reflection;

namespace WinOTP.Helpers;

public static class VersionHelper
{
    public static string GetAppVersion()
    {
        var assembly = System.Reflection.Assembly.GetEntryAssembly();
        string? informationalVersion = null;
        if (assembly is not null)
        {
            informationalVersion = assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion;
        }

        var version = assembly?.GetName().Version;
        return GetAppVersion(informationalVersion, version);
    }

    internal static string GetAppVersion(string? informationalVersion, Version? version)
    {
        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return NormalizeVersionString(informationalVersion!);
        }

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

        var buildMetadataSeparatorIndex = normalized.IndexOf('+');
        if (buildMetadataSeparatorIndex >= 0)
        {
            normalized = normalized[..buildMetadataSeparatorIndex];
        }

        return normalized;
    }
}
