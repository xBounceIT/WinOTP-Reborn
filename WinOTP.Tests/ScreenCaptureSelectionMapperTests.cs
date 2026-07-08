using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class ScreenCaptureSelectionMapperTests
{
    [Fact]
    public void TryMapToPixelRect_ScalesCanvasCoordinatesToCapturePixels()
    {
        var ok = ScreenCaptureSelectionMapper.TryMapToPixelRect(
            selectionX: 100,
            selectionY: 50,
            selectionWidth: 200,
            selectionHeight: 100,
            canvasWidth: 1280,
            canvasHeight: 720,
            imageWidth: 1920,
            imageHeight: 1080,
            out var rect);

        Assert.True(ok);
        Assert.Equal(new ScreenCapturePixelRect(150, 75, 300, 150), rect);
    }

    [Fact]
    public void TryMapToPixelRect_ClampsSelectionToCaptureBounds()
    {
        var ok = ScreenCaptureSelectionMapper.TryMapToPixelRect(
            selectionX: 900,
            selectionY: 900,
            selectionWidth: 200,
            selectionHeight: 200,
            canvasWidth: 1000,
            canvasHeight: 1000,
            imageWidth: 2000,
            imageHeight: 2000,
            out var rect);

        Assert.True(ok);
        Assert.Equal(new ScreenCapturePixelRect(1800, 1800, 200, 200), rect);
    }

    [Fact]
    public void TryMapToPixelRect_ClampsSelectionThatStartsOutsideCanvas()
    {
        var ok = ScreenCaptureSelectionMapper.TryMapToPixelRect(
            selectionX: -20,
            selectionY: -10,
            selectionWidth: 120,
            selectionHeight: 60,
            canvasWidth: 100,
            canvasHeight: 100,
            imageWidth: 200,
            imageHeight: 200,
            out var rect);

        Assert.True(ok);
        Assert.Equal(new ScreenCapturePixelRect(0, 0, 200, 100), rect);
    }

    [Theory]
    [InlineData(0, 10, 100, 100)]
    [InlineData(10, 0, 100, 100)]
    [InlineData(10, 10, 0, 100)]
    [InlineData(10, 10, 100, 0)]
    public void TryMapToPixelRect_RejectsInvalidDimensions(
        double selectionWidth,
        double selectionHeight,
        double canvasWidth,
        double canvasHeight)
    {
        var ok = ScreenCaptureSelectionMapper.TryMapToPixelRect(
            selectionX: 0,
            selectionY: 0,
            selectionWidth,
            selectionHeight,
            canvasWidth,
            canvasHeight,
            imageWidth: 100,
            imageHeight: 100,
            out _);

        Assert.False(ok);
    }

    [Fact]
    public void Expand_AddsPaddingAndClampsToCaptureBounds()
    {
        var rect = ScreenCaptureSelectionMapper.Expand(
            new ScreenCapturePixelRect(5, 10, 50, 60),
            imageWidth: 100,
            imageHeight: 120,
            padding: 20);

        Assert.Equal(new ScreenCapturePixelRect(0, 0, 75, 90), rect);
    }

    [Theory]
    [InlineData(50, 50, 12)]
    [InlineData(250, 250, 20)]
    [InlineData(1000, 1000, 64)]
    public void GetQuietZonePadding_UsesBoundedSelectionRelativePadding(
        int width,
        int height,
        int expectedPadding)
    {
        var padding = ScreenCaptureSelectionMapper.GetQuietZonePadding(
            new ScreenCapturePixelRect(0, 0, width, height));

        Assert.Equal(expectedPadding, padding);
    }
}
