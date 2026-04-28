using WinOTP.Helpers;
using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class WinAuthImportMapperTests
{
    [Fact]
    public void TryCreateDraftAccount_IssuerOnlyLine_MovesLabelToIssuer()
    {
        var line = "otpauth://totp/%5bDemo%5d%20TestService?secret=JBSWY3DPEHPK3PXP&digits=6&icon=WinAuth";

        var ok = WinAuthImportMapper.TryCreateDraftAccount(line, out var account, out var failureReason);

        Assert.True(ok);
        Assert.Equal(string.Empty, failureReason);
        Assert.Equal("[Demo] TestService", account.Issuer);
        Assert.Equal(string.Empty, account.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", account.Secret);
        Assert.Equal(6, account.Digits);
        Assert.Equal(OtpAlgorithm.SHA1, account.Algorithm);
        Assert.Equal(30, account.Period);
    }

    [Fact]
    public void TryCreateDraftAccount_WinAuthPlusSpacing_NormalizesSpaces()
    {
        var line = "otpauth://totp/My+Service?secret=JBSWY3DPEHPK3PXP&issuer=My+Service";

        var ok = WinAuthImportMapper.TryCreateDraftAccount(line, out var account, out _);

        Assert.True(ok);
        Assert.Equal("My Service", account.Issuer);
        Assert.Equal("My Service", account.AccountName);
    }

    [Fact]
    public void TryCreateDraftAccount_LabelOnlyGenericOtpAuthLine_PreservesAccountName()
    {
        var line = "otpauth://totp/user@example.com?secret=JBSWY3DPEHPK3PXP";

        var ok = WinAuthImportMapper.TryCreateDraftAccount(line, out var account, out _);

        Assert.True(ok);
        Assert.Equal(string.Empty, account.Issuer);
        Assert.Equal("user@example.com", account.AccountName);
    }

    [Fact]
    public void TryCreateDraftAccount_PreservesOtpSettings()
    {
        var line = "otpauth://totp/AWS:admin?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA512&digits=8&period=60";

        var ok = WinAuthImportMapper.TryCreateDraftAccount(line, out var account, out _);

        Assert.True(ok);
        Assert.Equal("AWS", account.Issuer);
        Assert.Equal("admin", account.AccountName);
        Assert.Equal("GEZDGNBVGY3TQOJQ", account.Secret);
        Assert.Equal(OtpAlgorithm.SHA512, account.Algorithm);
        Assert.Equal(8, account.Digits);
        Assert.Equal(60, account.Period);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not an otpauth uri")]
    [InlineData("otpauth://totp/Test?digits=6")]
    public void TryCreateDraftAccount_InvalidLine_ReturnsFalse(string line)
    {
        var ok = WinAuthImportMapper.TryCreateDraftAccount(line, out var account, out var failureReason);

        Assert.False(ok);
        Assert.NotNull(account);
        Assert.NotEmpty(failureReason);
    }
}
