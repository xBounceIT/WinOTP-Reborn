using WinOTP.Services;
using WinOTP.Models;
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
    public void AccountSortOption_DefaultsToDateAddedDesc()
    {
        var settings = new AppSettingsService(_settingsFilePath);

        Assert.Equal(SortOption.DateAddedDesc, settings.AccountSortOption);
    }

    [Fact]
    public void AccountSortOption_PersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountSortOption = SortOption.AlphabeticalDesc
        };

        var second = new AppSettingsService(_settingsFilePath);

        Assert.Equal(SortOption.AlphabeticalDesc, second.AccountSortOption);
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
    public void WindowsHelloRemoteFallbackSettings_DefaultToFalseAndPersistAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath);
        Assert.False(first.IsWindowsHelloRemotePinEnabled);
        Assert.False(first.IsWindowsHelloRemotePasswordEnabled);

        first.IsWindowsHelloRemotePinEnabled = true;
        first.IsWindowsHelloRemotePasswordEnabled = false;

        var second = new AppSettingsService(_settingsFilePath);

        Assert.True(second.IsWindowsHelloRemotePinEnabled);
        Assert.False(second.IsWindowsHelloRemotePasswordEnabled);
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

    [Fact]
    public void IsUpdateCheckEnabled_DefaultsToTrueAndPersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath);
        Assert.True(first.IsUpdateCheckEnabled);

        first.IsUpdateCheckEnabled = false;

        var second = new AppSettingsService(_settingsFilePath);

        Assert.False(second.IsUpdateCheckEnabled);
    }

    [Fact]
    public void UpdateChannel_DefaultsToStableAndPersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath);
        Assert.Equal(UpdateChannel.Stable, first.UpdateChannel);

        first.UpdateChannel = UpdateChannel.PreRelease;

        var second = new AppSettingsService(_settingsFilePath);

        Assert.Equal(UpdateChannel.PreRelease, second.UpdateChannel);
    }

    public void Dispose()
    {
        if (Directory.Exists(_settingsDirectoryPath))
        {
            Directory.Delete(_settingsDirectoryPath, true);
        }
    }
}
