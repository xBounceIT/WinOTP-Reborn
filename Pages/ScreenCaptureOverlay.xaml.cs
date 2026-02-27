using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI;
using Microsoft.UI.Input;
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
        RootGrid.KeyDown += OnKeyDown;

        // Ensure the overlay gets keyboard focus
        RootGrid.Focus(FocusState.Programmatic);

        this.Activate();

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
            _resultTcs.TrySetResult(null);
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
            _resultTcs.TrySetResult(null);
        }
        this.Close();
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Escape)
        {
            _resultTcs.TrySetResult(null);
            this.Close();
            e.Handled = true;
        }
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

    // P/Invoke for window positioning
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hwnd, IntPtr hwndInsertAfter,
        int x, int y, int cx, int cy, uint flags);
}
