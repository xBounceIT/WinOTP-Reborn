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

    [Theory]
    // Math.Round defaults to banker's rounding (round-half-to-even):
    //   125%: 650 * 1.25  = 812.5  → 812
    //   175%: 650 * 1.75  = 1137.5 → 1138
    [InlineData(120u, 480, 650, 600, 812)]
    [InlineData(144u, 480, 650, 720, 975)]
    [InlineData(168u, 480, 650, 840, 1138)]
    [InlineData(192u, 480, 650, 960, 1300)]
    public void ScaleLogicalSize_ScalesByDpi(
        uint dpi, int width, int height, int expectedWidth, int expectedHeight)
    {
        var result = WindowDpiHelper.ScaleLogicalSize(dpi, width, height);

        Assert.Equal(expectedWidth, result.Width);
        Assert.Equal(expectedHeight, result.Height);
    }
}
