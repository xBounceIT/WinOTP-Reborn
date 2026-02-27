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
    private ObservableCollection<OtpAccount> _accounts = new();
    private DispatcherTimer _refreshTimer = null!;

    public HomePage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _totpGenerator = App.Current.TotpGenerator;
        OtpListView.ItemsSource = _accounts;
        InitializeRefreshTimer();
    }

    private void InitializeRefreshTimer()
    {
        _refreshTimer = new DispatcherTimer();
        _refreshTimer.Interval = TimeSpan.FromMilliseconds(100);
        _refreshTimer.Tick += RefreshTimer_Tick;
        _refreshTimer.Start();
    }

    private void RefreshTimer_Tick(object? sender, object e)
    {
        UpdateAllCodes();
    }

    private void UpdateAllCodes()
    {
        var accountsSnapshot = _accounts.ToArray();

        foreach (var account in accountsSnapshot)
        {
            var container = OtpListView.ContainerFromItem(account) as ListViewItem;
            if (container?.ContentTemplateRoot is Grid grid)
            {
                var codeBlock = FindChild<TextBlock>(grid, "CodeTextBlock");
                var progressBar = FindChild<ProgressBar>(grid, "ProgressBar");
                var remainingBlock = FindChild<TextBlock>(grid, "RemainingTextBlock");

                if (codeBlock != null)
                    codeBlock.Text = _totpGenerator.GenerateCode(account);
                if (progressBar != null)
                    progressBar.Value = _totpGenerator.GetProgressPercentage(account);
                if (remainingBlock != null)
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
                return t;
            var result = FindChild<T>(child, name);
            if (result != null)
                return result;
        }
        return null;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        if (e.Parameter is OtpAccount newAccount)
        {
            await _credentialManager.SaveAccountAsync(newAccount);
            // Remove the AddAccountPage from back stack but keep HomePage
            var addAccountEntry = Frame.BackStack.LastOrDefault(entry => entry.SourcePageType == typeof(AddAccountPage));
            if (addAccountEntry != null)
            {
                Frame.BackStack.Remove(addAccountEntry);
            }
        }

        await LoadAccountsAsync();
    }

    private async Task LoadAccountsAsync()
    {
        var accounts = await _credentialManager.LoadAccountsAsync();
        _accounts.Clear();
        foreach (var account in accounts)
        {
            _accounts.Add(account);
        }
        UpdateEmptyState();
        SortAccounts();
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
        if (sender is Button button && button.Tag is string id)
        {
            var account = _accounts.FirstOrDefault(a => a.Id == id);
            if (account == null) return;

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
            if (result == ContentDialogResult.Primary)
            {
                await _credentialManager.DeleteAccountAsync(id);
                _accounts.Remove(account);
                UpdateEmptyState();
            }
        }
    }
}
