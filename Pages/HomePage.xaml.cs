using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.UI.Xaml.Shapes;
using Windows.ApplicationModel.DataTransfer;
using Windows.Foundation;
using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class HomePage : Page
{
    private const double CardWidth = 368; // 360 + 8 for margins
    private static readonly Thickness NormalOtpGridViewPadding = new(4, 0, 4, 0);
    private static readonly Thickness ReorderOtpGridViewPadding = new(4, 0, 4, 120);
    private const int NextCodePreviewThresholdSeconds = 5;
    private const string VaultLoadFailureMessage = "Unable to access Windows Credential Manager. Saved accounts could not be loaded.";
    private static readonly Duration ReorderPreviewAnimationDuration = TimeSpan.FromMilliseconds(180);
    private static readonly SolidColorBrush TransparentBrush = new(Microsoft.UI.Colors.Transparent);
    private const int MaxReorderScrollRestorePasses = 8;
    private const int RequiredStableScrollPasses = 2;
    private const double ReorderAutoScrollEdgeZone = 60.0;
    private const double ReorderAutoScrollMaxVelocity = 18.0;
    private const int ReorderAutoScrollTickMs = 16;
    private const double ReorderAutoScrollDeadZone = 0.1;
    private const int ReorderPreviewDebounceMs = 300;

    private readonly ICredentialManagerService _credentialManager;
    private readonly IAppSettingsService _appSettings;
    private readonly ITotpCodeGenerator _totpGenerator;
    private readonly IAppLogger _logger;
    private readonly IBackupService _backupService;

    private readonly List<OtpAccount> _allAccounts = new();
    private readonly ObservableCollection<OtpAccount> _accounts = new();
    private readonly Dictionary<string, CardElementCache> _elementCache = new();
    private readonly List<Storyboard> _activeReorderPreviewStoryboards = new();
    private ItemsWrapGrid? _itemsPanel;
    private ScrollViewer? _otpGridScrollViewer;
    private SortOption _currentSortOption = SortOption.DateAddedDesc;
    private string _searchText = string.Empty;
    private DispatcherTimer? _refreshTimer;
    private Dictionary<string, OtpAccount> _accountLookup = new();
    private bool _isShowingVaultLoadError;
    private bool _isPageActive;
    private bool _isWindowActive = true;
    private string? _reorderDragHandleAccountId;
    private string? _draggedReorderAccountId;
    private GridViewItem? _hiddenReorderSourceContainer;
    private int? _pendingReorderDropIndex;
    private ScrollViewerState? _reorderDragStartScrollState;
    private ScrollViewerState? _lastReorderScrollRestoreState;
    private bool _isReorderDragInProgress;
    private bool _isRestoringReorderScroll;
    private int _consecutiveStableScrollPasses;
    private long _reorderScrollLockEpoch;
    private DispatcherTimer? _reorderAutoScrollTimer;
    private DispatcherTimer? _reorderPreviewDebounceTimer;
    private int? _pendingReorderDropIndexCandidate;
    private Point? _lastDragOverPointInGridView;
    private Point? _lastDragOverPointInScrollViewer;

    private bool IsReorderScrollLockActive =>
        _isReorderDragInProgress || _lastReorderScrollRestoreState != null;

    private record CardElementCache(
        TextBlock CodeTextBlock,
        Rectangle ProgressBarFill,
        TextBlock RemainingTextBlock,
        TextBlock NextCodeTextBlock,
        StackPanel ReorderControlsPanel,
        Border ReorderHandle)
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
        OtpGridView.DragItemsStarting += OtpGridView_DragItemsStarting;
        OtpGridView.DragItemsCompleted += OtpGridView_DragItemsCompleted;
        OtpGridView.DragOver += OtpGridView_DragOver;
        OtpGridView.DragLeave += OtpGridView_DragLeave;
        OtpGridView.Drop += OtpGridView_Drop;
        OtpGridView.BringIntoViewRequested += OtpGridView_BringIntoViewRequested;
    }

    private void OtpGridView_ContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.Item is not OtpAccount account)
        {
            return;
        }

        if (args.InRecycleQueue)
        {
            if (args.ItemContainer is GridViewItem recycledContainer)
            {
                ResetReorderContainerVisualState(recycledContainer);
                if (ReferenceEquals(_hiddenReorderSourceContainer, recycledContainer))
                {
                    _hiddenReorderSourceContainer = null;
                }
            }

            if (_elementCache.TryGetValue(account.Id, out var recycled))
            {
                recycled.StopAnimations();
            }
            _elementCache.Remove(account.Id);
            return;
        }

        if (args.ItemContainer is GridViewItem container)
        {
            ApplyReorderContainerVisualState(container);
            if (TryCacheCardElements(account, container.ContentTemplateRoot))
            {
                args.RegisterUpdateCallback(UpdateProgressBarAfterLayout);
            }
        }
    }

    private readonly record struct ScrollViewerState(
        double HorizontalOffset,
        double VerticalOffset);

    private void UpdateProgressBarAfterLayout(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.Item is OtpAccount account &&
            _elementCache.TryGetValue(account.Id, out var cache))
        {
            UpdateCardValues(account, cache, _appSettings.ShowNextCodeWhenFiveSecondsRemain);
            UpdateCardReorderState(cache);
        }
    }

    private void OtpGridView_Loaded(object? sender, RoutedEventArgs e)
    {
        _itemsPanel = FindChild<ItemsWrapGrid>(OtpGridView, "OtpItemsWrapGrid");
        SetOtpGridScrollViewer(FindFirstChild<ScrollViewer>(OtpGridView));
        UpdateGridColumns();
    }

    private bool TryCacheCardElements(OtpAccount account, object? templateRoot)
    {
        if (!OtpCardTemplateRootPolicy.TryGetSearchRoot(templateRoot, out var searchRoot))
        {
            return false;
        }

        var codeBlock = FindChild<TextBlock>(searchRoot, "CodeTextBlock");
        var progressBarFill = FindChild<Rectangle>(searchRoot, "ProgressBarFill");
        var remainingBlock = FindChild<TextBlock>(searchRoot, "RemainingTextBlock");
        var nextCodeBlock = FindChild<TextBlock>(searchRoot, "NextCodeTextBlock");
        var reorderControlsPanel = FindChild<StackPanel>(searchRoot, "ReorderControlsPanel");
        var reorderHandle = FindChild<Border>(searchRoot, "ReorderHandle");

        if (codeBlock == null ||
            progressBarFill == null ||
            remainingBlock == null ||
            nextCodeBlock == null ||
            reorderControlsPanel == null ||
            reorderHandle == null)
        {
            return false;
        }

        var cache = new CardElementCache(
            codeBlock,
            progressBarFill,
            remainingBlock,
            nextCodeBlock,
            reorderControlsPanel,
            reorderHandle);

        _elementCache[account.Id] = cache;
        UpdateCardValues(account, cache, _appSettings.ShowNextCodeWhenFiveSecondsRemain);
        UpdateCardReorderState(cache);
        return true;
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

    private static T? FindFirstChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T t)
            {
                return t;
            }

            var result = FindFirstChild<T>(child);
            if (result != null)
            {
                return result;
            }
        }

        return null;
    }

    private ScrollViewerState? CaptureOtpGridScrollState()
    {
        if (_otpGridScrollViewer == null)
        {
            SetOtpGridScrollViewer(FindFirstChild<ScrollViewer>(OtpGridView));
        }

        if (_otpGridScrollViewer == null)
        {
            return null;
        }

        return new ScrollViewerState(
            _otpGridScrollViewer.HorizontalOffset,
            _otpGridScrollViewer.VerticalOffset);
    }

    private void SetOtpGridScrollViewer(ScrollViewer? scrollViewer)
    {
        if (ReferenceEquals(_otpGridScrollViewer, scrollViewer))
        {
            return;
        }

        if (_otpGridScrollViewer != null)
        {
            _otpGridScrollViewer.ViewChanged -= OtpGridScrollViewer_ViewChanged;
        }

        _otpGridScrollViewer = scrollViewer;

        if (_otpGridScrollViewer != null)
        {
            _otpGridScrollViewer.ViewChanged += OtpGridScrollViewer_ViewChanged;
        }
        else
        {
            StopReorderAutoScroll();
            StopReorderPreviewDebounce();
        }
    }

    private ScrollViewerState? GetActiveReorderScrollState() =>
        _reorderDragStartScrollState ?? _lastReorderScrollRestoreState;

    private void OtpGridScrollViewer_ViewChanged(object? sender, ScrollViewerViewChangedEventArgs e)
    {
        if (!IsReorderScrollLockActive || _isRestoringReorderScroll)
        {
            return;
        }

        if (_isReorderDragInProgress)
        {
            if (_otpGridScrollViewer != null)
            {
                _reorderDragStartScrollState = new ScrollViewerState(
                    _otpGridScrollViewer.HorizontalOffset,
                    _otpGridScrollViewer.VerticalOffset);
            }
            return;
        }

        var state = GetActiveReorderScrollState();
        if (state == null || IsOtpGridScrollStateCurrent(state.Value))
        {
            return;
        }

        RestoreOtpGridScrollState(state);
    }

    private void OtpGridView_BringIntoViewRequested(UIElement sender, BringIntoViewRequestedEventArgs args)
    {
        if (IsReorderScrollLockActive)
        {
            args.Handled = true;
        }
    }

    private void RestoreOtpGridScrollState(ScrollViewerState? state)
    {
        if (state == null)
        {
            return;
        }

        if (_otpGridScrollViewer == null)
        {
            SetOtpGridScrollViewer(FindFirstChild<ScrollViewer>(OtpGridView));
        }

        if (_otpGridScrollViewer == null || IsOtpGridScrollStateCurrent(state.Value))
        {
            return;
        }

        _isRestoringReorderScroll = true;
        try
        {
            _otpGridScrollViewer.ChangeView(
                state.Value.HorizontalOffset,
                state.Value.VerticalOffset,
                zoomFactor: null,
                disableAnimation: true);
        }
        finally
        {
            _isRestoringReorderScroll = false;
        }
    }

    private bool IsOtpGridScrollStateCurrent(ScrollViewerState state)
    {
        return _otpGridScrollViewer != null &&
            Math.Abs(_otpGridScrollViewer.HorizontalOffset - state.HorizontalOffset) < 0.5 &&
            Math.Abs(_otpGridScrollViewer.VerticalOffset - state.VerticalOffset) < 0.5;
    }

    private void UpdateReorderAutoScroll()
    {
        if (TryComputeAutoScrollVelocity(out _))
        {
            StartReorderAutoScroll();
        }
        else
        {
            StopReorderAutoScroll();
        }
    }

    private bool TryComputeAutoScrollVelocity(out double velocity)
    {
        velocity = 0.0;
        if (_otpGridScrollViewer == null ||
            _lastDragOverPointInScrollViewer is not Point pointer ||
            _otpGridScrollViewer.ScrollableHeight <= 0.5)
        {
            return false;
        }

        var topDistance = pointer.Y;
        var bottomDistance = _otpGridScrollViewer.ViewportHeight - pointer.Y;

        if (topDistance > ReorderAutoScrollEdgeZone &&
            bottomDistance > ReorderAutoScrollEdgeZone)
        {
            return false;
        }

        var sign = topDistance < bottomDistance ? -1.0 : 1.0;
        var nearestDistance = Math.Min(topDistance, bottomDistance);
        var t = Math.Clamp(
            (ReorderAutoScrollEdgeZone - nearestDistance) / ReorderAutoScrollEdgeZone,
            0.0,
            1.0);

        if (t < ReorderAutoScrollDeadZone)
        {
            return false;
        }

        velocity = sign * t * ReorderAutoScrollMaxVelocity;
        return true;
    }

    private void ReorderAutoScrollTimer_Tick(object? sender, object e)
    {
        if (!_isReorderDragInProgress ||
            _otpGridScrollViewer == null ||
            !TryComputeAutoScrollVelocity(out var velocity))
        {
            StopReorderAutoScroll();
            return;
        }

        var current = _otpGridScrollViewer.VerticalOffset;
        var target = Math.Clamp(
            current + velocity,
            0.0,
            _otpGridScrollViewer.ScrollableHeight);

        if (Math.Abs(target - current) < 0.5)
        {
            StopReorderAutoScroll();
            return;
        }

        _isRestoringReorderScroll = true;
        bool applied;
        try
        {
            applied = _otpGridScrollViewer.ChangeView(
                horizontalOffset: null,
                verticalOffset: target,
                zoomFactor: null,
                disableAnimation: true);
        }
        finally
        {
            _isRestoringReorderScroll = false;
        }

        if (!applied)
        {
            StopReorderAutoScroll();
            return;
        }

        var actualVerticalOffset = _otpGridScrollViewer.VerticalOffset;
        var verticalDelta = actualVerticalOffset - current;

        _reorderDragStartScrollState = new ScrollViewerState(
            _otpGridScrollViewer.HorizontalOffset,
            actualVerticalOffset);

        if (_lastDragOverPointInGridView is Point gridPoint)
        {
            _lastDragOverPointInGridView = new Point(gridPoint.X, gridPoint.Y + verticalDelta);
        }
    }

    private void StartReorderAutoScroll()
    {
        if (_reorderAutoScrollTimer != null)
        {
            return;
        }

        _reorderAutoScrollTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(ReorderAutoScrollTickMs)
        };
        _reorderAutoScrollTimer.Tick += ReorderAutoScrollTimer_Tick;
        _reorderAutoScrollTimer.Start();
    }

    private void StopReorderAutoScroll()
    {
        if (_reorderAutoScrollTimer == null)
        {
            return;
        }

        _reorderAutoScrollTimer.Tick -= ReorderAutoScrollTimer_Tick;
        _reorderAutoScrollTimer.Stop();
        _reorderAutoScrollTimer = null;
    }

    private void UpdateReorderDropPreviewFor(Point pointerInGridView)
    {
        var insertionIndex = GetDropInsertionIndex(
            CaptureVisibleReorderItemBounds(),
            pointerInGridView);

        if (_pendingReorderDropIndex == insertionIndex)
        {
            StopReorderPreviewDebounce();
            _pendingReorderDropIndexCandidate = null;
            return;
        }

        if (_pendingReorderDropIndexCandidate == insertionIndex)
        {
            return;
        }

        _pendingReorderDropIndexCandidate = insertionIndex;
        StartReorderPreviewDebounce();
    }

    private void StartReorderPreviewDebounce()
    {
        StopReorderPreviewDebounce();
        _reorderPreviewDebounceTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(ReorderPreviewDebounceMs)
        };
        _reorderPreviewDebounceTimer.Tick += ReorderPreviewDebounceTimer_Tick;
        _reorderPreviewDebounceTimer.Start();
    }

    private void StopReorderPreviewDebounce()
    {
        if (_reorderPreviewDebounceTimer == null)
        {
            return;
        }

        _reorderPreviewDebounceTimer.Tick -= ReorderPreviewDebounceTimer_Tick;
        _reorderPreviewDebounceTimer.Stop();
        _reorderPreviewDebounceTimer = null;
    }

    private void ReorderPreviewDebounceTimer_Tick(object? sender, object e)
    {
        StopReorderPreviewDebounce();

        if (!_isReorderDragInProgress ||
            _pendingReorderDropIndexCandidate is not int candidate)
        {
            _pendingReorderDropIndexCandidate = null;
            return;
        }

        CommitReorderPreviewImmediate(candidate, CaptureVisibleReorderItemBounds());
    }

    private void CommitReorderPreviewImmediate(
        int insertionIndex,
        IReadOnlyList<OtpAccountReorderLayoutPolicy.ItemBounds> itemBounds)
    {
        StopReorderPreviewDebounce();
        _pendingReorderDropIndexCandidate = null;

        if (_pendingReorderDropIndex == insertionIndex)
        {
            return;
        }

        _pendingReorderDropIndex = insertionIndex;
        ApplyReorderPreview(insertionIndex, itemBounds);
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
        StopReorderAutoScroll();
        StopReorderPreviewDebounce();
        SetOtpGridScrollViewer(null);
        UnsubscribeWindowActivation();
        StopRefreshUpdates();
        OtpGridView.BringIntoViewRequested -= OtpGridView_BringIntoViewRequested;
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

    private void OnWindowActivationChanged(object? sender, bool isActive)
    {
        _isWindowActive = isActive;
        if (isActive) StartRefreshUpdates();
        else StopRefreshUpdates();
    }

    private void SubscribeWindowActivation()
    {
        UnsubscribeWindowActivation();
        if (App.Current.MainWindow is { } mw)
        {
            mw.WindowActivationChanged += OnWindowActivationChanged;
        }
    }

    private void UnsubscribeWindowActivation()
    {
        if (App.Current.MainWindow is { } mw)
        {
            mw.WindowActivationChanged -= OnWindowActivationChanged;
        }
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

    private bool IsCustomOrderReorderEnabled =>
        _currentSortOption == SortOption.CustomOrder && string.IsNullOrWhiteSpace(_searchText);

    private void UpdateReorderState()
    {
        var enabled = IsCustomOrderReorderEnabled;
        OtpGridView.AllowDrop = enabled;
        OtpGridView.CanDragItems = enabled;
        OtpGridView.CanReorderItems = false;
        OtpGridView.ReorderMode = ListViewReorderMode.Disabled;
        OtpGridView.Padding = enabled
            ? ReorderOtpGridViewPadding
            : NormalOtpGridViewPadding;

        foreach (var cache in _elementCache.Values)
        {
            UpdateCardReorderState(cache);
        }
    }

    private void UpdateCardReorderState(CardElementCache cache)
    {
        var enabled = IsCustomOrderReorderEnabled;
        cache.ReorderControlsPanel.Visibility = enabled
            ? Visibility.Visible
            : Visibility.Collapsed;

        if (!enabled)
        {
            cache.ReorderHandle.IsHitTestVisible = false;
            cache.ReorderHandle.Opacity = 0.5;
            return;
        }

        cache.ReorderHandle.IsHitTestVisible = !_isReorderDragInProgress;
        cache.ReorderHandle.Opacity = _isReorderDragInProgress ? 0.5 : 1;
    }

    private void ReorderHandle_PointerEntered(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (sender is not Border handle || !IsCustomOrderReorderEnabled)
        {
            return;
        }

        handle.Background = GetThemeBrush("SubtleFillColorSecondaryBrush");
    }

    private void ReorderHandle_PointerExited(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (sender is not Border handle || _isReorderDragInProgress)
        {
            return;
        }

        handle.Background = TransparentBrush;
    }

    private void ReorderHandle_PointerPressed(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (!IsCustomOrderReorderEnabled ||
            sender is not Border handle ||
            handle.Tag is not string accountId)
        {
            return;
        }

        _reorderDragHandleAccountId = accountId;
        handle.Background = GetThemeBrush("SubtleFillColorTertiaryBrush");
    }

    private void ReorderHandle_PointerReleased(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (!_isReorderDragInProgress && sender is Border handle)
        {
            ResetReorderHandlePress(handle);
        }
    }

    private void ResetReorderHandlePress(Border handle)
    {
        _reorderDragHandleAccountId = null;
        handle.Background = TransparentBrush;
    }

    private void OtpGridView_DragItemsStarting(object sender, DragItemsStartingEventArgs e)
    {
        if (!IsCustomOrderReorderEnabled ||
            _reorderDragHandleAccountId == null ||
            e.Items.FirstOrDefault() is not OtpAccount account ||
            !string.Equals(account.Id, _reorderDragHandleAccountId, StringComparison.Ordinal))
        {
            e.Cancel = true;
            ResetReorderDragState();
            return;
        }

        _reorderDragStartScrollState = CaptureOtpGridScrollState();
        _draggedReorderAccountId = account.Id;
        _pendingReorderDropIndex = null;
        _isReorderDragInProgress = true;
        _lastReorderScrollRestoreState = null;
        _consecutiveStableScrollPasses = 0;
        _reorderScrollLockEpoch++;
        e.Data.RequestedOperation = DataPackageOperation.Move;
        UpdateReorderState();
        DispatcherQueue.TryEnqueue(() => HideReorderSourceContainer(account.Id));
    }

    private void OtpGridView_DragItemsCompleted(ListViewBase sender, DragItemsCompletedEventArgs args)
    {
        ResetReorderDragState();
    }

    private void OtpGridView_DragOver(object sender, DragEventArgs e)
    {
        if (!IsCustomOrderReorderEnabled || _draggedReorderAccountId == null)
        {
            e.AcceptedOperation = DataPackageOperation.None;
            return;
        }

        e.AcceptedOperation = DataPackageOperation.Move;
        var pointerInGridView = e.GetPosition(OtpGridView);
        UpdateReorderDropPreviewFor(pointerInGridView);

        _lastDragOverPointInGridView = pointerInGridView;
        _lastDragOverPointInScrollViewer = _otpGridScrollViewer is null
            ? null
            : e.GetPosition(_otpGridScrollViewer);
        UpdateReorderAutoScroll();

        e.Handled = true;
    }

    private void OtpGridView_DragLeave(object sender, DragEventArgs e)
    {
        _pendingReorderDropIndex = null;
        _pendingReorderDropIndexCandidate = null;
        StopReorderPreviewDebounce();
        StopReorderPreviewAnimations();
        StopReorderAutoScroll();
    }

    private void OtpGridView_Drop(object sender, DragEventArgs e)
    {
        StopReorderAutoScroll();
        StopReorderPreviewDebounce();

        if (!IsCustomOrderReorderEnabled || _draggedReorderAccountId == null)
        {
            ResetReorderDragState();
            return;
        }

        var currentIndex = FindAccountIndexById(_draggedReorderAccountId);

        if (currentIndex < 0)
        {
            ResetReorderDragState();
            return;
        }

        var insertionIndex = GetDropInsertionIndex(
            CaptureVisibleReorderItemBounds(),
            e.GetPosition(OtpGridView));
        RestoreHiddenReorderSourceContainer();
        StopReorderPreviewAnimations();
        MoveDraggedAccountToInsertionIndex(insertionIndex);

        _appSettings.AccountCustomOrderIds = _accounts.Select(a => a.Id).ToList();
        ResetReorderDragState();
        e.Handled = true;
    }

    private int GetDropInsertionIndex(IReadOnlyList<OtpAccountReorderLayoutPolicy.ItemBounds> itemBounds, Point point)
    {
        if (itemBounds.Count == 0)
        {
            return _accounts.Count;
        }

        return OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(
            itemBounds,
            point.X,
            point.Y);
    }

    private IReadOnlyList<OtpAccountReorderLayoutPolicy.ItemBounds> CaptureVisibleReorderItemBounds()
    {
        var bounds = new List<OtpAccountReorderLayoutPolicy.ItemBounds>();
        for (var index = 0; index < _accounts.Count; index++)
        {
            var account = _accounts[index];
            if (OtpGridView.ContainerFromItem(account) is not GridViewItem container ||
                !TryGetUntranslatedTopLeft(container, out var topLeft))
            {
                continue;
            }

            bounds.Add(new OtpAccountReorderLayoutPolicy.ItemBounds(
                account.Id,
                topLeft.X,
                topLeft.Y,
                container.ActualWidth,
                container.ActualHeight,
                index));
        }

        return bounds;
    }

    private bool TryGetUntranslatedTopLeft(GridViewItem container, out Point topLeft)
    {
        try
        {
            topLeft = container.TransformToVisual(OtpGridView).TransformPoint(new Point());
            if (container.RenderTransform is TranslateTransform transform)
            {
                topLeft.X -= transform.X;
                topLeft.Y -= transform.Y;
            }
            return true;
        }
        catch (ArgumentException)
        {
            topLeft = default;
            return false;
        }
    }

    private void MoveDraggedAccountToInsertionIndex(int insertionIndex)
    {
        if (_draggedReorderAccountId == null)
        {
            return;
        }

        var currentIndex = FindAccountIndexById(_draggedReorderAccountId);
        if (currentIndex < 0)
        {
            return;
        }

        var targetIndex = OtpAccountReorderLayoutPolicy.GetTargetIndex(currentIndex, insertionIndex, _accounts.Count);
        if (targetIndex < 0)
        {
            return;
        }

        _accounts.Move(currentIndex, targetIndex);
        _accountLookup = _accounts.ToDictionary(a => a.Id);
    }

    private void ApplyReorderPreview(int insertionIndex, IReadOnlyList<OtpAccountReorderLayoutPolicy.ItemBounds> itemBounds)
    {
        if (_draggedReorderAccountId == null)
        {
            return;
        }

        var currentIds = _accounts.Select(account => account.Id).ToList();
        var projectedIds = OtpAccountReorderLayoutPolicy.ProjectOrder(
            currentIds,
            _draggedReorderAccountId,
            insertionIndex);
        AnimateVisibleReorderPreview(currentIds, projectedIds, itemBounds);
    }

    private void AnimateVisibleReorderPreview(
        IReadOnlyList<string> currentIds,
        IReadOnlyList<string> projectedIds,
        IReadOnlyList<OtpAccountReorderLayoutPolicy.ItemBounds> itemBounds)
    {
        if (_draggedReorderAccountId == null)
        {
            return;
        }

        var layoutPositions = new Dictionary<string, Point>(itemBounds.Count, StringComparer.Ordinal);
        foreach (var bounds in itemBounds)
        {
            layoutPositions[bounds.Id] = new Point(bounds.Left, bounds.Top);
        }

        var projectedIndexById = projectedIds
            .Select((id, index) => (id, index))
            .ToDictionary(item => item.id, item => item.index, StringComparer.Ordinal);

        StopActiveReorderPreviewStoryboards();

        foreach (var account in _accounts)
        {
            if (string.Equals(account.Id, _draggedReorderAccountId, StringComparison.Ordinal) ||
                !projectedIndexById.TryGetValue(account.Id, out var projectedIndex) ||
                projectedIndex < 0 ||
                projectedIndex >= currentIds.Count ||
                !layoutPositions.TryGetValue(account.Id, out var currentPosition) ||
                !layoutPositions.TryGetValue(currentIds[projectedIndex], out var targetPosition) ||
                OtpGridView.ContainerFromItem(account) is not GridViewItem container)
            {
                continue;
            }

            if (container.RenderTransform is not TranslateTransform transform)
            {
                transform = new TranslateTransform();
                container.RenderTransform = transform;
            }

            var targetX = targetPosition.X - currentPosition.X;
            var targetY = targetPosition.Y - currentPosition.Y;
            if (Math.Abs(transform.X - targetX) < 0.5 && Math.Abs(transform.Y - targetY) < 0.5)
            {
                transform.X = targetX;
                transform.Y = targetY;
                continue;
            }

            var storyboard = new Storyboard();
            storyboard.Children.Add(CreateReorderPreviewAnimation(transform, "X", transform.X, targetX));
            storyboard.Children.Add(CreateReorderPreviewAnimation(transform, "Y", transform.Y, targetY));
            storyboard.Completed += (_, _) =>
            {
                storyboard.Stop();
                transform.X = targetX;
                transform.Y = targetY;
                _activeReorderPreviewStoryboards.Remove(storyboard);
            };

            _activeReorderPreviewStoryboards.Add(storyboard);
            storyboard.Begin();
        }
    }

    private static DoubleAnimation CreateReorderPreviewAnimation(
        DependencyObject target,
        string property,
        double from,
        double to)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = ReorderPreviewAnimationDuration,
            EnableDependentAnimation = true,
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
        };

        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, property);
        return animation;
    }

    private void StopReorderPreviewAnimations()
    {
        StopActiveReorderPreviewStoryboards();

        foreach (var account in _accounts)
        {
            if (OtpGridView.ContainerFromItem(account) is GridViewItem container)
            {
                ResetReorderContainerTransform(container);
            }
        }
    }

    private void StopActiveReorderPreviewStoryboards()
    {
        foreach (var storyboard in _activeReorderPreviewStoryboards)
        {
            storyboard.Stop();
        }

        _activeReorderPreviewStoryboards.Clear();
    }

    private void HideReorderSourceContainer(string accountId)
    {
        if (!_isReorderDragInProgress ||
            !string.Equals(_draggedReorderAccountId, accountId, StringComparison.Ordinal) ||
            OtpGridView.ContainerFromItem(_accountLookup.GetValueOrDefault(accountId)) is not GridViewItem container)
        {
            return;
        }

        RestoreHiddenReorderSourceContainer();
        container.Opacity = 0;
        _hiddenReorderSourceContainer = container;
    }

    private void RestoreHiddenReorderSourceContainer()
    {
        if (_hiddenReorderSourceContainer != null)
        {
            _hiddenReorderSourceContainer.Opacity = 1;
            _hiddenReorderSourceContainer = null;
        }
    }

    private void ApplyReorderContainerVisualState(GridViewItem container)
    {
        if (_isReorderDragInProgress && ReferenceEquals(container, _hiddenReorderSourceContainer))
        {
            container.Opacity = 0;
            ResetReorderContainerTransform(container);
            return;
        }

        ResetReorderContainerVisualState(container);
    }

    private static void ResetReorderContainerVisualState(GridViewItem container)
    {
        container.Opacity = 1;
        ResetReorderContainerTransform(container);
    }

    private static void ResetReorderContainerTransform(GridViewItem container)
    {
        if (container.RenderTransform is TranslateTransform transform)
        {
            transform.X = 0;
            transform.Y = 0;
        }
    }

    private int FindAccountIndexById(string accountId)
    {
        for (var index = 0; index < _accounts.Count; index++)
        {
            if (string.Equals(_accounts[index].Id, accountId, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }

    private void ResetReorderDragState()
    {
        StopReorderAutoScroll();
        StopReorderPreviewDebounce();
        var wasReorderDragInProgress = _isReorderDragInProgress;
        var scrollState = GetActiveReorderScrollState();
        _lastReorderScrollRestoreState = scrollState;

        RestoreHiddenReorderSourceContainer();
        StopReorderPreviewAnimations();
        _reorderDragHandleAccountId = null;
        _draggedReorderAccountId = null;
        _pendingReorderDropIndex = null;
        _pendingReorderDropIndexCandidate = null;
        _reorderDragStartScrollState = null;
        _lastDragOverPointInGridView = null;
        _lastDragOverPointInScrollViewer = null;
        _isReorderDragInProgress = false;
        if (wasReorderDragInProgress)
        {
            ResetReorderHandleBackgrounds();
        }
        UpdateReorderState();
        if (wasReorderDragInProgress)
        {
            ScheduleReorderScrollRestores(scrollState);
        }
    }

    private void ScheduleReorderScrollRestores(ScrollViewerState? state)
    {
        if (state == null)
        {
            ReleaseReorderScrollLock(_reorderScrollLockEpoch);
            return;
        }

        var epoch = _reorderScrollLockEpoch;
        _consecutiveStableScrollPasses = 0;
        EnqueueReorderScrollRestore(state.Value, MaxReorderScrollRestorePasses, epoch);
    }

    private void EnqueueReorderScrollRestore(ScrollViewerState state, int remainingPasses, long epoch)
    {
        if (epoch != _reorderScrollLockEpoch)
        {
            return;
        }

        var wasStable = IsOtpGridScrollStateCurrent(state);
        RestoreOtpGridScrollState(state);

        if (wasStable)
        {
            _consecutiveStableScrollPasses++;
        }
        else
        {
            _consecutiveStableScrollPasses = 0;
        }

        if (_consecutiveStableScrollPasses >= RequiredStableScrollPasses || remainingPasses <= 1)
        {
            ReleaseReorderScrollLock(epoch);
            return;
        }

        DispatcherQueue.TryEnqueue(() => EnqueueReorderScrollRestore(state, remainingPasses - 1, epoch));
    }

    private void ReleaseReorderScrollLock(long epoch)
    {
        if (epoch != _reorderScrollLockEpoch)
        {
            return;
        }

        _lastReorderScrollRestoreState = null;
        _consecutiveStableScrollPasses = 0;
    }

    private Brush GetThemeBrush(string resourceKey)
    {
        if (Resources.TryGetValue(resourceKey, out var pageBrush) && pageBrush is Brush localBrush)
        {
            return localBrush;
        }

        if (Application.Current.Resources.TryGetValue(resourceKey, out var appBrush) && appBrush is Brush themeBrush)
        {
            return themeBrush;
        }

        return TransparentBrush;
    }

    private void ResetReorderHandleBackgrounds()
    {
        foreach (var cache in _elementCache.Values)
        {
            cache.ReorderHandle.Background = TransparentBrush;
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

        if (account.Period > 0)
        {
            var parentGrid = cache.ProgressBarFill.Parent as FrameworkElement;
            if (parentGrid != null)
            {
                var trackWidth = parentGrid.ActualWidth;
                if (trackWidth > 0)
                {
                    var widthFrom = trackWidth * Math.Max(0, (double)remainingSeconds / account.Period);
                    var widthTo = trackWidth * Math.Max(0, (double)(remainingSeconds - 1) / account.Period);

                    cache.ActiveProgressStoryboard = PlayCachedAnimation(
                        cache.ActiveProgressStoryboard, cache.ProgressBarFill, "Width",
                        widthFrom, widthTo, TimeSpan.FromMilliseconds(300),
                        new QuadraticEase { EasingMode = EasingMode.EaseOut });
                }
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

        SubscribeWindowActivation();

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

        if (_isWindowActive)
            StartRefreshUpdates();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        _isPageActive = false;
        SetOtpGridScrollViewer(null);
        UnsubscribeWindowActivation();
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
        IEnumerable<OtpAccount> sorted = _currentSortOption switch
        {
            SortOption.DateAddedDesc => filtered.OrderByDescending(a => a.CreatedAt),
            SortOption.DateAddedAsc => filtered.OrderBy(a => a.CreatedAt),
            SortOption.AlphabeticalAsc => filtered.OrderBy(a => a.DisplayLabel),
            SortOption.AlphabeticalDesc => filtered.OrderByDescending(a => a.DisplayLabel),
            SortOption.CustomOrder => OtpAccountCustomOrderPolicy.Apply(filtered, _appSettings.AccountCustomOrderIds),
            _ => filtered.OrderByDescending(a => a.CreatedAt)
        };

        _accounts.Clear();
        foreach (var account in sorted)
        {
            _accounts.Add(account);
        }

        _accountLookup = _accounts.ToDictionary(a => a.Id);
        StopActiveStoryboards();
        _elementCache.Clear();
        UpdateReorderState();

        UpdateEmptyState();
    }

    private void ApplySortSelectionToMenu()
    {
        SortNewestFirst.IsChecked = _currentSortOption == SortOption.DateAddedDesc;
        SortOldestFirst.IsChecked = _currentSortOption == SortOption.DateAddedAsc;
        SortNameAsc.IsChecked = _currentSortOption == SortOption.AlphabeticalAsc;
        SortNameDesc.IsChecked = _currentSortOption == SortOption.AlphabeticalDesc;
        SortCustomOrder.IsChecked = _currentSortOption == SortOption.CustomOrder;
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
