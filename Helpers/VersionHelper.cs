using System.Reflection;

namespace WinOTP.Helpers;

public static class VersionHelper
{
    public static string GetAppVersion()
    {
        var assembly = Assembly.GetEntryAssembly();
        if (assembly is null) return "0.0.0";
        
        var version = assembly.GetName().Version;
        if (version is null) return "0.0.0";
        
        return $"{version.Major}.{version.Minor}.{version.Build}";
    }
}
