using Microsoft.UI.Xaml.Controls;
using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpCardTemplateRootPolicyTests
{
    [Theory]
    [InlineData(typeof(Border))]
    [InlineData(typeof(Grid))]
    [InlineData(typeof(TextBlock))]
    public void IsSupportedRootType_FrameworkElementTypes_AreSupported(Type rootType)
    {
        var isSupported = OtpCardTemplateRootPolicy.IsSupportedRootType(rootType);

        Assert.True(isSupported);
    }

    [Theory]
    [InlineData(typeof(string))]
    [InlineData(typeof(int))]
    public void IsSupportedRootType_NonFrameworkElementTypes_AreRejected(Type rootType)
    {
        var isSupported = OtpCardTemplateRootPolicy.IsSupportedRootType(rootType);

        Assert.False(isSupported);
    }

    [Fact]
    public void IsSupportedRootType_NullType_IsRejected()
    {
        var isSupported = OtpCardTemplateRootPolicy.IsSupportedRootType(null);

        Assert.False(isSupported);
    }
}
