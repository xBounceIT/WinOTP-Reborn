using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using System.Collections.ObjectModel;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class HomePage : Page
{
    private readonly ICredentialManagerService _credentialManager;
    private readonly ITotpCodeGenerator _totpGenerator;
    private readonly IAppLogger _logger;

    private readonly ObservableCollection<OtpAccount> _accounts = new();
    private DispatcherTimer _refreshTimer = null!;

    public HomePage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _totpGenerator = App.Current.TotpGenerator;
        _logger = App.Current.Logger;

        OtpListView.ItemsSource = _accounts;
        InitializeRefreshTimer();
    }

    private void InitializeRefreshTimer()
    {
        _refreshTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(100)
        };

        _refreshTimer.Tick += RefreshTimer_Tick;
        _refreshTimer.Start();
    }

    private void RefreshTimer_Tick(object? sender, object e)
    {
        try
        {
            UpdateAllCodes();
        }
        catch (Exception ex)
        {
            _refreshTimer.Stop();
            _logger.Error("Unhandled exception while refreshing TOTP codes.", ex);
            ShowOperationError("Code refresh stopped due to an unexpected error. Reopen the app to retry.");
        }
    }

    private void UpdateAllCodes()
    {
        var accountsSnapshot = _accounts.ToArray();

        foreach (var account in accountsSnapshot)
        {
            var container = OtpListView.ContainerFromItem(account) as ListViewItem;
            if (container?.ContentTemplateRoot is not Grid grid)
            {
                continue;
            }

            var codeBlock = FindChild<TextBlock>(grid, "CodeTextBlock");
            var progressBar = FindChild<ProgressBar>(grid, "ProgressBar");
            var remainingBlock = FindChild<TextBlock>(grid, "RemainingTextBlock");

            if (codeBlock != null)
            {
                codeBlock.Text = _totpGenerator.GenerateCode(account);
            }

            if (progressBar != null)
            {
                progressBar.Value = _totpGenerator.GetProgressPercentage(account);
            }

            if (remainingBlock != null)
            {
                remainingBlock.Text = $"{_totpGenerator.GetRemainingSeconds(account)}s";
            }
        }
    }

    private static T? FindChild<T>(DependencyObject parent, string name) where T : FrameworkElement
    {
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T t && t.Name == name)
            {
                return t;
            }

            var result = FindChild<T>(child, name);
            if (result != null)
            {
                return result;
            }
        }

        return null;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        try
        {
            if (e.Parameter is OtpAccount newAccount)
            {
                var saveResult = await _credentialManager.SaveAccountAsync(newAccount);
                if (!saveResult.Success)
                {
                    ShowOperationError(saveResult.Message);
                    _logger.Warn($"Save account failed on navigation: {saveResult.ErrorCode} - {saveResult.Message}");
                }

                // Remove the AddAccountPage from back stack but keep HomePage
                var addAccountEntry = Frame.BackStack.LastOrDefault(entry => entry.SourcePageType == typeof(AddAccountPage));
                if (addAccountEntry != null)
                {
                    Frame.BackStack.Remove(addAccountEntry);
                }
            }

            await LoadAccountsAsync();
        }
        catch (Exception ex)
        {
            _logger.Error("Unhandled exception while navigating to HomePage.", ex);
            ShowOperationError("Unable to load accounts due to an unexpected error.");
        }
    }

    private async Task LoadAccountsAsync()
    {
        var loadResult = await _credentialManager.LoadAccountsAsync();

        _accounts.Clear();
        foreach (var account in loadResult.Accounts)
        {
            _accounts.Add(account);
        }

        UpdateEmptyState();
        SortAccounts();
        UpdateLoadIssuesState(loadResult.Issues);
    }

    private void UpdateLoadIssuesState(IReadOnlyList<CredentialIssue> issues)
    {
        if (issues.Count == 0)
        {
            LoadIssuesInfoBar.IsOpen = false;
            LoadIssuesInfoBar.Message = string.Empty;
            return;
        }

        var issueSummary = string.Join(", ", issues
            .GroupBy(i => i.Code)
            .Select(g => $"{g.Key}: {g.Count()}"));

        LoadIssuesInfoBar.Message = $"{issues.Count} stored credential(s) were skipped ({issueSummary}). See local log for details.";
        LoadIssuesInfoBar.IsOpen = true;
    }

    private void ShowOperationError(string message)
    {
        OperationInfoBar.Message = message;
        OperationInfoBar.IsOpen = true;
    }

    private void UpdateEmptyState()
    {
        EmptyStatePanel.Visibility = _accounts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        OtpListView.Visibility = _accounts.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
    }

    private void SortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        SortAccounts();
    }

    private void SortAccounts()
    {
        var sorted = SortComboBox.SelectedIndex switch
        {
            0 => _accounts.OrderByDescending(a => a.CreatedAt),
            1 => _accounts.OrderBy(a => a.CreatedAt),
            2 => _accounts.OrderBy(a => a.DisplayLabel),
            3 => _accounts.OrderByDescending(a => a.DisplayLabel),
            _ => _accounts.OrderByDescending(a => a.CreatedAt)
        };

        var sortedList = sorted.ToList();
        _accounts.Clear();
        foreach (var account in sortedList)
        {
            _accounts.Add(account);
        }
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(AddAccountPage));
    }

    private async void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Tag is not string id)
        {
            return;
        }

        var account = _accounts.FirstOrDefault(a => a.Id == id);
        if (account == null)
        {
            return;
        }

        var dialog = new ContentDialog
        {
            Title = "Delete Account?",
            Content = $"Are you sure you want to delete '{account.DisplayLabel}'?",
            PrimaryButtonText = "Delete",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return;
        }

        var deleteResult = await _credentialManager.DeleteAccountAsync(id);
        if (!deleteResult.Success)
        {
            ShowOperationError(deleteResult.Message);
            _logger.Warn($"Delete account failed: {deleteResult.ErrorCode} - {deleteResult.Message}");
            return;
        }

        _accounts.Remove(account);
        UpdateEmptyState();
    }
}
