using System.Runtime.InteropServices;
using Windows.ApplicationModel.DataTransfer;

namespace WinOTP.Helpers;

internal static class ClipboardHelper
{
    private const int MaxAttempts = 3;
    private const int RetryDelayMs = 150;

    private static readonly HashSet<int> RetryableHResults = new()
    {
        unchecked((int)0x800401D0), // CLIPBRD_E_CANT_OPEN
        unchecked((int)0x800401D1), // CLIPBRD_E_CANT_EMPTY
        unchecked((int)0x800401D2), // CLIPBRD_E_CANT_SET
        unchecked((int)0x800401D3), // CLIPBRD_E_CANT_CLOSE
        unchecked((int)0x8001010E), // RPC_E_WRONG_THREAD
    };

    public static async Task SetContentWithRetryAsync(string text)
    {
        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                var dataPackage = new DataPackage();
                dataPackage.SetText(text);
                Clipboard.SetContent(dataPackage);
                Clipboard.Flush();
                return;
            }
            catch (COMException ex) when (RetryableHResults.Contains(ex.ErrorCode) && attempt < MaxAttempts)
            {
                App.Current.Logger.Warn(
                    $"Clipboard attempt {attempt} failed (0x{ex.ErrorCode:X8}). Retrying in {RetryDelayMs}ms.");
                await Task.Delay(RetryDelayMs);
            }
        }
    }
}
