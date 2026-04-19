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
    private readonly IBackupService _backupService;

    private readonly List<OtpAccount> _allAccounts = new();
    private List<OtpAccount> _accounts = new();
    private readonly Dictionary<string, CardElementCache> _elementCache = new();
    private ItemsWrapGrid? _itemsPanel;
    private SortOption _currentSortOption = SortOption.DateAddedDesc;
    private string _searchText = string.Empty;
    private DispatcherTimer? _refreshTimer;
    private Dictionary<string, OtpAccount> _accountLookup = new();
    private bool _isShowingVaultLoadError;
    private bool _isPageActive;

    private record CardElementCache(
        TextBlock CodeTextBlock,
        Rectangle ProgressBarFill,
        TextBlock RemainingTextBlock,
        TextBlock NextCodeTextBlock)
    {
        public bool IsNextCodeVisible { get; set; }
        public Storyboard? ActiveProgressStoryboard { get; set; }
        public Storyboard? ActiveOpacityStoryboard { get; set; }

        public void StopAnimations()
        {
            ActiveProgressStoryboard?.Stop();
            ActiveProgressStoryboard = null;
            ActiveOpacityStoryboard?.Stop();
            ActiveOpacityStoryboard = null;
        }
    }

    public HomePage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _appSettings = App.Current.AppSettings;
        _totpGenerator = App.Current.TotpGenerator;
        _logger = App.Current.Logger;
        _backupService = App.Current.BackupService;
        _currentSortOption = _appSettings.AccountSortOption;

        ApplySortSelectionToMenu();

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
            if (_elementCache.TryGetValue(account.Id, out var recycled))
            {
                recycled.StopAnimations();
            }
            _elementCache.Remove(account.Id);
            return;
        }

        if (args.ItemContainer is GridViewItem container &&
            OtpCardTemplateRootPolicy.TryGetSearchRoot(container.ContentTemplateRoot, out var searchRoot))
        {
            var codeBlock = FindChild<TextBlock>(searchRoot, "CodeTextBlock");
            var progressBarFill = FindChild<Rectangle>(searchRoot, "ProgressBarFill");
            var remainingBlock = FindChild<TextBlock>(searchRoot, "RemainingTextBlock");
            var nextCodeBlock = FindChild<TextBlock>(searchRoot, "NextCodeTextBlock");

            if (codeBlock != null && progressBarFill != null && remainingBlock != null && nextCodeBlock != null)
            {
                var cache = new CardElementCache(codeBlock, progressBarFill, remainingBlock, nextCodeBlock);
                _elementCache[account.Id] = cache;

                UpdateCardValues(account, cache, _appSettings.ShowNextCodeWhenFiveSecondsRemain);
                args.RegisterUpdateCallback(UpdateProgressBarAfterLayout);
            }
        }
    }

    private void UpdateProgressBarAfterLayout(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.Item is OtpAccount account &&
            _elementCache.TryGetValue(account.Id, out var cache))
        {
            UpdateCardValues(account, cache, _appSettings.ShowNextCodeWhenFiveSecondsRemain);
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

        double availableWidth = OtpGridView.ActualWidth - 32;
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

    private void RefreshTimer_Tick(object? sender, object e)
    {
        try
        {
            _refreshTimer!.Interval = GetIntervalToNextSecond();
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
        _isPageActive = false;
        StopRefreshUpdates();
    }

    private static TimeSpan GetIntervalToNextSecond()
    {
        var ms = 1000 - DateTimeOffset.UtcNow.Millisecond;
        // Floor at 100ms to avoid near-zero intervals that cause back-to-back ticks
        return TimeSpan.FromMilliseconds(Math.Max(100, ms));
    }

    private void StartRefreshUpdates()
    {
        if (_refreshTimer != null)
        {
            return;
        }

        _refreshTimer = new DispatcherTimer
        {
            Interval = GetIntervalToNextSecond()
        };
        _refreshTimer.Tick += RefreshTimer_Tick;
        _refreshTimer.Start();

        UpdateAllCodes();
    }

    private void StopRefreshUpdates()
    {
        if (_refreshTimer == null)
        {
            return;
        }

        _refreshTimer.Tick -= RefreshTimer_Tick;
        _refreshTimer.Stop();
        _refreshTimer = null;

        StopActiveStoryboards();
    }

    private void StopActiveStoryboards()
    {
        foreach (var cache in _elementCache.Values)
        {
            cache.StopAnimations();
        }
    }

    private void UpdateAllCodes()
    {
        var showNextCodeHint = _appSettings.ShowNextCodeWhenFiveSecondsRemain;

        foreach (var (accountId, cache) in _elementCache)
        {
            if (!_accountLookup.TryGetValue(accountId, out var account))
            {
                continue;
            }

            UpdateCardValues(account, cache, showNextCodeHint);
        }
    }

    private void UpdateCardValues(OtpAccount account, CardElementCache cache, bool showNextCodeHint)
    {
        var newCode = _totpGenerator.GenerateCode(account);
        SetTextIfChanged(cache.CodeTextBlock, newCode);

        var remainingSeconds = _totpGenerator.GetRemainingSeconds(account);
        SetTextIfChanged(cache.RemainingTextBlock, $"{remainingSeconds}s");

        var shouldShowNextCode = showNextCodeHint &&
            remainingSeconds > 0 &&
            remainingSeconds <= NextCodePreviewThresholdSeconds;

        if (shouldShowNextCode)
        {
            var nextCode = _totpGenerator.GenerateCodeAt(account, DateTime.UtcNow.AddSeconds(remainingSeconds));
            SetTextIfChanged(cache.NextCodeTextBlock, nextCode);

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

        var parentGrid = cache.ProgressBarFill.Parent as FrameworkElement;
        if (parentGrid != null && account.Period > 0)
        {
            var trackWidth = parentGrid.ActualWidth;
            if (trackWidth > 0)
            {
                var widthFrom = trackWidth * Math.Max(0, (double)remainingSeconds / account.Period);
                var widthTo = trackWidth * Math.Max(0, (double)(remainingSeconds - 1) / account.Period);

                cache.ActiveProgressStoryboard = PlayCachedAnimation(
                    cache.ActiveProgressStoryboard, cache.ProgressBarFill, "Width",
                    widthFrom, widthTo, TimeSpan.FromSeconds(1));
            }
        }
    }

    private static readonly QuadraticEase OpacityEase = new() { EasingMode = EasingMode.EaseOut };

    private void AnimateNextCodeOpacity(CardElementCache cache, double targetOpacity)
    {
        cache.ActiveOpacityStoryboard = PlayCachedAnimation(
            cache.ActiveOpacityStoryboard, cache.NextCodeTextBlock, "Opacity",
            cache.NextCodeTextBlock.Opacity, targetOpacity,
            TimeSpan.FromMilliseconds(200), OpacityEase);
    }

    private static void SetTextIfChanged(TextBlock block, string value)
    {
        if (block.Text != value)
        {
            block.Text = value;
        }
    }

    private static Storyboard PlayCachedAnimation(
        Storyboard? cached, DependencyObject target, string property,
        double from, double to, Duration duration,
        EasingFunctionBase? easing = null)
    {
        if (cached == null)
        {
            var animation = new DoubleAnimation { Duration = duration, EnableDependentAnimation = true };
            if (easing != null) animation.EasingFunction = easing;
            Storyboard.SetTarget(animation, target);
            Storyboard.SetTargetProperty(animation, property);
            var sb = new Storyboard();
            sb.Children.Add(animation);
            cached = sb;
        }

        var anim = (DoubleAnimation)cached.Children[0];
        if (anim.From == from && anim.To == to && cached.GetCurrentState() == ClockState.Active)
        {
            return cached;
        }

        cached.Stop();
        anim.From = from;
        anim.To = to;
        cached.Begin();
        return cached;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _isPageActive = true;

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
                    StartAutomaticBackup("account save");
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

        StartRefreshUpdates();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        _isPageActive = false;
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
        if (sender is not RadioMenuFlyoutItem menuItem ||
            menuItem.Tag is not string tag ||
            !TryGetSortOption(tag, out var sortOption))
        {
            return;
        }

        if (_currentSortOption == sortOption)
        {
            return;
        }

        _currentSortOption = sortOption;
        _appSettings.AccountSortOption = _currentSortOption;
        ApplySortSelectionToMenu();
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
        var sorted = _currentSortOption switch
        {
            SortOption.DateAddedDesc => filtered.OrderByDescending(a => a.CreatedAt),
            SortOption.DateAddedAsc => filtered.OrderBy(a => a.CreatedAt),
            SortOption.AlphabeticalAsc => filtered.OrderBy(a => a.DisplayLabel),
            SortOption.AlphabeticalDesc => filtered.OrderByDescending(a => a.DisplayLabel),
            _ => filtered.OrderByDescending(a => a.CreatedAt)
        };

        // Update the list and rebind ItemsSource for a single UI update
        _accounts = sorted.ToList();
        _accountLookup = _accounts.ToDictionary(a => a.Id);
        StopActiveStoryboards();
        _elementCache.Clear();
        OtpGridView.ItemsSource = _accounts;

        UpdateEmptyState();
    }

    private void ApplySortSelectionToMenu()
    {
        SortNewestFirst.IsChecked = _currentSortOption == SortOption.DateAddedDesc;
        SortOldestFirst.IsChecked = _currentSortOption == SortOption.DateAddedAsc;
        SortNameAsc.IsChecked = _currentSortOption == SortOption.AlphabeticalAsc;
        SortNameDesc.IsChecked = _currentSortOption == SortOption.AlphabeticalDesc;
    }

    private static bool TryGetSortOption(string tag, out SortOption sortOption)
    {
        return Enum.TryParse(tag, out sortOption);
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(AddAccountPage));
    }

    private bool TryGetAccountFromButton(object sender, out OtpAccount account)
    {
        account = null!;
        if (sender is not Button button || button.Tag is not string id)
        {
            return false;
        }

        return _accountLookup.TryGetValue(id, out account!);
    }

    private async void CopyButton_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetAccountFromButton(sender, out var account))
        {
            return;
        }

        try
        {
            var totpCode = _totpGenerator.GenerateCode(account);
            await ClipboardHelper.SetContentWithRetryAsync(totpCode);

            // Visual feedback: change button icon to checkmark
            var copyIcon = FindChild<FontIcon>((Button)sender, "CopyButtonIcon");
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

    private async void EditButton_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetAccountFromButton(sender, out var account))
        {
            return;
        }

        var issuerTextBox = new TextBox
        {
            Header = "Issuer",
            Text = account.Issuer,
            Margin = new Thickness(0, 0, 0, 16)
        };

        var accountNameTextBox = new TextBox
        {
            Header = "Account Name",
            Text = account.AccountName
        };

        var contentPanel = new StackPanel();
        contentPanel.Children.Add(issuerTextBox);
        contentPanel.Children.Add(accountNameTextBox);

        var dialog = new ContentDialog
        {
            Title = "Edit Account",
            Content = contentPanel,
            PrimaryButtonText = "Save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return;
        }

        var newIssuer = issuerTextBox.Text.Trim();
        var newAccountName = accountNameTextBox.Text.Trim();

        if (account.Issuer == newIssuer && account.AccountName == newAccountName)
        {
            return; // No changes
        }

        account.Issuer = newIssuer;
        account.AccountName = newAccountName;

        var saveResult = await _credentialManager.SaveAccountAsync(account);
        if (!saveResult.Success)
        {
            ShowOperationError(saveResult.Message);
            _logger.Warn($"Edit account failed: {saveResult.ErrorCode} - {saveResult.Message}");
            return;
        }

        ApplyFilterAndSort();
        StartAutomaticBackup("account edit");
    }

    private async void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
        if (!TryGetAccountFromButton(sender, out var account))
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

        var deleteResult = await _credentialManager.DeleteAccountAsync(account.Id);
        if (!deleteResult.Success)
        {
            ShowOperationError(deleteResult.Message);
            _logger.Warn($"Delete account failed: {deleteResult.ErrorCode} - {deleteResult.Message}");
            return;
        }

        _allAccounts.Remove(account);
        ApplyFilterAndSort();
        StartAutomaticBackup("account deletion");
    }

    private void StartAutomaticBackup(string reason)
    {
        if (!_appSettings.IsAutomaticBackupEnabled)
        {
            return;
        }

        _ = TryCreateAutomaticBackupAsync(reason);
    }

    private async Task TryCreateAutomaticBackupAsync(string reason)
    {
        try
        {
            var backupResult = await _backupService.CreateAutomaticBackupAsync();
            if (backupResult.Success)
            {
                return;
            }

            _logger.Warn($"Automatic backup failed after {reason}: {backupResult.ErrorCode} - {backupResult.Message}");
            DispatcherQueue?.TryEnqueue(() =>
            {
                if (!_isPageActive || XamlRoot == null)
                {
                    return;
                }

                ShowOperationError($"Automatic backup failed: {backupResult.Message}");
            });
        }
        catch (Exception ex)
        {
            _logger.Error($"Unhandled exception while creating automatic backup after {reason}.", ex);
        }
    }
}
