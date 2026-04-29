using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using WinOTP.Helpers;

namespace WinOTP.Pages;

public sealed partial class ScreenCaptureOverlay : Window
{
    private readonly TaskCompletionSource<string?> _resultTcs = new();
    private ScreenCapture? _capture;
    private Windows.Foundation.Point _startPoint;
    private Rectangle? _selectionRect;
    private bool _isDragging;
    // Hold the delegate as a field so the GC doesn't collect it while the
    // unmanaged hook is still calling into it.
    private LowLevelKeyboardProc? _keyboardHookProc;
    private IntPtr _keyboardHook = IntPtr.Zero;

    public ScreenCaptureOverlay()
    {
        this.InitializeComponent();
    }

    public async Task<string?> StartCaptureAsync(ScreenCapture capture)
    {
        _capture = capture;

        // Make fullscreen borderless
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var presenter = this.AppWindow.Presenter as OverlappedPresenter;
        if (presenter != null)
        {
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.SetBorderAndTitleBar(false, false);
        }

        // Cover the full virtual screen
        SetWindowPos(hwnd, HWND_TOPMOST,
            capture.Left, capture.Top, capture.Width, capture.Height,
            SWP_SHOWWINDOW);

        // Display the screenshot
        await DisplayScreenshotAsync(capture);

        // Wire up input events
        OverlayCanvas.PointerPressed += OnPointerPressed;
        OverlayCanvas.PointerMoved += OnPointerMoved;
        OverlayCanvas.PointerReleased += OnPointerReleased;

        this.Activate();

        // MainWindow was minimized before this opened, so this process is no
        // longer foreground and SetForegroundWindow is restricted. Without
        // this AttachThreadInput dance the overlay is topmost-but-unfocused.
        ForceForeground(hwnd);

        // ESC is handled by a low-level keyboard hook rather than the WinUI3
        // input island. The island only fires KeyDown when it actually owns
        // OS keyboard focus, which doesn't reliably happen here (the parent
        // HWND becomes foreground but focus doesn't always propagate to the
        // child island HWND). The LL hook intercepts ESC at the OS level and
        // suppresses propagation, so the background app never sees the key.
        _keyboardHookProc = OnLowLevelKey;
        _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardHookProc, GetModuleHandle(null), 0);

        this.Closed += OnClosed;

        return await _resultTcs.Task;
    }

    private async Task DisplayScreenshotAsync(ScreenCapture capture)
    {
        var bitmap = new WriteableBitmap(capture.Width, capture.Height);
        using (var pixelStream = bitmap.PixelBuffer.AsStream())
        {
            await pixelStream.WriteAsync(capture.Pixels.AsMemory(0, capture.Pixels.Length));
        }
        bitmap.Invalidate();
        ScreenshotImage.Source = bitmap;
    }

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        var point = e.GetCurrentPoint(OverlayCanvas);
        if (point.Properties.IsRightButtonPressed)
        {
            e.Handled = true;
            this.Close();
            return;
        }
        if (point.Properties.IsLeftButtonPressed)
        {
            _isDragging = true;
            _startPoint = point.Position;
            OverlayCanvas.CapturePointer(e.Pointer);

            // Remove previous selection rectangle if any
            if (_selectionRect != null)
            {
                OverlayCanvas.Children.Remove(_selectionRect);
            }

            _selectionRect = new Rectangle
            {
                Stroke = new SolidColorBrush(Colors.White),
                StrokeThickness = 2,
                StrokeDashArray = [5, 3],
                Fill = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(1, 0, 0, 0)) // Nearly transparent to "cut through" the overlay
            };
            Canvas.SetLeft(_selectionRect, _startPoint.X);
            Canvas.SetTop(_selectionRect, _startPoint.Y);
            OverlayCanvas.Children.Add(_selectionRect);

            e.Handled = true;
        }
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_isDragging || _selectionRect == null) return;

        var point = e.GetCurrentPoint(OverlayCanvas);
        var currentPoint = point.Position;

        var x = Math.Min(_startPoint.X, currentPoint.X);
        var y = Math.Min(_startPoint.Y, currentPoint.Y);
        var width = Math.Abs(currentPoint.X - _startPoint.X);
        var height = Math.Abs(currentPoint.Y - _startPoint.Y);

        Canvas.SetLeft(_selectionRect, x);
        Canvas.SetTop(_selectionRect, y);
        _selectionRect.Width = width;
        _selectionRect.Height = height;

        e.Handled = true;
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_isDragging || _selectionRect == null || _capture == null) return;

        _isDragging = false;
        OverlayCanvas.ReleasePointerCapture(e.Pointer);

        var x = (int)Canvas.GetLeft(_selectionRect);
        var y = (int)Canvas.GetTop(_selectionRect);
        var width = (int)_selectionRect.Width;
        var height = (int)_selectionRect.Height;

        e.Handled = true;

        // Minimum selection size
        if (width < 10 || height < 10)
        {
            return;
        }

        // Crop pixels from the captured screen
        var croppedPixels = CropPixels(_capture.Pixels, _capture.Width, _capture.Height, x, y, width, height);
        if (croppedPixels == null)
        {
            this.Close();
            return;
        }

        // Decode QR code from cropped region
        try
        {
            var qrText = QrCodeHelper.DecodeFromPixels(croppedPixels, width, height);
            _resultTcs.TrySetResult(qrText);
        }
        catch
        {
        }
        this.Close();
    }

    private IntPtr OnLowLevelKey(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
            {
                var vk = Marshal.ReadInt32(lParam);
                if (vk == VK_ESCAPE)
                {
                    DispatcherQueue.TryEnqueue(this.Close);
                    return new IntPtr(1);
                }
            }
        }
        return CallNextHookEx(_keyboardHook, code, wParam, lParam);
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        if (_keyboardHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = IntPtr.Zero;
        }
        _keyboardHookProc = null;
        _resultTcs.TrySetResult(null);
    }

    private static byte[]? CropPixels(byte[] source, int sourceWidth, int sourceHeight,
        int cropX, int cropY, int cropWidth, int cropHeight)
    {
        // Clamp to source bounds
        cropX = Math.Max(0, Math.Min(cropX, sourceWidth - 1));
        cropY = Math.Max(0, Math.Min(cropY, sourceHeight - 1));
        cropWidth = Math.Min(cropWidth, sourceWidth - cropX);
        cropHeight = Math.Min(cropHeight, sourceHeight - cropY);

        if (cropWidth <= 0 || cropHeight <= 0)
            return null;

        var cropped = new byte[cropWidth * cropHeight * 4];
        for (var row = 0; row < cropHeight; row++)
        {
            var srcOffset = ((cropY + row) * sourceWidth + cropX) * 4;
            var dstOffset = row * cropWidth * 4;
            System.Buffer.BlockCopy(source, srcOffset, cropped, dstOffset, cropWidth * 4);
        }
        return cropped;
    }

    private static void ForceForeground(IntPtr hwnd)
    {
        var foreground = GetForegroundWindow();
        if (foreground == hwnd)
        {
            return;
        }
        var fgThread = GetWindowThreadProcessId(foreground, out _);
        var currentThread = GetCurrentThreadId();
        // Attach our input queue to the foreground thread so SetForegroundWindow
        // is permitted (the OS otherwise blocks foreground steals from a non-
        // foreground process). Don't SetFocus on hwnd: the WinUI3 content island
        // is a child HWND and SetForegroundWindow routes focus there via
        // WM_ACTIVATE — explicitly focusing the parent breaks island KeyDown.
        var attached = fgThread != 0 && fgThread != currentThread
            && AttachThreadInput(fgThread, currentThread, true);
        SetForegroundWindow(hwnd);
        if (attached)
        {
            AttachThreadInput(fgThread, currentThread, false);
        }
    }

    // P/Invoke for window positioning
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr hwndInsertAfter,
        int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    // Low-level keyboard hook
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_ESCAPE = 0x1B;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);
}
