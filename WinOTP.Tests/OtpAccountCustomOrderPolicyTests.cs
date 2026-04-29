using WinOTP.Helpers;
using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpAccountCustomOrderPolicyTests
{
    [Fact]
    public void Apply_UsesSavedOrderFirst()
    {
        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2),
            CreateAccount("acct-3", 3)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, ["acct-2", "acct-1"]);

        Assert.Equal(["acct-2", "acct-1", "acct-3"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void Apply_IgnoresMissingAndDuplicateSavedIds()
    {
        var accounts = new[]
        {
            CreateAccount("acct-1", 1),
            CreateAccount("acct-2", 2)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, ["missing", "acct-2", "acct-2"]);

        Assert.Equal(["acct-2", "acct-1"], ordered.Select(a => a.Id));
    }

    [Fact]
    public void Apply_AppendsNewAccountsNewestFirst()
    {
        var accounts = new[]
        {
            CreateAccount("old-new-account", 1),
            CreateAccount("saved-account", 2),
            CreateAccount("new-new-account", 3)
        };

        var ordered = OtpAccountCustomOrderPolicy.Apply(accounts, ["saved-account"]);

        Assert.Equal(["saved-account", "new-new-account", "old-new-account"], ordered.Select(a => a.Id));
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
