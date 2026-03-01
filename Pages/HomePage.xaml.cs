using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.UI.Xaml.Shapes;
using Windows.ApplicationModel.DataTransfer;
using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class HomePage : Page
{
    private const double CardWidth = 368; // 360 + 8 for margins
    private const int NextCodePreviewThresholdSeconds = 5;
    private const string VaultLoadFailureMessage = "Unable to access Windows Credential Manager. Saved accounts could not be loaded.";

    private readonly ICredentialManagerService _credentialManager;
    private readonly IAppSettingsService _appSettings;
    private readonly ITotpCodeGenerator _totpGenerator;
    private readonly IAppLogger _logger;

    private readonly List<OtpAccount> _allAccounts = new();
    private List<OtpAccount> _accounts = new();
    private readonly Dictionary<string, CardElementCache> _elementCache = new();
    private ItemsWrapGrid? _itemsPanel;
    private int _currentSortIndex = 0;
    private string _searchText = string.Empty;
    private bool _isRefreshSubscribed;
    private bool _isShowingVaultLoadError;

    private record CardElementCache(
        TextBlock CodeTextBlock,
        Rectangle ProgressBarFill,
        TextBlock RemainingTextBlock,
        TextBlock NextCodeTextBlock)
    {
        public bool IsNextCodeVisible { get; set; }
    }

    public HomePage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _appSettings = App.Current.AppSettings;
        _totpGenerator = App.Current.TotpGenerator;
        _logger = App.Current.Logger;

        OtpGridView.ItemsSource = _accounts;

        this.SizeChanged += HomePage_SizeChanged;
        this.Unloaded += HomePage_Unloaded;
        OtpGridView.Loaded += OtpGridView_Loaded;
        OtpGridView.ContainerContentChanging += OtpGridView_ContainerContentChanging;
    }

    private void OtpGridView_ContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.Item is not OtpAccount account)
        {
            return;
        }

        if (args.InRecycleQueue)
        {
            // Container is being recycled, remove from cache
            _elementCache.Remove(account.Id);
            return;
        }

        // Container is being realized, cache the UI elements
        if (args.ItemContainer is GridViewItem container &&
            OtpCardTemplateRootPolicy.TryGetSearchRoot(container.ContentTemplateRoot, out var searchRoot))
        {
            var codeBlock = FindTemplateChild<TextBlock>(searchRoot, "CodeTextBlock");
            var progressBarFill = FindTemplateChild<Rectangle>(searchRoot, "ProgressBarFill");
            var remainingBlock = FindTemplateChild<TextBlock>(searchRoot, "RemainingTextBlock");
            var nextCodeBlock = FindTemplateChild<TextBlock>(searchRoot, "NextCodeTextBlock");

            if (codeBlock != null && progressBarFill != null && remainingBlock != null && nextCodeBlock != null)
            {
                var cache = new CardElementCache(codeBlock, progressBarFill, remainingBlock, nextCodeBlock);
                _elementCache[account.Id] = cache;

                // Initial update
                UpdateCardValues(account, cache, _appSettings.ShowNextCodeWhenFiveSecondsRemain);
            }
        }
    }

    private void OtpGridView_Loaded(object? sender, RoutedEventArgs e)
    {
        // Get the ItemsWrapGrid from the visual tree
        _itemsPanel = FindChild<ItemsWrapGrid>(OtpGridView, "OtpItemsWrapGrid");
        UpdateGridColumns();
    }

    private void HomePage_SizeChanged(object? sender, SizeChangedEventArgs e)
    {
        UpdateGridColumns();
    }

    private void UpdateGridColumns()
    {
        if (_itemsPanel == null)
        {
            return;
        }

        // Calculate how many cards can fit in the available width
        double availableWidth = OtpGridView.ActualWidth - 32; // Account for padding
        int columns = Math.Max(1, (int)(availableWidth / CardWidth));

        _itemsPanel.MaximumRowsOrColumns = columns;
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

    private void CompositionTarget_Rendering(object? sender, object e)
    {
        try
        {
            UpdateAllCodes();
        }
        catch (Exception ex)
        {
            StopRefreshUpdates();
            _logger.Error("Unhandled exception while refreshing TOTP codes.", ex);
            ShowOperationError("Code refresh stopped due to an unexpected error. Reopen the app to retry.");
        }
    }

    private void HomePage_Unloaded(object sender, RoutedEventArgs e)
    {
        // Ensure refresh loop is stopped when page leaves visual tree.
        StopRefreshUpdates();
    }

    private void StartRefreshUpdates()
    {
        if (_isRefreshSubscribed)
        {
            return;
        }

        CompositionTarget.Rendering += CompositionTarget_Rendering;
        _isRefreshSubscribed = true;
    }

    private void StopRefreshUpdates()
    {
        if (!_isRefreshSubscribed)
        {
            return;
        }

        CompositionTarget.Rendering -= CompositionTarget_Rendering;
        _isRefreshSubscribed = false;
    }

    private void UpdateAllCodes()
    {
        var showNextCodeHint = _appSettings.ShowNextCodeWhenFiveSecondsRemain;

        foreach (var (accountId, cache) in _elementCache)
        {
            var account = _accounts.FirstOrDefault(a => a.Id == accountId);
            if (account == null)
            {
                continue;
            }

            UpdateCardValues(account, cache, showNextCodeHint);
        }
    }

    private void UpdateCardValues(OtpAccount account, CardElementCache cache, bool showNextCodeHint)
    {
        cache.CodeTextBlock.Text = _totpGenerator.GenerateCode(account);

        var remainingSeconds = _totpGenerator.GetRemainingSeconds(account);
        cache.RemainingTextBlock.Text = $"{remainingSeconds}s";

        var shouldShowNextCode = showNextCodeHint &&
            remainingSeconds > 0 &&
            remainingSeconds <= NextCodePreviewThresholdSeconds;

        if (shouldShowNextCode)
        {
            var nextCodeTimestamp = DateTime.UtcNow.AddSeconds(remainingSeconds);
            cache.NextCodeTextBlock.Text = _totpGenerator.GenerateCodeAt(account, nextCodeTimestamp);

            if (!cache.IsNextCodeVisible)
            {
                AnimateNextCodeOpacity(cache, 1);
                cache.IsNextCodeVisible = true;
            }
        }
        else
        {
            if (cache.IsNextCodeVisible)
            {
                AnimateNextCodeOpacity(cache, 0);
                cache.IsNextCodeVisible = false;
            }
        }

        // Calculate progress bar fill width based on parent Grid's actual width
        var progress = _totpGenerator.GetProgressPercentage(account);
        var parentGrid = cache.ProgressBarFill.Parent as FrameworkElement;
        if (parentGrid != null)
        {
            cache.ProgressBarFill.Width = Math.Max(0, parentGrid.ActualWidth * progress);
        }
    }

    private void AnimateNextCodeOpacity(CardElementCache cache, double targetOpacity)
    {
        var animation = new DoubleAnimation
        {
            From = cache.NextCodeTextBlock.Opacity,
            To = targetOpacity,
            Duration = TimeSpan.FromMilliseconds(200),
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        };

        Storyboard.SetTarget(animation, cache.NextCodeTextBlock);
        Storyboard.SetTargetProperty(animation, "Opacity");

        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Begin();
    }

    private static T? FindTemplateChild<T>(DependencyObject parent, string name) where T : FrameworkElement
    {
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T t && t.Name == name)
            {
                return t;
            }

            var result = FindTemplateChild<T>(child, name);
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
        StartRefreshUpdates();

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
                else
                {
                    AddFlowNavigationHelper.RemoveCompletedAddFlowEntries(Frame);
                }
            }
            else if (e.Parameter is string parameter &&
                parameter == AddFlowNavigationHelper.CleanupCompletedAddFlowParameter)
            {
                AddFlowNavigationHelper.RemoveCompletedAddFlowEntries(Frame);
            }

            await LoadAccountsAsync();
        }
        catch (Exception ex)
        {
            _logger.Error("Unhandled exception while navigating to HomePage.", ex);
            ShowOperationError("Unable to load accounts due to an unexpected error.");
        }
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        StopRefreshUpdates();
        base.OnNavigatedFrom(e);
    }

    private async Task LoadAccountsAsync()
    {
        var loadResult = await _credentialManager.LoadAccountsAsync();

        _allAccounts.Clear();
        _allAccounts.AddRange(loadResult.Accounts);

        ApplyFilterAndSort();
        UpdateLoadIssuesState(loadResult.Issues);
    }

    private void UpdateLoadIssuesState(IReadOnlyList<CredentialIssue> issues)
    {
        var vaultIssues = issues
            .Where(i => i.Code == CredentialIssueCode.VaultAccessFailed)
            .ToList();
        var credentialIssues = issues
            .Where(i => i.Code != CredentialIssueCode.VaultAccessFailed)
            .ToList();

        if (vaultIssues.Count > 0)
        {
            ShowVaultLoadError();
        }
        else
        {
            ClearVaultLoadError();
        }

        if (credentialIssues.Count == 0)
        {
            LoadIssuesInfoBar.IsOpen = false;
            LoadIssuesInfoBar.Message = string.Empty;
            return;
        }

        var issueSummary = string.Join(", ", credentialIssues
            .GroupBy(i => i.Code)
            .Select(g => $"{g.Key}: {g.Count()}"));

        LoadIssuesInfoBar.Message = $"{credentialIssues.Count} stored credential(s) were skipped ({issueSummary}). See local log for details.";
        LoadIssuesInfoBar.IsOpen = true;
    }

    private void ShowOperationError(string message)
    {
        _isShowingVaultLoadError = false;
        OperationInfoBar.Message = message;
        OperationInfoBar.IsOpen = true;
    }

    private void ShowVaultLoadError()
    {
        OperationInfoBar.Message = VaultLoadFailureMessage;
        OperationInfoBar.IsOpen = true;
        _isShowingVaultLoadError = true;
    }

    private void ClearVaultLoadError()
    {
        if (!_isShowingVaultLoadError)
        {
            return;
        }

        OperationInfoBar.IsOpen = false;
        OperationInfoBar.Message = string.Empty;
        _isShowingVaultLoadError = false;
    }

    private void UpdateEmptyState()
    {
        EmptyStatePanel.Visibility = _accounts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        OtpGridView.Visibility = _accounts.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
    }

    private void SortMenuItem_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not RadioMenuFlyoutItem menuItem || menuItem.Tag is not string tag)
        {
            return;
        }

        _currentSortIndex = int.Parse(tag);
        ApplyFilterAndSort();
    }

    private void SearchBox_TextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason == AutoSuggestionBoxTextChangeReason.UserInput)
        {
            _searchText = sender.Text.Trim();
            ApplyFilterAndSort();
        }
    }

    private void SearchBox_QuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        _searchText = args.QueryText.Trim();
        ApplyFilterAndSort();
    }

    private void ApplyFilterAndSort()
    {
        // Filter accounts based on search text
        var filtered = string.IsNullOrWhiteSpace(_searchText)
            ? _allAccounts.AsEnumerable()
            : _allAccounts.Where(a => a.DisplayLabel.Contains(_searchText, StringComparison.OrdinalIgnoreCase));

        // Apply sorting
        var sorted = _currentSortIndex switch
        {
            0 => filtered.OrderByDescending(a => a.CreatedAt),
            1 => filtered.OrderBy(a => a.CreatedAt),
            2 => filtered.OrderBy(a => a.DisplayLabel),
            3 => filtered.OrderByDescending(a => a.DisplayLabel),
            _ => filtered.OrderByDescending(a => a.CreatedAt)
        };

        // Update the list and rebind ItemsSource for a single UI update
        _accounts = sorted.ToList();
        _elementCache.Clear();
        OtpGridView.ItemsSource = _accounts;

        UpdateEmptyState();
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(AddAccountPage));
    }

    private async void CopyButton_Click(object sender, RoutedEventArgs e)
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

        try
        {
            var totpCode = _totpGenerator.GenerateCode(account);
            var dataPackage = new DataPackage();
            dataPackage.SetText(totpCode);
            Clipboard.SetContent(dataPackage);
            Clipboard.Flush();

            // Visual feedback: change button icon to checkmark
            var copyIcon = FindChild<FontIcon>(button, "CopyButtonIcon");
            if (copyIcon != null)
            {
                copyIcon.Glyph = "\uE73E"; // Checkmark icon
            }

            // Reset icon after 2 seconds
            await Task.Delay(2000);
            if (copyIcon != null)
            {
                copyIcon.Glyph = "\uE8C8"; // Copy icon
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to copy TOTP code to clipboard", ex);
            ShowOperationError("Failed to copy the TOTP code to clipboard");
        }
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

        _allAccounts.Remove(account);
        ApplyFilterAndSort();
    }
}
