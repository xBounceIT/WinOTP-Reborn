using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpAccountTests
{
    [Fact]
    public void IssuerOrAccountName_WithIssuer_ReturnsIssuer()
    {
        var account = new OtpAccount
        {
            Issuer = "ACME Co",
            AccountName = "jdoe@example.com"
        };

        Assert.Equal("ACME Co", account.IssuerOrAccountName);
        Assert.True(account.HasIssuer);
        Assert.Equal("jdoe@example.com", account.SecondaryLabel);
        Assert.Equal("ACME Co (jdoe@example.com)", account.DisplayLabel);
    }

    [Fact]
    public void IssuerOrAccountName_WithEmptyIssuer_FallsBackToAccountName()
    {
        var account = new OtpAccount
        {
            Issuer = string.Empty,
            AccountName = "jdoe@example.com"
        };

        Assert.Equal("jdoe@example.com", account.IssuerOrAccountName);
        Assert.False(account.HasIssuer);
        Assert.Equal(string.Empty, account.SecondaryLabel);
        Assert.Equal("jdoe@example.com", account.DisplayLabel);
    }

    [Fact]
    public void IssuerOrAccountName_WithWhitespaceIssuer_FallsBackToAccountName()
    {
        var account = new OtpAccount
        {
            Issuer = "   ",
            AccountName = "jdoe@example.com"
        };

        Assert.Equal("jdoe@example.com", account.IssuerOrAccountName);
        Assert.False(account.HasIssuer);
        Assert.Equal(string.Empty, account.SecondaryLabel);
        Assert.Equal("jdoe@example.com", account.DisplayLabel);
    }
}
