namespace WinOTP.Helpers;

public readonly record struct ScreenCapturePixelRect(int X, int Y, int Width, int Height);

public static class ScreenCaptureSelectionMapper
{
    public static bool TryMapToPixelRect(
        double selectionX,
        double selectionY,
        double selectionWidth,
        double selectionHeight,
        double canvasWidth,
        double canvasHeight,
        int imageWidth,
        int imageHeight,
        out ScreenCapturePixelRect rect)
    {
        rect = default;

        if (selectionWidth <= 0 ||
            selectionHeight <= 0 ||
            canvasWidth <= 0 ||
            canvasHeight <= 0 ||
            imageWidth <= 0 ||
            imageHeight <= 0)
        {
            return false;
        }

        var scaleX = imageWidth / canvasWidth;
        var scaleY = imageHeight / canvasHeight;

        var left = (int)Math.Floor(selectionX * scaleX);
        var top = (int)Math.Floor(selectionY * scaleY);
        var right = (int)Math.Ceiling((selectionX + selectionWidth) * scaleX);
        var bottom = (int)Math.Ceiling((selectionY + selectionHeight) * scaleY);

        left = Math.Clamp(left, 0, imageWidth);
        top = Math.Clamp(top, 0, imageHeight);
        right = Math.Clamp(right, 0, imageWidth);
        bottom = Math.Clamp(bottom, 0, imageHeight);

        var width = right - left;
        var height = bottom - top;
        if (width <= 0 || height <= 0)
        {
            return false;
        }

        rect = new ScreenCapturePixelRect(left, top, width, height);
        return true;
    }

    public static ScreenCapturePixelRect Expand(
        ScreenCapturePixelRect rect,
        int imageWidth,
        int imageHeight,
        int padding)
    {
        if (padding <= 0)
        {
            return rect;
        }

        var left = Math.Max(0, rect.X - padding);
        var top = Math.Max(0, rect.Y - padding);
        var right = Math.Min(imageWidth, rect.X + rect.Width + padding);
        var bottom = Math.Min(imageHeight, rect.Y + rect.Height + padding);

        return new ScreenCapturePixelRect(left, top, right - left, bottom - top);
    }

    public static int GetQuietZonePadding(ScreenCapturePixelRect rect)
    {
        var shortestSide = Math.Min(rect.Width, rect.Height);
        return Math.Clamp((int)Math.Ceiling(shortestSide * 0.08), 12, 64);
    }
}
