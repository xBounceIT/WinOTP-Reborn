using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppSettingsServiceTests : IDisposable
{
    private readonly string _settingsDirectoryPath;
    private readonly string _settingsFilePath;

    public AppSettingsServiceTests()
    {
        _settingsDirectoryPath = Path.Combine(Path.GetTempPath(), "WinOTP-AppSettingsTests", Guid.NewGuid().ToString("N"));
        _settingsFilePath = Path.Combine(_settingsDirectoryPath, "settings.json");
    }

    [Fact]
    public void IsAutomaticBackupEnabled_PersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            IsAutomaticBackupEnabled = true
        };

        var second = new AppSettingsService(_settingsFilePath);

        Assert.True(second.IsAutomaticBackupEnabled);
    }

    [Fact]
    public void CustomBackupFolderPath_PersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            CustomBackupFolderPath = @"C:\Backups\WinOTP"
        };

        var second = new AppSettingsService(_settingsFilePath);

        Assert.Equal(@"C:\Backups\WinOTP", second.CustomBackupFolderPath);
    }

    public void Dispose()
    {
        if (Directory.Exists(_settingsDirectoryPath))
        {
            Directory.Delete(_settingsDirectoryPath, true);
        }
    }
}
