using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace WinOTP.Helpers;

internal static class ImportDialogHelper
{
    public static async Task ShowImportSummaryAsync(
        XamlRoot xamlRoot,
        int successCount,
        int failCount,
        int skippedCount,
        string? skippedLabel = null,
        int replacedCount = 0,
        string? additionalMessage = null)
    {
        var message = $"Import completed:\n• {successCount} account(s) imported successfully";

        if (replacedCount > 0)
            message += $"\n• {replacedCount} existing account(s) replaced";

        if (failCount > 0)
            message += $"\n• {failCount} account(s) failed to import";

        if (skippedCount > 0)
        {
            var label = string.IsNullOrEmpty(skippedLabel) ? string.Empty : $" ({skippedLabel})";
            message += $"\n• {skippedCount} account(s) skipped{label}";
        }

        if (!string.IsNullOrEmpty(additionalMessage))
            message += $"\n\n{additionalMessage}";

        await DialogHelper.ShowOkAsync(xamlRoot, "Import Results", message);
    }
}

internal sealed class ImportProgressDialog : IAsyncDisposable
{
    private readonly ContentDialog _dialog;
    private readonly ProgressBar _progressBar;
    private readonly TextBlock _statusText;
    private readonly Task<ContentDialogResult> _showTask;
    private int _total;
    private int _lastCurrent = -1;

    public ImportProgressDialog(XamlRoot xamlRoot, int total)
    {
        _total = total;

        _statusText = new TextBlock
        {
            Text = IsDeterminate ? $"Importing 0 of {total}…" : "Importing…",
            Margin = new Thickness(0, 0, 0, 12)
        };

        _progressBar = new ProgressBar
        {
            Minimum = 0,
            Maximum = IsDeterminate ? total : 1,
            Value = 0,
            IsIndeterminate = !IsDeterminate
        };

        var panel = new StackPanel { MinWidth = 320 };
        panel.Children.Add(_statusText);
        panel.Children.Add(_progressBar);

        _dialog = new ContentDialog
        {
            Title = "Importing accounts…",
            Content = panel,
            XamlRoot = xamlRoot
        };

        _showTask = _dialog.ShowAsync().AsTask();
    }

    private bool IsDeterminate => _total > 0;

    public void UpdateProgress(int current, int total)
    {
        if (_lastCurrent == current && _total == total) return;

        if (_total != total)
        {
            _total = total;
            _progressBar.Maximum = IsDeterminate ? total : 1;
        }

        if (_progressBar.IsIndeterminate && IsDeterminate)
            _progressBar.IsIndeterminate = false;

        _statusText.Text = IsDeterminate
            ? $"Importing {current} of {_total}…"
            : $"Importing {current}…";
        _progressBar.Value = current;
        _lastCurrent = current;
    }

    public async ValueTask DisposeAsync()
    {
        _dialog.Hide();

        try
        {
            await _showTask;
        }
        catch
        {
            // ContentDialog can throw when hidden mid-show; safe to swallow.
        }
    }
}
