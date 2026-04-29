using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppSettingsAndCustomOrderIntegrationTests : IDisposable
{
    private readonly string _settingsDirectoryPath;
    private readonly string _settingsFilePath;

    public AppSettingsAndCustomOrderIntegrationTests()
    {
        _settingsDirectoryPath = Path.Combine(Path.GetTempPath(), "WinOTP-CustomOrderIntegrationTests", Guid.NewGuid().ToString("N"));
        _settingsFilePath = Path.Combine(_settingsDirectoryPath, "settings.json");
    }

    [Fact]
    public void RoundTrip_PreservesOrderAcrossInstances()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["acct-3", "acct-1", "acct-2"]
        };

        var reloaded = new AppSettingsService(_settingsFilePath);
        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2),
            CreateAccount("acct-3", 3)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, reloaded.AccountCustomOrderIds);

        Assert.Equal(["acct-3", "acct-1", "acct-2"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void RoundTrip_AppendsNewAccountsNewestFirst()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["saved-account"]
        };

        var reloaded = new AppSettingsService(_settingsFilePath);
        var accounts = new[]
        {
            CreateAccount("old-new-account", 1),
            CreateAccount("saved-account", 2),
            CreateAccount("new-new-account", 3)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, reloaded.AccountCustomOrderIds);

        Assert.Equal(["saved-account", "new-new-account", "old-new-account"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void RoundTrip_DropsOrphanIdsFromSavedList()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["acct-1", "deleted-account", "acct-2"]
        };

        var reloaded = new AppSettingsService(_settingsFilePath);
        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, reloaded.AccountCustomOrderIds);

        Assert.Equal(["acct-1", "acct-2"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void RoundTrip_NormalizesWhitespaceAndDuplicatesOnLoad()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = [" acct-2 ", "", "acct-1", "acct-2", " "]
        };

        var reloaded = new AppSettingsService(_settingsFilePath);
        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, reloaded.AccountCustomOrderIds);

        Assert.Equal(["acct-2", "acct-1"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void RoundTrip_PrunedListRoundTripsCleanlyOnReload()
    {
        var first = new AppSettingsService(_settingsFilePath)
        {
            AccountCustomOrderIds = ["acct-1", "deleted", "acct-2"]
        };

        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2)
        };

        // Simulate the prune step that ApplyFilterAndSort performs.
        var pruned = OtpAccountCustomOrderPolicy.Prune(first.AccountCustomOrderIds, accounts);
        first.AccountCustomOrderIds = pruned;

        var reloaded = new AppSettingsService(_settingsFilePath);

        Assert.Equal(["acct-1", "acct-2"], reloaded.AccountCustomOrderIds);
    }

    public void Dispose()
    {
        if (Directory.Exists(_settingsDirectoryPath))
        {
            Directory.Delete(_settingsDirectoryPath, true);
        }
    }

    private static OtpAccount CreateAccount(string id, int createdAtDay)
    {
        return new OtpAccount
        {
            Id = id,
            Secret = "JBSWY3DPEHPK3PXP",
            CreatedAt = new DateTime(2026, 1, createdAtDay, 0, 0, 0, DateTimeKind.Utc)
        };
    }
}
