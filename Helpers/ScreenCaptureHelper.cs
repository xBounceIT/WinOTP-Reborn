using System.Runtime.InteropServices;

namespace WinOTP.Helpers;

public sealed record ScreenCapture(byte[] Pixels, int Width, int Height, int Left, int Top);

public static class ScreenCaptureHelper
{
    public static ScreenCapture CaptureFullScreen()
    {
        var left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        var top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        var width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        var height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        var screenDc = GetDC(IntPtr.Zero);
        var memDc = CreateCompatibleDC(screenDc);
        var hBitmap = CreateCompatibleBitmap(screenDc, width, height);
        var oldBitmap = SelectObject(memDc, hBitmap);

        BitBlt(memDc, 0, 0, width, height, screenDc, left, top, SRCCOPY);

        SelectObject(memDc, oldBitmap);

        var pixels = ExtractPixels(hBitmap, width, height);

        DeleteObject(hBitmap);
        DeleteDC(memDc);
        ReleaseDC(IntPtr.Zero, screenDc);

        return new ScreenCapture(pixels, width, height, left, top);
    }

    private static byte[] ExtractPixels(IntPtr hBitmap, int width, int height)
    {
        var bmi = new BITMAPINFO
        {
            bmiHeader = new BITMAPINFOHEADER
            {
                biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
                biWidth = width,
                biHeight = -height, // top-down
                biPlanes = 1,
                biBitCount = 32,
                biCompression = BI_RGB
            }
        };

        var pixels = new byte[width * height * 4];
        var screenDc = GetDC(IntPtr.Zero);
        GetDIBits(screenDc, hBitmap, 0, (uint)height, pixels, ref bmi, DIB_RGB_COLORS);
        ReleaseDC(IntPtr.Zero, screenDc);

        return pixels;
    }

    // Constants
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;
    private const uint SRCCOPY = 0x00CC0020;
    private const uint BI_RGB = 0;
    private const uint DIB_RGB_COLORS = 0;

    // P/Invoke declarations
    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BitBlt(IntPtr dest, int xDest, int yDest, int width, int height,
        IntPtr src, int xSrc, int ySrc, uint rop);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr obj);

    [DllImport("gdi32.dll")]
    private static extern int GetDIBits(IntPtr dc, IntPtr hBitmap, uint start, uint lines,
        byte[] bits, ref BITMAPINFO bmi, uint usage);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
    }
}
