namespace WinOTP.Helpers;

internal static class AppPaths
{
    public static string GetAppDataDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WinOTP_Reborn");
    }

    public static string GetSettingsFilePath()
    {
        return Path.Combine(GetAppDataDirectory(), "settings.json");
    }

    public static string GetLogsDirectory()
    {
        return Path.Combine(GetAppDataDirectory(), "logs");
    }

    public static string GetBackupDirectory()
    {
        return Path.Combine(GetAppDataDirectory(), "Backups");
    }

    public static string GetUpdatesDirectory()
    {
        return Path.Combine(GetAppDataDirectory(), "Updates");
    }
}
