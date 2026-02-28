using WinOTP.Models;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class TotpCodeGeneratorTests
{
    private static readonly OtpAccount RfcSha1Account = new()
    {
        Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        Algorithm = OtpAlgorithm.SHA1,
        Digits = 8,
        Period = 30
    };

    [Theory]
    [InlineData(59, "94287082")]
    [InlineData(1111111109, "07081804")]
    [InlineData(1111111111, "14050471")]
    [InlineData(1234567890, "89005924")]
    [InlineData(2000000000, "69279037")]
    [InlineData(20000000000, "65353130")]
    public void GenerateCodeAt_Rfc6238Sha1Vectors_ReturnExpectedCode(long unixSeconds, string expectedCode)
    {
        var generator = new TotpCodeGenerator();
        var timestamp = DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime;

        var code = generator.GenerateCodeAt(RfcSha1Account, timestamp);

        Assert.Equal(expectedCode, code);
    }

    [Fact]
    public void GenerateCodeAt_InvalidSecret_ReturnsFallbackCode()
    {
        var generator = new TotpCodeGenerator();
        var account = new OtpAccount
        {
            Secret = "NOT-BASE32",
            Algorithm = OtpAlgorithm.SHA1,
            Digits = 6,
            Period = 30
        };

        var code = generator.GenerateCodeAt(account, DateTime.UtcNow);

        Assert.Equal("000000", code);
    }

    [Fact]
    public void GetRemainingSeconds_InvalidPeriod_ReturnsZero()
    {
        var generator = new TotpCodeGenerator();
        var account = new OtpAccount
        {
            Secret = "JBSWY3DPEHPK3PXP",
            Algorithm = OtpAlgorithm.SHA1,
            Digits = 6,
            Period = 0
        };

        var remaining = generator.GetRemainingSeconds(account);

        Assert.Equal(0, remaining);
    }
}
