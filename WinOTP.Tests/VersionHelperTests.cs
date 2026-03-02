using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class VersionHelperTests
{
    [Theory]
    [InlineData("v1.2.3", "1.2.3")]
    [InlineData("1.2.3+abc123", "1.2.3")]
    [InlineData("v1.2.3-beta.1+abc123", "1.2.3-beta.1")]
    public void NormalizeVersionString_StripsPrefixAndBuildMetadata(string rawVersion, string expected)
    {
        var result = VersionHelper.NormalizeVersionString(rawVersion);

        Assert.Equal(expected, result);
    }

    [Fact]
    public void GetAppVersion_UsesAssemblyVersionWhenInformationalVersionMissing()
    {
        var result = VersionHelper.GetAppVersion(null, new Version(1, 2, 3, 4));

        Assert.Equal("1.2.3", result);
    }

    [Fact]
    public void GetAppVersion_ReturnsZeroVersionWhenNoVersionDataIsAvailable()
    {
        var result = VersionHelper.GetAppVersion(null, null);

        Assert.Equal("0.0.0", result);
    }
}
