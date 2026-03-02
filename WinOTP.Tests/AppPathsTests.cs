using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppPathsTests
{
    private readonly string _localAppDataPath =
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    [Fact]
    public void GetAppDataDirectory_ReturnsLocalAppData_WinOtpReborn()
    {
        var result = AppPaths.GetAppDataDirectory();

        Assert.Equal(Path.Combine(_localAppDataPath, "WinOTP_Reborn"), result);
    }

    [Fact]
    public void GetSettingsFilePath_UsesWinOtpRebornRoot()
    {
        var result = AppPaths.GetSettingsFilePath();

        Assert.Equal(Path.Combine(_localAppDataPath, "WinOTP_Reborn", "settings.json"), result);
    }

    [Fact]
    public void GetLogsDirectory_UsesWinOtpRebornRoot()
    {
        var result = AppPaths.GetLogsDirectory();

        Assert.Equal(Path.Combine(_localAppDataPath, "WinOTP_Reborn", "logs"), result);
    }

    [Fact]
    public void GetBackupDirectory_UsesWinOtpRebornRoot()
    {
        var result = AppPaths.GetBackupDirectory();

        Assert.Equal(Path.Combine(_localAppDataPath, "WinOTP_Reborn", "Backups"), result);
    }

    [Fact]
    public void GetUpdatesDirectory_UsesWinOtpRebornRoot()
    {
        var result = AppPaths.GetUpdatesDirectory();

        Assert.Equal(Path.Combine(_localAppDataPath, "WinOTP_Reborn", "Updates"), result);
    }
}
