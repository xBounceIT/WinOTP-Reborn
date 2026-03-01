using WinOTP.Helpers;
using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class LegacyWinOtpImportMapperTests
{
    [Fact]
    public void TryCreateDraftAccount_NullEntry_ReturnsFailure()
    {
        var ok = WinOTPLegacyImportMapper.TryCreateDraftAccount("legacy-1", null, out var account, out var failureReason);

        Assert.False(ok);
        Assert.NotNull(account);
        Assert.Equal("Entry legacy-1 is null.", failureReason);
    }

    [Fact]
    public void TryCreateDraftAccount_BlankSecret_ReturnsFailure()
    {
        var source = new WinOTPLegacyAccount
        {
            Issuer = "ACME",
            Name = "jdoe@example.com",
            Secret = "   "
        };

        var ok = WinOTPLegacyImportMapper.TryCreateDraftAccount("legacy-2", source, out var account, out var failureReason);

        Assert.False(ok);
        Assert.NotNull(account);
        Assert.Equal("Entry legacy-2 has an empty secret.", failureReason);
    }

    [Fact]
    public void TryCreateDraftAccount_ValidEntry_MapsFields()
    {
        var source = new WinOTPLegacyAccount
        {
            Issuer = "ACME",
            Name = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP",
            Created = "2026-02-27T09:29:59.3184826Z"
        };

        var ok = WinOTPLegacyImportMapper.TryCreateDraftAccount("legacy-3", source, out var account, out var failureReason);

        Assert.True(ok);
        Assert.Equal(string.Empty, failureReason);
        Assert.Equal("ACME", account.Issuer);
        Assert.Equal("jdoe@example.com", account.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", account.Secret);
        Assert.Equal(OtpAlgorithm.SHA1, account.Algorithm);
        Assert.Equal(6, account.Digits);
        Assert.Equal(30, account.Period);
        Assert.Equal(DateTime.Parse("2026-02-27T09:29:59.3184826Z").ToUniversalTime(), account.CreatedAt.ToUniversalTime());
    }

    [Fact]
    public void TryCreateDraftAccount_InvalidCreated_UsesFallbackTimestamp()
    {
        var source = new WinOTPLegacyAccount
        {
            Issuer = "ACME",
            Name = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP",
            Created = "not-a-date"
        };

        var before = DateTime.UtcNow.AddSeconds(-1);

        var ok = WinOTPLegacyImportMapper.TryCreateDraftAccount("legacy-4", source, out var account, out var failureReason);

        var after = DateTime.UtcNow.AddSeconds(1);

        Assert.True(ok);
        Assert.Equal(string.Empty, failureReason);
        Assert.InRange(account.CreatedAt.ToUniversalTime(), before, after);
    }
}
