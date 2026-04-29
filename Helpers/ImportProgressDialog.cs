using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace WinOTP.Helpers;

internal sealed class ImportProgressDialog : IAsyncDisposable
{
    private readonly ContentDialog _dialog;
    private readonly ProgressBar _progressBar;
    private readonly TextBlock _statusText;
    private readonly Task<ContentDialogResult> _showTask;
    private int _total;
    private int _lastCurrent = -1;
    private bool _isClosing;

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

        var panel = new StackPanel();
        panel.Children.Add(_statusText);
        panel.Children.Add(_progressBar);

        _dialog = new ContentDialog
        {
            Title = "Importing accounts…",
            Content = panel,
            XamlRoot = xamlRoot
        };

        _dialog.Closing += OnDialogClosing;

        _showTask = _dialog.ShowAsync().AsTask();
    }

    private bool IsDeterminate => _total > 0;

    public void UpdateProgress(int current, int total)
    {
        bool indeterminateNeedsFlip = _progressBar.IsIndeterminate && total > 0;
        if (_lastCurrent == current && _total == total && !indeterminateNeedsFlip)
            return;

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
        _isClosing = true;
        _dialog.Closing -= OnDialogClosing;
        _dialog.Hide();

        try
        {
            await _showTask;
        }
        catch (Exception ex) when (ex is InvalidOperationException or COMException)
        {
            App.Current.Logger.Warn($"ImportProgressDialog dispose swallowed dialog lifecycle exception: {ex.Message}");
        }
    }

    private void OnDialogClosing(ContentDialog sender, ContentDialogClosingEventArgs args)
    {
        if (!_isClosing)
            args.Cancel = true;
    }
}
