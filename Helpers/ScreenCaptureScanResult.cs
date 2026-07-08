namespace WinOTP.Helpers;

public enum ScreenCaptureScanStatus
{
    Cancelled,
    Success,
    NoQrCodeFound,
    Failed
}

public sealed record ScreenCaptureScanResult(ScreenCaptureScanStatus Status, string? Text = null)
{
    public static ScreenCaptureScanResult Success(string text) => new(ScreenCaptureScanStatus.Success, text);
    public static ScreenCaptureScanResult Cancelled() => new(ScreenCaptureScanStatus.Cancelled);
    public static ScreenCaptureScanResult NoQrCodeFound() => new(ScreenCaptureScanStatus.NoQrCodeFound);
    public static ScreenCaptureScanResult Failed() => new(ScreenCaptureScanStatus.Failed);
}
