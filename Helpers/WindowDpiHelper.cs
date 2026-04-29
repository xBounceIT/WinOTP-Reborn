using System;
using System.Runtime.InteropServices;
using Windows.Graphics;

namespace WinOTP.Helpers;

public static class WindowDpiHelper
{
    private const double ReferenceDpi = 96.0;

    public static SizeInt32 ScaleLogicalSize(uint dpi, int logicalWidth, int logicalHeight)
    {
        double scale = dpi == 0 ? 1.0 : dpi / ReferenceDpi;
        return new SizeInt32(
            (int)Math.Round(logicalWidth * scale),
            (int)Math.Round(logicalHeight * scale));
    }

    public static uint GetDpiForWindow(IntPtr hwnd) => NativeMethods.GetDpiForWindow(hwnd);

    private static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hwnd);
    }
}
