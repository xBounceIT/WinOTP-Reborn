using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class WindowDpiHelperTests
{
    [Theory]
    [InlineData(0u, 480, 650)]
    [InlineData(96u, 480, 650)]
    public void ScaleLogicalSize_DoesNotScaleAtReferenceOrUnknownDpi(uint dpi, int width, int height)
    {
        var result = WindowDpiHelper.ScaleLogicalSize(dpi, width, height);

        Assert.Equal(width, result.Width);
        Assert.Equal(height, result.Height);
    }

    [Fact]
    public void ScaleLogicalSize_Scales125Percent()
    {
        var result = WindowDpiHelper.ScaleLogicalSize(120, 480, 650);

        // 650 * 1.25 = 812.5 → Math.Round uses banker's rounding (round-half-to-even) → 812
        Assert.Equal(600, result.Width);
        Assert.Equal(812, result.Height);
    }

    [Fact]
    public void ScaleLogicalSize_Scales150Percent()
    {
        var result = WindowDpiHelper.ScaleLogicalSize(144, 480, 650);

        Assert.Equal(720, result.Width);
        Assert.Equal(975, result.Height);
    }

    [Fact]
    public void ScaleLogicalSize_Scales175PercentAndRounds()
    {
        var result = WindowDpiHelper.ScaleLogicalSize(168, 480, 650);

        Assert.Equal(840, result.Width);
        Assert.Equal(1138, result.Height);
    }

    [Fact]
    public void ScaleLogicalSize_Scales200Percent()
    {
        var result = WindowDpiHelper.ScaleLogicalSize(192, 480, 650);

        Assert.Equal(960, result.Width);
        Assert.Equal(1300, result.Height);
    }
}
