using System.IO;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Navigation;
using Windows.Security.Credentials.UI;
using WinOTP.Pages;
using WinOTP.Services;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    private readonly IAppSettingsService _appSettings;
    private readonly IAppUpdateService _appUpdate;
    private readonly IAppLockService _appLock;
    private readonly IAutoLockService _autoLock;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue _dispatcherQueue;
    private bool _autoLockHandlersSetUp;
    private bool _isApplyingProtectionRecovery;
    private bool _isReconcilingActivationProtectionState;
    private bool _hasStartedStartupInitialization;
    private bool _hasEffectiveProtection;
    private bool _lastResolvedHadWindowsHelloRemoteSession;
    private TemporaryProtectionUnavailableReason? _lastTemporaryProtectionUnavailableReason;
    private AppLockMode _currentLockMode;

    private enum TemporaryProtectionUnavailableReason
    {
        ServiceError,
        RemoteSession
    }

    private readonly record struct ResolvedProtectionState(
        AppLockResolution Resolution,
        bool ShowRecoveryDialog,
        TemporaryProtectionUnavailableReason? TemporaryBypassReason)
    {
        public bool ShowTemporaryBypassDialog => TemporaryBypassReason is not null;
    }

    public MainWindow()
    {
        this.InitializeComponent();

        _appSettings = App.Current.AppSettings;
        _appUpdate = App.Current.AppUpdate;
        _appLock = App.Current.AppLock;
        _dispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        // Initialize auto-lock service
        App.Current.InitializeAutoLockService();
        _autoLock = App.Current.AutoLock!;
        _autoLock.SetDispatcherQueue(_dispatcherQueue);
        _autoLock.LockRequested += OnAutoLockRequested;
        _appSettings.SettingsChanged += OnAppSettingsChanged;
        _appUpdate.StateChanged += OnAppUpdateStateChanged;
        Activated += MainWindow_Activated;

        // Custom title bar
        this.ExtendsContentIntoTitleBar = true;
        this.SetTitleBar(AppTitleBar);
        ApplyWindowIcons();

        // Acrylic backdrop
        this.SystemBackdrop = new Microsoft.UI.Xaml.Media.DesktopAcrylicBackdrop();

        // Window size - fixed at 480x650 (fits one TOTP card with padding)
        this.AppWindow.Resize(new Windows.Graphics.SizeInt32(480, 650));

        // Disable resizing - fixed window size
        if (this.AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter presenter)
        {
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
        }

        // Frame navigation tracking
        ContentFrame.Navigated += ContentFrame_Navigated;
        UpdateSettingsNavBadge(_appUpdate.CurrentState);
    }

    private void ApplyWindowIcons()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
        if (!File.Exists(iconPath))
        {
            App.Current.Logger.Warn($"App icon file '{iconPath}' was not found.");
            return;
        }

        AppWindow.SetIcon(iconPath);
        AppWindow.SetTaskbarIcon(iconPath);
    }

    private async void MainWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState == WindowActivationState.Deactivated)
        {
            return;
        }

        if (!_hasStartedStartupInitialization)
        {
            _hasStartedStartupInitialization = true;
            await InitializeAsync();
            return;
        }

        await HandleActivationProtectionReconciliationAsync();
    }

    private void SetupAutoLockMonitoring()
    {
        // Only set up handlers once to avoid duplicates
        if (_autoLockHandlersSetUp)
        {
            _autoLock.StartMonitoring();
            return;
        }

        // Set up global input handlers for auto-lock activity detection
        // Attach to multiple elements to ensure we catch all activity
        var rootGrid = this.Content as UIElement;
        if (rootGrid != null)
        {
            AttachGlobalActivityHandlers(rootGrid);
        }

        AttachGlobalActivityHandlers(ContentFrame);
        AttachGlobalActivityHandlers(NavView);

        _autoLockHandlersSetUp = true;

        // Start the monitoring
        _autoLock.StartMonitoring();
    }

    private async Task InitializeAsync()
    {
        await EvaluateProtectionStateAsync();
        _ = _appUpdate.InitializeAsync();
    }

    private async Task EvaluateProtectionStateAsync()
    {
        var state = await ResolveProtectionStateAsync();
        _hasEffectiveProtection = state.Resolution.Mode != AppLockMode.None;

        if (state.ShowRecoveryDialog)
        {
            _hasEffectiveProtection = false;
            await ShowProtectionRecoveryAsync();
            return;
        }

        if (state.ShowTemporaryBypassDialog)
        {
            _hasEffectiveProtection = false;
            await ShowTemporaryProtectionUnavailableAsync(
                state.TemporaryBypassReason ?? TemporaryProtectionUnavailableReason.ServiceError);
            return;
        }

        var decision = AppLockPresentationPolicy.Resolve(AppLockPresentationTrigger.Startup, state.Resolution);

        if (decision.ShouldEnsureInitialPage)
        {
            EnsureInitialPage();
        }

        if (decision.ShouldStartMonitoring)
        {
            SetupAutoLockMonitoring();
        }

        if (!decision.ShouldShowLockScreen)
        {
            return;
        }

        await ShowLockScreenAsync(state.Resolution);
    }

    private async Task ShowLockScreenAsync()
    {
        var state = await ResolveProtectionStateAsync();
        await PresentResolvedProtectionStateAsync(state);
    }

    private async Task ShowLockScreenAsync(AppLockResolution resolution)
    {
        _hasEffectiveProtection = resolution.Mode != AppLockMode.None;

        if (resolution.Mode == AppLockMode.None)
        {
            LockOverlay.Visibility = Visibility.Collapsed;
            _currentLockMode = AppLockMode.None;
            ClearUnlockInputs();
            SetupAutoLockMonitoring();
            return;
        }

        _autoLock.StopMonitoring();
        _currentLockMode = resolution.Mode;

        LockOverlay.Visibility = Visibility.Visible;
        UnlockErrorText.Visibility = Visibility.Collapsed;

        switch (resolution.Mode)
        {
            case AppLockMode.Pin:
                PinInput.Visibility = Visibility.Visible;
                PasswordInput.Visibility = Visibility.Collapsed;
                WindowsHelloButton.Visibility = Visibility.Collapsed;
                UnlockButton.Visibility = Visibility.Visible;
                LockSubtitleText.Text = "Enter your PIN to unlock";
                PinInput.Focus(FocusState.Programmatic);
                break;
            case AppLockMode.Password:
                PinInput.Visibility = Visibility.Collapsed;
                PasswordInput.Visibility = Visibility.Visible;
                WindowsHelloButton.Visibility = Visibility.Collapsed;
                UnlockButton.Visibility = Visibility.Visible;
                LockSubtitleText.Text = "Enter your password to unlock";
                PasswordInput.Focus(FocusState.Programmatic);
                break;
            case AppLockMode.WindowsHelloRemotePin:
                PinInput.Visibility = Visibility.Visible;
                PasswordInput.Visibility = Visibility.Collapsed;
                WindowsHelloButton.Visibility = Visibility.Collapsed;
                UnlockButton.Visibility = Visibility.Visible;
                LockSubtitleText.Text = "Remote Desktop session detected. Enter your Remote Desktop PIN to unlock.";
                PinInput.Focus(FocusState.Programmatic);
                break;
            case AppLockMode.WindowsHelloRemotePassword:
                PinInput.Visibility = Visibility.Collapsed;
                PasswordInput.Visibility = Visibility.Visible;
                WindowsHelloButton.Visibility = Visibility.Collapsed;
                UnlockButton.Visibility = Visibility.Visible;
                LockSubtitleText.Text = "Remote Desktop session detected. Enter your Remote Desktop password to unlock.";
                PasswordInput.Focus(FocusState.Programmatic);
                break;
            case AppLockMode.WindowsHello:
                PinInput.Visibility = Visibility.Collapsed;
                PasswordInput.Visibility = Visibility.Collapsed;
                UnlockButton.Visibility = Visibility.Collapsed;
                WindowsHelloButton.Visibility = Visibility.Visible;
                LockSubtitleText.Text = "Use Windows Hello to unlock";
                await AttemptWindowsHelloUnlockAsync();
                break;
        }
    }

    private async void UnlockButton_Click(object sender, RoutedEventArgs e)
    {
        await AttemptUnlockAsync();
    }

    private async void WindowsHelloButton_Click(object sender, RoutedEventArgs e)
    {
        await AttemptWindowsHelloUnlockAsync();
    }

    private void PinInput_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            _ = AttemptUnlockAsync();
        }
    }

    private void PasswordInput_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            _ = AttemptUnlockAsync();
        }
    }

    private async Task AttemptUnlockAsync()
    {
        bool isValid = false;
        var currentLockMode = _currentLockMode;

        if (currentLockMode is AppLockMode.WindowsHelloRemotePin or AppLockMode.WindowsHelloRemotePassword)
        {
            var state = await ResolveProtectionStateAsync();
            if (AppLockSessionTransitionPolicy.ShouldRefreshBeforeCredentialVerification(
                currentLockMode,
                state.Resolution))
            {
                await PresentResolvedProtectionStateAsync(state);
                return;
            }

            currentLockMode = state.Resolution.Mode;
        }

        if (currentLockMode is AppLockMode.Pin or AppLockMode.WindowsHelloRemotePin)
        {
            var pin = PinInput.Password;
            if (!string.IsNullOrWhiteSpace(pin))
            {
                isValid = currentLockMode == AppLockMode.Pin
                    ? await _appLock.VerifyPinAsync(pin)
                    : await _appLock.VerifyWindowsHelloRemotePinAsync(pin);
            }
        }
        else if (currentLockMode is AppLockMode.Password or AppLockMode.WindowsHelloRemotePassword)
        {
            var password = PasswordInput.Password;
            if (!string.IsNullOrWhiteSpace(password))
            {
                isValid = currentLockMode == AppLockMode.Password
                    ? await _appLock.VerifyPasswordAsync(password)
                    : await _appLock.VerifyWindowsHelloRemotePasswordAsync(password);
            }
        }

        if (isValid)
        {
            UnlockSuccess();
        }
        else
        {
            if (await TryHandleUnavailableCredentialDuringUnlockAsync())
            {
                return;
            }

            UnlockErrorText.Text = GetUnlockFailureMessage();
            UnlockErrorText.Visibility = Visibility.Visible;

            if (PinInput.Visibility == Visibility.Visible)
            {
                PinInput.Password = "";
                PinInput.Focus(FocusState.Programmatic);
            }
            else
            {
                PasswordInput.Password = "";
                PasswordInput.Focus(FocusState.Programmatic);
            }
        }
    }

    private async Task AttemptWindowsHelloUnlockAsync()
    {
        if (_currentLockMode != AppLockMode.WindowsHello)
        {
            return;
        }

        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var outcome = await _appLock.VerifyWindowsHelloAsync("Unlock WinOTP", hwnd);

            if (outcome.Status == WindowsHelloVerificationStatus.Verified)
            {
                UnlockSuccess();
            }
            else
            {
                if (outcome.Status is WindowsHelloVerificationStatus.Unavailable
                    or WindowsHelloVerificationStatus.RemoteSession
                    or WindowsHelloVerificationStatus.Error)
                {
                    var state = await ResolveProtectionStateAsync();
                    await PresentResolvedProtectionStateAsync(state);
                    return;
                }

                string errorMessage = outcome.Status switch
                {
                    WindowsHelloVerificationStatus.Failed when outcome.Result == UserConsentVerificationResult.RetriesExhausted
                        => "Too many failed attempts. Please try again later.",
                    _ => "Windows Hello verification failed. Please try again."
                };

                UnlockErrorText.Text = errorMessage;
                UnlockErrorText.Visibility = Visibility.Visible;
            }
        }
        catch (Exception ex)
        {
            App.Current.Logger.Error("Unexpected exception while attempting Windows Hello unlock.", ex);
            await ShowTemporaryProtectionUnavailableAsync(TemporaryProtectionUnavailableReason.ServiceError);
        }
    }

    private void UnlockSuccess()
    {
        LockOverlay.Visibility = Visibility.Collapsed;
        _currentLockMode = AppLockMode.None;
        ClearUnlockInputs();

        SetupAutoLockMonitoring();

        if (ContentFrame.Content == null)
        {
            NavigateToHome();
        }
    }

    private void ContentFrame_Navigated(object sender, NavigationEventArgs e)
    {
        // Update back button visibility and enabled state
        NavView.IsBackButtonVisible = ContentFrame.CanGoBack
            ? NavigationViewBackButtonVisible.Visible
            : NavigationViewBackButtonVisible.Collapsed;
        NavView.IsBackEnabled = ContentFrame.CanGoBack;

        // Sync selection to Home when on HomePage
        if (e.SourcePageType == typeof(HomePage))
        {
            NavView.SelectedItem = NavView.MenuItems[0];
        }
        // Sync selection to Settings when on SettingsPage
        else if (e.SourcePageType == typeof(SettingsPage))
        {
            NavView.SelectedItem = NavView.FooterMenuItems[0];
        }
    }

    private void NavView_ItemInvoked(NavigationView sender,
        NavigationViewItemInvokedEventArgs args)
    {
        var invokedItem = args.InvokedItemContainer as NavigationViewItem;
        if (invokedItem is null) return;

        var tag = invokedItem.Tag as string;

        switch (tag)
        {
            case "Home":
                NavigateIfNeeded(typeof(HomePage));
                break;
            case "Settings":
                NavigateIfNeeded(typeof(SettingsPage));
                break;
        }
    }

    private void NavView_BackRequested(NavigationView sender,
        NavigationViewBackRequestedEventArgs args)
    {
        if (ContentFrame.CanGoBack)
        {
            ContentFrame.GoBack();
        }
    }

    private void NavigateIfNeeded(Type pageType)
    {
        if (ContentFrame.CurrentSourcePageType != pageType)
        {
            ContentFrame.Navigate(pageType);
        }
    }

    private void OnAutoLockRequested(object? sender, EventArgs e)
    {
        // Lock the app when auto-lock requests it
        _dispatcherQueue.TryEnqueue(() =>
        {
            if (LockOverlay.Visibility == Visibility.Collapsed)
            {
                _ = ShowLockScreenAsync();
            }
        });
    }

    private void OnAppSettingsChanged(object? sender, AppSettingsChangedEventArgs e)
    {
        if (_isApplyingProtectionRecovery || !IsProtectionSetting(e.PropertyName))
        {
            return;
        }

        _dispatcherQueue.TryEnqueue(async () =>
        {
            if (LockOverlay.Visibility == Visibility.Visible)
            {
                return;
            }

            var state = await ResolveProtectionStateAsync();
            _autoLock.StopMonitoring();

            if (state.ShowRecoveryDialog)
            {
                _hasEffectiveProtection = false;
                await ShowProtectionRecoveryAsync();
                return;
            }

            if (state.ShowTemporaryBypassDialog)
            {
                _hasEffectiveProtection = false;
                await ShowTemporaryProtectionUnavailableAsync(
                    state.TemporaryBypassReason ?? TemporaryProtectionUnavailableReason.ServiceError);
                return;
            }

            var isProtectedNow = state.Resolution.Mode != AppLockMode.None;
            _hasEffectiveProtection = isProtectedNow;
            var decision = AppLockPresentationPolicy.Resolve(AppLockPresentationTrigger.SettingsChange, state.Resolution);

            if (decision.ShouldEnsureInitialPage)
            {
                EnsureInitialPage();
            }

            if (decision.ShouldStartMonitoring)
            {
                SetupAutoLockMonitoring();
            }
        });
    }

    private void OnAppUpdateStateChanged(object? sender, UpdateStateChangedEventArgs e)
    {
        _dispatcherQueue.TryEnqueue(() => UpdateSettingsNavBadge(e.State));
    }

    private void AttachGlobalActivityHandlers(UIElement element)
    {
        element.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler(OnGlobalPointerActivity), true);
        element.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(OnGlobalPointerActivity), true);
        element.AddHandler(UIElement.PointerWheelChangedEvent, new PointerEventHandler(OnGlobalPointerActivity), true);
        element.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(OnGlobalKeyActivity), true);
    }

    private void OnGlobalPointerActivity(object sender, PointerRoutedEventArgs e)
    {
        // Only reset if we're not currently locked
        if (LockOverlay.Visibility == Visibility.Collapsed)
        {
            _autoLock.ResetTimer();
        }
    }

    private void OnGlobalKeyActivity(object sender, KeyRoutedEventArgs e)
    {
        // Only reset if we're not currently locked
        if (LockOverlay.Visibility == Visibility.Collapsed)
        {
            _autoLock.ResetTimer();
        }
    }

    private static bool IsProtectionSetting(string propertyName)
    {
        return propertyName is nameof(IAppSettingsService.IsPinProtectionEnabled)
            or nameof(IAppSettingsService.IsPasswordProtectionEnabled)
            or nameof(IAppSettingsService.IsWindowsHelloEnabled)
            or nameof(IAppSettingsService.IsWindowsHelloRemotePinEnabled)
            or nameof(IAppSettingsService.IsWindowsHelloRemotePasswordEnabled)
            or nameof(IAppSettingsService.AutoLockTimeoutMinutes);
    }

    private void UpdateSettingsNavBadge(UpdateState state)
    {
        SettingsNavItem.InfoBadge = state.IsUpdateAvailable
            ? new InfoBadge()
            : null;
    }

    private async Task<ResolvedProtectionState> ResolveProtectionStateAsync()
    {
        if (!_appSettings.IsWindowsHelloEnabled &&
            (_appSettings.IsWindowsHelloRemotePinEnabled || _appSettings.IsWindowsHelloRemotePasswordEnabled))
        {
            await ClearWindowsHelloRemoteFallbackAsync();
        }

        var resolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        var temporaryBypassReason = GetTemporaryBypassReason(resolution);
        if (!resolution.HasUnavailableConfiguredProtection)
        {
            if (resolution.Mode != AppLockMode.None)
            {
                _lastTemporaryProtectionUnavailableReason = null;
            }

            _lastResolvedHadWindowsHelloRemoteSession = resolution.HasWindowsHelloRemoteSession;

            return new ResolvedProtectionState(
                resolution,
                ShowRecoveryDialog: false,
                TemporaryBypassReason: temporaryBypassReason);
        }

        await ClearUnavailableProtectionSettingsAsync(resolution);
        var normalizedResolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        var normalizedTemporaryBypassReason = GetTemporaryBypassReason(normalizedResolution);
        if (normalizedResolution.Mode != AppLockMode.None)
        {
            _lastTemporaryProtectionUnavailableReason = null;
        }

        _lastResolvedHadWindowsHelloRemoteSession = normalizedResolution.HasWindowsHelloRemoteSession;

        return new ResolvedProtectionState(
            normalizedResolution,
            ShowRecoveryDialog: normalizedResolution.Mode == AppLockMode.None &&
                normalizedTemporaryBypassReason is null,
            TemporaryBypassReason: normalizedTemporaryBypassReason);
    }

    private async Task ClearUnavailableProtectionSettingsAsync(AppLockResolution resolution)
    {
        try
        {
            _isApplyingProtectionRecovery = true;

            if (resolution.DisableUnavailablePin)
            {
                _appSettings.IsPinProtectionEnabled = false;
            }

            if (resolution.DisableUnavailablePassword)
            {
                _appSettings.IsPasswordProtectionEnabled = false;
            }

            if (resolution.DisableUnavailableWindowsHello)
            {
                _appSettings.IsWindowsHelloEnabled = false;
                await ClearWindowsHelloRemoteFallbackCoreAsync();
            }
            else
            {
                if (resolution.DisableUnavailableWindowsHelloRemotePin)
                {
                    _appSettings.IsWindowsHelloRemotePinEnabled = false;
                    await _appLock.RemoveWindowsHelloRemotePinAsync();
                }

                if (resolution.DisableUnavailableWindowsHelloRemotePassword)
                {
                    _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
                    await _appLock.RemoveWindowsHelloRemotePasswordAsync();
                }
            }
        }
        finally
        {
            _isApplyingProtectionRecovery = false;
        }
    }

    private async Task<bool> TryHandleUnavailableCredentialDuringUnlockAsync()
    {
        var currentCredentialStatus = _currentLockMode switch
        {
            AppLockMode.Pin => _appLock.GetPinStatus(),
            AppLockMode.Password => _appLock.GetPasswordStatus(),
            AppLockMode.WindowsHelloRemotePin => _appLock.GetWindowsHelloRemotePinStatus(),
            AppLockMode.WindowsHelloRemotePassword => _appLock.GetWindowsHelloRemotePasswordStatus(),
            _ => AppLockCredentialStatus.Set
        };

        if (currentCredentialStatus == AppLockCredentialStatus.Set)
        {
            return false;
        }

        var state = await ResolveProtectionStateAsync();
        await PresentResolvedProtectionStateAsync(state);
        return true;
    }

    private async Task PresentResolvedProtectionStateAsync(ResolvedProtectionState state)
    {
        if (state.ShowRecoveryDialog)
        {
            await ShowProtectionRecoveryAsync();
            return;
        }

        if (state.ShowTemporaryBypassDialog)
        {
            await ShowTemporaryProtectionUnavailableAsync(
                state.TemporaryBypassReason ?? TemporaryProtectionUnavailableReason.ServiceError);
            return;
        }

        await ShowLockScreenAsync(state.Resolution);
    }

    private async Task HandleActivationProtectionReconciliationAsync()
    {
        if (_isReconcilingActivationProtectionState)
        {
            return;
        }

        _isReconcilingActivationProtectionState = true;

        try
        {
            var hadRemoteSessionContext = _lastResolvedHadWindowsHelloRemoteSession;
            if (!hadRemoteSessionContext)
            {
                return;
            }

            var state = await ResolveProtectionStateAsync();
            if (!AppLockSessionTransitionPolicy.ShouldReapplyProtectionOnActivation(
                hadRemoteSessionContext,
                state.Resolution))
            {
                return;
            }

            await PresentResolvedProtectionStateAsync(state);
        }
        finally
        {
            _isReconcilingActivationProtectionState = false;
        }
    }

    private async Task ShowProtectionRecoveryAsync()
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _currentLockMode = AppLockMode.None;
        _hasEffectiveProtection = false;
        ClearUnlockInputs();

        NavigateIfNeeded(typeof(SettingsPage));

        await ShowProtectionRecoveryDialogAsync();
        SetupAutoLockMonitoring();
    }

    private async Task ShowTemporaryProtectionUnavailableAsync(TemporaryProtectionUnavailableReason reason)
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _currentLockMode = AppLockMode.None;
        _hasEffectiveProtection = false;
        ClearUnlockInputs();

        EnsureInitialPage();

        if (_lastTemporaryProtectionUnavailableReason != reason)
        {
            _lastTemporaryProtectionUnavailableReason = reason;
            await ShowTemporaryProtectionUnavailableDialogAsync(reason);
        }

        SetupAutoLockMonitoring();
    }

    private async Task ShowProtectionRecoveryDialogAsync()
    {
        var rootElement = Content as FrameworkElement
            ?? throw new InvalidOperationException("Main window content is not ready for dialog hosting.");

        var dialog = new ContentDialog
        {
            Title = "App protection unavailable",
            Content = "One or more configured protection methods are no longer available and were turned off. Choose a PIN, password, or Windows Hello in Settings to keep the app protected.",
            CloseButtonText = "OK",
            XamlRoot = rootElement.XamlRoot
        };

        await dialog.ShowAsync();
    }

    private async Task ShowTemporaryProtectionUnavailableDialogAsync(TemporaryProtectionUnavailableReason reason)
    {
        var rootElement = Content as FrameworkElement
            ?? throw new InvalidOperationException("Main window content is not ready for dialog hosting.");

        var (title, content) = reason switch
        {
            TemporaryProtectionUnavailableReason.RemoteSession => (
                "Windows Hello unavailable in Remote Desktop",
                "Windows Hello cannot be used while WinOTP is running in a Remote Desktop session. Your Windows Hello setting was kept. Configure a Remote Desktop PIN or password in Settings if you want WinOTP to stay locked while connected remotely; otherwise the app will remain unlocked until you use the app locally again."),
            _ => (
                "App protection temporarily unavailable",
                "WinOTP could not verify your configured protection because Windows security services are temporarily unavailable. Your protection settings were kept and the app will remain unlocked until protection becomes available again.")
        };

        var dialog = new ContentDialog
        {
            Title = title,
            Content = content,
            CloseButtonText = "OK",
            XamlRoot = rootElement.XamlRoot
        };

        await dialog.ShowAsync();
    }

    private static TemporaryProtectionUnavailableReason? GetTemporaryBypassReason(AppLockResolution resolution)
    {
        if (resolution.Mode != AppLockMode.None)
        {
            return null;
        }

        return resolution.HasConfiguredProtectionError
            ? TemporaryProtectionUnavailableReason.ServiceError
            : resolution.HasWindowsHelloRemoteSession
                ? TemporaryProtectionUnavailableReason.RemoteSession
                : null;
    }

    private static TemporaryProtectionUnavailableReason GetTemporaryBypassReason(
        WindowsHelloVerificationStatus status)
    {
        return status == WindowsHelloVerificationStatus.RemoteSession
            ? TemporaryProtectionUnavailableReason.RemoteSession
            : TemporaryProtectionUnavailableReason.ServiceError;
    }

    private void EnsureInitialPage()
    {
        if (ContentFrame.Content == null)
        {
            NavigateToHome();
        }
    }

    private void NavigateToHome()
    {
        ContentFrame.Navigate(typeof(HomePage));
        NavView.SelectedItem = NavView.MenuItems[0];
    }

    private void ClearUnlockInputs()
    {
        PinInput.Password = "";
        PasswordInput.Password = "";
        UnlockErrorText.Visibility = Visibility.Collapsed;
    }

    private string GetUnlockFailureMessage()
    {
        return _currentLockMode switch
        {
            AppLockMode.Pin or AppLockMode.WindowsHelloRemotePin => "Incorrect PIN. Please try again.",
            AppLockMode.Password or AppLockMode.WindowsHelloRemotePassword => "Incorrect password. Please try again.",
            _ => "Incorrect credential. Please try again."
        };
    }

    private async Task ClearWindowsHelloRemoteFallbackAsync()
    {
        try
        {
            _isApplyingProtectionRecovery = true;
            await ClearWindowsHelloRemoteFallbackCoreAsync();
        }
        finally
        {
            _isApplyingProtectionRecovery = false;
        }
    }

    private async Task ClearWindowsHelloRemoteFallbackCoreAsync()
    {
        _appSettings.IsWindowsHelloRemotePinEnabled = false;
        _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
        await _appLock.RemoveWindowsHelloRemotePinAsync();
        await _appLock.RemoveWindowsHelloRemotePasswordAsync();
    }
}
