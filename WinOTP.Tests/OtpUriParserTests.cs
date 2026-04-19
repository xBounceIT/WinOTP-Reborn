using WinOTP.Helpers;
using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpUriParserTests
{
    [Fact]
    public void TryParse_LabelWithPercentEncodedSpace_ParsesCorrectly()
    {
        var uri = "otpauth://totp/%5bDemo%5d%20TestService?secret=JBSWY3DPEHPK3PXP&digits=6&icon=WinAuth";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal("[Demo] TestService", result.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", result.Secret);
        Assert.Equal(6, result.Digits);
        Assert.Equal(OtpAlgorithm.SHA1, result.Algorithm);
        Assert.Equal(30, result.Period);
    }

    [Fact]
    public void TryParse_PlusInLabel_IsLiteralNotSpace()
    {
        var uri = "otpauth://totp/My+Service?secret=JBSWY3DPEHPK3PXP";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal("My+Service", result.AccountName);
    }

    [Fact]
    public void TryParse_IssuerInLabel_ColonSeparated()
    {
        var uri = "otpauth://totp/GitHub:john@example.com?secret=JBSWY3DPEHPK3PXP";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal("GitHub", result.Issuer);
        Assert.Equal("john@example.com", result.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", result.Secret);
    }

    [Fact]
    public void TryParse_IssuerQueryParam_OverridesLabel()
    {
        var uri = "otpauth://totp/TestAccount?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal("GitHub", result.Issuer);
        Assert.Equal("TestAccount", result.AccountName);
    }

    [Fact]
    public void TryParse_AllQueryParams()
    {
        var uri = "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal("Example", result.Issuer);
        Assert.Equal("user@example.com", result.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", result.Secret);
        Assert.Equal(OtpAlgorithm.SHA256, result.Algorithm);
        Assert.Equal(8, result.Digits);
        Assert.Equal(60, result.Period);
    }

    [Fact]
    public void TryParse_NonOtpauthUri_ReturnsNull()
    {
        Assert.Null(OtpUriParser.TryParse("https://example.com"));
    }

    [Fact]
    public void TryParse_HotpUri_ReturnsNull()
    {
        Assert.Null(OtpUriParser.TryParse("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=1"));
    }

    [Fact]
    public void TryParse_MissingSecret_ReturnsNull()
    {
        Assert.Null(OtpUriParser.TryParse("otpauth://totp/Test?digits=6"));
    }

    [Fact]
    public void TryParse_InvalidBase32Secret_ReturnsNull()
    {
        Assert.Null(OtpUriParser.TryParse("otpauth://totp/Test?secret=invalid!secret@here"));
    }

    [Fact]
    public void TryParse_EmptyString_ReturnsNull()
    {
        Assert.Null(OtpUriParser.TryParse(""));
    }

    [Fact]
    public void TryParse_Sha512Algorithm()
    {
        var uri = "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA512";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal(OtpAlgorithm.SHA512, result.Algorithm);
    }

    [Fact]
    public void TryParse_InvalidDigits_DefaultsTo6()
    {
        var uri = "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7";
        var result = OtpUriParser.TryParse(uri);

        Assert.NotNull(result);
        Assert.Equal(6, result.Digits);
    }

    [Fact]
    public void TryParse_WinAuthMultipleLines_EachParsedIndependently()
    {
        var lines = new[]
        {
            "otpauth://totp/%5bDemo%5d%20TestService?secret=JBSWY3DPEHPK3PXP&digits=6&icon=WinAuth",
            "otpauth://totp/GitHub:user%40example.com?secret=HXDMVJECJJWSRB3H",
            "otpauth://totp/AWS:admin?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA512&digits=8&period=30",
        };

        var results = lines.Select(OtpUriParser.TryParse).ToList();

        Assert.All(results, Assert.NotNull);

        Assert.Equal("[Demo] TestService", results[0]!.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", results[0]!.Secret);

        Assert.Equal("GitHub", results[1]!.Issuer);
        Assert.Equal("user@example.com", results[1]!.AccountName);

        Assert.Equal("AWS", results[2]!.Issuer);
        Assert.Equal(OtpAlgorithm.SHA512, results[2]!.Algorithm);
        Assert.Equal(8, results[2]!.Digits);
    }
}
