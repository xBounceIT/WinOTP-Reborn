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
    public void AccountCustomOrderIds_DefaultsToEmpty()
    {
        var settings = new AppSettingsService(_settingsFilePath);

        Assert.Empty(settings.AccountCustomOrderIds);
    }

    [Fact]
    public void AccountCustomOrderIds_PersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["acct-2", "acct-1"]
        };

        var second = new AppSettingsService(_settingsFilePath);

        Assert.Equal(["acct-2", "acct-1"], second.AccountCustomOrderIds);
    }

    [Fact]
    public void AccountCustomOrderIds_TrimsAndRemovesEmptyAndDuplicateIds()
    {
        var settings = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = [" acct-2 ", "", "acct-1", "acct-2", " "]
        };

        Assert.Equal(["acct-2", "acct-1"], settings.AccountCustomOrderIds);
    }

    [Fact]
    public void AccountCustomOrderIds_ReturnsDefensiveCopy()
    {
        var settings = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["acct-2", "acct-1"]
        };

        var ids = settings.AccountCustomOrderIds;
        Assert.Throws<NotSupportedException>(() => ((IList<string>)ids).Add("acct-3"));

        Assert.Equal(["acct-2", "acct-1"], settings.AccountCustomOrderIds);
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

    [Fact]
    public void AutoStartOnBoot_DefaultsToFalseAndPersistsAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath);
        Assert.False(first.AutoStartOnBoot);

        first.AutoStartOnBoot = true;

        var second = new AppSettingsService(_settingsFilePath);

        Assert.True(second.AutoStartOnBoot);
    }

    public void Dispose()
    {
        if (Directory.Exists(_settingsDirectoryPath))
        {
            Directory.Delete(_settingsDirectoryPath, true);
        }
    }
}
