using System.IO;
using System.Runtime.InteropServices;
using H.NotifyIcon;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Navigation;
using Windows.Security.Credentials.UI;
using Windows.ApplicationModel.DataTransfer;
using WinOTP.Pages;
using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    private const uint SessionChangeWindowMessage = 0x02B1;
    private const uint NotifyForThisSession = 0;
    private const nuint SessionNotificationSubclassId = 1;

    // Fits one TOTP card with padding.
    private const int MainWindowLogicalWidth = 480;
    private const int MainWindowLogicalHeight = 650;

    public event EventHandler<bool>? WindowActivationChanged;

    private readonly IAppSettingsService _appSettings;
    private readonly IAppUpdateService _appUpdate;
    private readonly IAppLockService _appLock;
    private readonly IAutoLockService _autoLock;
    private readonly ICredentialManagerService _credentialManager;
    private readonly ITotpCodeGenerator _totpGenerator;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue _dispatcherQueue;
    private readonly SubclassProc _sessionNotificationSubclassProc;
    private bool _autoLockHandlersSetUp;
    private bool _isApplyingProtectionRecovery;
    private bool _isReconcilingProtectionState;
    private bool _hasStartedStartupInitialization;
    private bool _hasEffectiveProtection;
    private bool _isSessionNotificationRegistered;
    private bool _isSessionNotificationSubclassInstalled;
    private IntPtr _windowHandle;
    private uint _lastAppliedDpi;
    private bool _forceClose;
    private AppLockProtectionPresentationState _lastResolvedProtectionPresentationState;
    private AppLockTemporaryBypassReason? _lastTemporaryProtectionUnavailableReason;
    private AppLockMode _currentLockMode;
    private TaskbarIcon? _trayIcon;
    private volatile bool _isLocked;

    private readonly record struct ResolvedProtectionState(
        AppLockResolution Resolution,
        bool ShowRecoveryDialog,
        AppLockTemporaryBypassReason? TemporaryBypassReason)
    {
        public bool ShowTemporaryBypassDialog => TemporaryBypassReason is not null;

        public AppLockProtectionPresentationState ToPresentationState()
        {
            return new AppLockProtectionPresentationState(
                Resolution.Mode,
                ShowRecoveryDialog,
                TemporaryBypassReason);
        }
    }

    public MainWindow()
    {
        this.InitializeComponent();

        _appSettings = App.Current.AppSettings;
        _appUpdate = App.Current.AppUpdate;
        _appLock = App.Current.AppLock;
        _credentialManager = App.Current.CredentialManager;
        _totpGenerator = App.Current.TotpGenerator;
        _dispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        _sessionNotificationSubclassProc = SessionNotificationWindowProc;

        // Initialize auto-lock service
        App.Current.InitializeAutoLockService();
        _autoLock = App.Current.AutoLock!;
        _autoLock.SetDispatcherQueue(_dispatcherQueue);
        _autoLock.LockRequested += OnAutoLockRequested;
        _appSettings.SettingsChanged += OnAppSettingsChanged;
        _appUpdate.StateChanged += OnAppUpdateStateChanged;
        Activated += MainWindow_Activated;
        Closed += (_, _) =>
        {
            CleanupSessionChangeMonitoring();
            _trayIcon?.Dispose();
        };
        AppWindow.Closing += AppWindow_Closing;
        AppWindow.Changed += AppWindow_Changed;

        // System tray icon
        InitializeTrayIcon();

        // Custom title bar
        this.ExtendsContentIntoTitleBar = true;
        this.SetTitleBar(AppTitleBar);
        ApplyWindowIcons();

        // Acrylic backdrop
        this.SystemBackdrop = new Microsoft.UI.Xaml.Media.DesktopAcrylicBackdrop();

        // AppWindow.Resize takes physical pixels, so scale by the window's DPI to preserve
        // the intended logical size on monitors at >100% display scaling.
        _windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(this);
        RescaleWindowForCurrentDpi(forceResize: true);

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

        WindowActivationChanged?.Invoke(this, true);

        EnsureSessionChangeMonitoring();

        if (!_hasStartedStartupInitialization)
        {
            // The ctor reads DPI before the window is shown; the OS may place it on a
            // monitor with different DPI before first paint. Re-check now that the window
            // is on its real monitor. No-op if DPI matches what the ctor saw.
            RescaleWindowForCurrentDpi(forceResize: false);

            _hasStartedStartupInitialization = true;
            await InitializeAsync();
            return;
        }

        await HandleProtectionStateReconciliationAsync();
    }

    private void InitializeTrayIcon()
    {
        var contextMenu = new MenuFlyout();

        _trayIcon = new TaskbarIcon
        {
            IconSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(
                new Uri("ms-appx:///Assets/app.ico")),
            ToolTipText = "WinOTP",
            DoubleClickCommand = new RelayCommand(RestoreFromTray),
            // H.NotifyIcon emulates the tray context menu via a Win32 popup, which
            // takes a snapshot of ContextFlyout.Items at the moment of right-click
            // and never raises the WinUI MenuFlyout.Opening event. Rebuild items
            // here so each right-click reflects the current sort order and
            // freshly generated TOTP codes.
            RightClickCommand = new RelayCommand(() => BuildTrayContextMenuItems(contextMenu))
        };

        BuildTrayContextMenuItems(contextMenu);
        _trayIcon.ContextFlyout = contextMenu;

        if (_appSettings.MinimizeOnClose || _appSettings.MinimizeToTrayOnClose)
        {
            _trayIcon.ForceCreate();
        }
    }

    private void BuildTrayContextMenuItems(MenuFlyout contextMenu)
    {
        contextMenu.Items.Clear();

        contextMenu.Items.Add(new MenuFlyoutItem
        {
            Text = "Open WinOTP",
            Command = new RelayCommand(RestoreFromTray)
        });

        if (_appSettings.ShowTotpInTrayMenu && !_isLocked)
        {
            var result = _credentialManager.LoadAccountsAsync().GetAwaiter().GetResult();
            if (result.Accounts.Count > 0)
            {
                contextMenu.Items.Add(new MenuFlyoutSeparator());

                IReadOnlyDictionary<string, (long Count, DateTime LastUsed)>? usageSnapshot = null;
                if (_appSettings.AccountSortOption == SortOption.UsageBased)
                {
                    var usage = App.Current.AccountUsage;
                    usageSnapshot = result.Accounts.ToDictionary(
                        a => a.Id,
                        a => (Count: usage.GetUsageCount(a.Id), LastUsed: usage.GetLastUsedAt(a.Id) ?? DateTime.MinValue));
                }

                var orderedAccounts = OtpAccountSortPolicy.Apply(
                    result.Accounts,
                    _appSettings.AccountSortOption,
                    _appSettings.AccountCustomOrderIds,
                    usageSnapshot);

                foreach (var account in orderedAccounts)
                {
                    var code = _totpGenerator.GenerateCode(account);
                    var item = new MenuFlyoutItem
                    {
                        Text = $"{account.DisplayLabel}  \u2014  {code}"
                    };

                    var capturedAccount = account;
                    item.Command = new RelayCommand(() =>
                    {
                        _dispatcherQueue.TryEnqueue(async () =>
                        {
                            try
                            {
                                var currentCode = _totpGenerator.GenerateCode(capturedAccount);
                                await ClipboardHelper.SetContentWithRetryAsync(currentCode);
                                App.Current.AccountUsage.RecordUsage(capturedAccount.Id);
                            }
                            catch (Exception ex)
                            {
                                App.Current.Logger.Error("Failed to copy TOTP code to clipboard from tray menu", ex);
                            }
                        });
                    });

                    contextMenu.Items.Add(item);
                }
            }
        }

        contextMenu.Items.Add(new MenuFlyoutSeparator());
        contextMenu.Items.Add(new MenuFlyoutItem
        {
            Text = "Exit",
            Command = new RelayCommand(ForceClose)
        });
    }

    private void UpdateTrayContextMenu()
    {
        if (_trayIcon?.ContextFlyout is MenuFlyout flyout)
        {
            BuildTrayContextMenuItems(flyout);
        }
    }

    private void AppWindow_Closing(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowClosingEventArgs args)
    {
        if (_forceClose)
        {
            return;
        }

        if (_appSettings.MinimizeToTrayOnClose)
        {
            args.Cancel = true;
            AppWindow.Hide();
            _trayIcon?.ForceCreate();
            return;
        }

        if (_appSettings.MinimizeOnClose)
        {
            args.Cancel = true;
            if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter presenter)
            {
                presenter.Minimize();
            }
        }
    }

    private void AppWindow_Changed(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowChangedEventArgs args)
    {
        if (args.DidVisibilityChange)
        {
            WindowActivationChanged?.Invoke(this, sender.IsVisible);
        }

        if (args.DidPositionChange)
        {
            // Window may have moved to a monitor with a different DPI. We don't intercept
            // WM_DPICHANGED, and OverlappedPresenter.IsResizable=false suppresses the OS's
            // own auto-resize on cross-monitor drag, so this is the only path that keeps
            // the window correctly sized. Do not remove without adding WM_DPICHANGED handling.
            RescaleWindowForCurrentDpi(forceResize: false);
        }
    }

    private void RescaleWindowForCurrentDpi(bool forceResize)
    {
        if (_windowHandle == IntPtr.Zero)
        {
            return;
        }

        uint currentDpi = WindowDpiHelper.GetDpiForWindow(_windowHandle);
        if (currentDpi == 0)
        {
            // GetDpiForWindow returns 0 for an invalid hwnd. The helper falls back to
            // 1.0 scale, but log so we're not silently undersized on a high-DPI monitor.
            App.Current.Logger.Warn(
                "GetDpiForWindow returned 0 for the main window; falling back to 1.0 scale.");
        }

        if (!forceResize && currentDpi == _lastAppliedDpi)
        {
            return;
        }

        _lastAppliedDpi = currentDpi;
        AppWindow.Resize(WindowDpiHelper.ScaleLogicalSize(
            currentDpi, MainWindowLogicalWidth, MainWindowLogicalHeight));
    }

    private void RestoreFromTray()
    {
        _trayIcon?.Dispose();
        InitializeTrayIcon();
        AppWindow.Show();
        this.Activate();
    }

    public void ForceClose()
    {
        _forceClose = true;
        Close();
    }

    private void EnsureSessionChangeMonitoring()
    {
        if (_isSessionNotificationRegistered || _isSessionNotificationSubclassInstalled)
        {
            return;
        }

        _windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(this);
        if (_windowHandle == IntPtr.Zero)
        {
            App.Current.Logger.Warn("Main window handle was not ready for session notification registration.");
            return;
        }

        if (!SetWindowSubclass(
            _windowHandle,
            _sessionNotificationSubclassProc,
            SessionNotificationSubclassId,
            0))
        {
            App.Current.Logger.Warn(
                $"Failed to install the main window session notification subclass. Win32 error {Marshal.GetLastWin32Error()}.");
            return;
        }

        _isSessionNotificationSubclassInstalled = true;

        if (WTSRegisterSessionNotification(_windowHandle, NotifyForThisSession))
        {
            _isSessionNotificationRegistered = true;
            return;
        }

        App.Current.Logger.Warn(
            $"Failed to register the main window for session notifications. Win32 error {Marshal.GetLastWin32Error()}.");
        CleanupSessionChangeMonitoring();
    }

    private void CleanupSessionChangeMonitoring()
    {
        if (_windowHandle == IntPtr.Zero)
        {
            return;
        }

        if (_isSessionNotificationRegistered && !WTSUnRegisterSessionNotification(_windowHandle))
        {
            App.Current.Logger.Warn(
                $"Failed to unregister the main window session notifications. Win32 error {Marshal.GetLastWin32Error()}.");
        }

        _isSessionNotificationRegistered = false;

        if (_isSessionNotificationSubclassInstalled &&
            !RemoveWindowSubclass(_windowHandle, _sessionNotificationSubclassProc, SessionNotificationSubclassId))
        {
            App.Current.Logger.Warn(
                $"Failed to remove the main window session notification subclass. Win32 error {Marshal.GetLastWin32Error()}.");
        }

        _isSessionNotificationSubclassInstalled = false;
        _windowHandle = IntPtr.Zero;
    }

    private void QueueProtectionStateReconciliation()
    {
        if (!_hasStartedStartupInitialization)
        {
            return;
        }

        if (!_dispatcherQueue.TryEnqueue(() => _ = HandleProtectionStateReconciliationAsync()))
        {
            App.Current.Logger.Warn("Failed to enqueue protection-state reconciliation after a session change.");
        }
    }

    private IntPtr SessionNotificationWindowProc(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam,
        nuint subclassId,
        nuint referenceData)
    {
        try
        {
            if (message == SessionChangeWindowMessage)
            {
                var sessionChangeCode = unchecked((uint)wParam.ToInt64());
                if (AppLockSessionTransitionPolicy.ShouldReconcileOnSessionChange(sessionChangeCode))
                {
                    QueueProtectionStateReconciliation();
                }
            }
        }
        catch (Exception ex)
        {
            App.Current.Logger.Error("Unexpected exception while processing a Windows session change notification.", ex);
        }

        return DefSubclassProc(hWnd, message, wParam, lParam);
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
                state.TemporaryBypassReason ?? AppLockTemporaryBypassReason.ServiceError);
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
            _isLocked = false;
            UpdateTrayContextMenu();
            _currentLockMode = AppLockMode.None;
            ClearUnlockInputs();
            SetupAutoLockMonitoring();
            return;
        }

        _autoLock.StopMonitoring();
        _currentLockMode = resolution.Mode;
        _isLocked = true;
        UpdateTrayContextMenu();

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
            await ShowTemporaryProtectionUnavailableAsync(AppLockTemporaryBypassReason.ServiceError);
        }
    }

    private void UnlockSuccess()
    {
        LockOverlay.Visibility = Visibility.Collapsed;
        _isLocked = false;
        UpdateTrayContextMenu();
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
        if (e.PropertyName is nameof(IAppSettingsService.MinimizeOnClose) or nameof(IAppSettingsService.MinimizeToTrayOnClose))
        {
            if (_appSettings.MinimizeOnClose || _appSettings.MinimizeToTrayOnClose)
            {
                _dispatcherQueue.TryEnqueue(() => _trayIcon?.ForceCreate());
            }
            else
            {
                _dispatcherQueue.TryEnqueue(() => 
                {
                    _trayIcon?.Dispose();
                    InitializeTrayIcon();
                });
            }
        }

        if (e.PropertyName == nameof(IAppSettingsService.ShowTotpInTrayMenu))
        {
            _dispatcherQueue.TryEnqueue(() => UpdateTrayContextMenu());
        }

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

            var previousState = _lastResolvedProtectionPresentationState;
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
                    state.TemporaryBypassReason ?? AppLockTemporaryBypassReason.ServiceError);
                return;
            }

            if (AppLockSessionTransitionPolicy.ShouldRequireImmediateLockOnSettingsChange(
                previousState,
                state.ToPresentationState()))
            {
                await ShowLockScreenAsync(state.Resolution);
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

            return CreateResolvedProtectionState(
                resolution,
                showRecoveryDialog: false,
                temporaryBypassReason);
        }

        await ClearUnavailableProtectionSettingsAsync(resolution);
        var normalizedResolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        var normalizedTemporaryBypassReason = GetTemporaryBypassReason(normalizedResolution);
        if (normalizedResolution.Mode != AppLockMode.None)
        {
            _lastTemporaryProtectionUnavailableReason = null;
        }

        return CreateResolvedProtectionState(
            normalizedResolution,
            showRecoveryDialog: normalizedResolution.Mode == AppLockMode.None &&
                normalizedTemporaryBypassReason is null,
            normalizedTemporaryBypassReason);
    }

    private ResolvedProtectionState CreateResolvedProtectionState(
        AppLockResolution resolution,
        bool showRecoveryDialog,
        AppLockTemporaryBypassReason? temporaryBypassReason)
    {
        var state = new ResolvedProtectionState(
            resolution,
            showRecoveryDialog,
            temporaryBypassReason);

        _lastResolvedProtectionPresentationState = state.ToPresentationState();
        return state;
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
                state.TemporaryBypassReason ?? AppLockTemporaryBypassReason.ServiceError);
            return;
        }

        await ShowLockScreenAsync(state.Resolution);
    }

    private async Task HandleProtectionStateReconciliationAsync()
    {
        if (_isReconcilingProtectionState)
        {
            return;
        }

        _isReconcilingProtectionState = true;

        try
        {
            var previousState = _lastResolvedProtectionPresentationState;
            if (!AppLockSessionTransitionPolicy.ShouldResolveOnReconciliation(
                _appSettings.IsWindowsHelloEnabled,
                previousState))
            {
                return;
            }

            var state = await ResolveProtectionStateAsync();
            if (!AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
                previousState,
                state.ToPresentationState()))
            {
                return;
            }

            await PresentResolvedProtectionStateAsync(state);
        }
        finally
        {
            _isReconcilingProtectionState = false;
        }
    }

    private async Task ShowProtectionRecoveryAsync()
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _isLocked = false;
        UpdateTrayContextMenu();
        _currentLockMode = AppLockMode.None;
        _hasEffectiveProtection = false;
        ClearUnlockInputs();

        NavigateIfNeeded(typeof(SettingsPage));

        await ShowProtectionRecoveryDialogAsync();
        SetupAutoLockMonitoring();
    }

    private async Task ShowTemporaryProtectionUnavailableAsync(AppLockTemporaryBypassReason reason)
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _isLocked = false;
        UpdateTrayContextMenu();
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

    private Task ShowProtectionRecoveryDialogAsync()
    {
        var rootElement = Content as FrameworkElement
            ?? throw new InvalidOperationException("Main window content is not ready for dialog hosting.");

        return DialogHelper.ShowOkAsync(
            rootElement.XamlRoot,
            "App protection unavailable",
            "One or more configured protection methods are no longer available and were turned off. Choose a PIN, password, or Windows Hello in Settings to keep the app protected.");
    }

    private Task ShowTemporaryProtectionUnavailableDialogAsync(AppLockTemporaryBypassReason reason)
    {
        var rootElement = Content as FrameworkElement
            ?? throw new InvalidOperationException("Main window content is not ready for dialog hosting.");

        var (title, content) = reason switch
        {
            AppLockTemporaryBypassReason.RemoteSession => (
                "Windows Hello unavailable in Remote Desktop",
                "Windows Hello cannot be used while WinOTP is running in a Remote Desktop session. Your Windows Hello setting was kept. Configure a Remote Desktop PIN or password in Settings if you want WinOTP to stay locked while connected remotely; otherwise the app will remain unlocked until you use the app locally again."),
            _ => (
                "App protection temporarily unavailable",
                "WinOTP could not verify your configured protection because Windows security services are temporarily unavailable. Your protection settings were kept and the app will remain unlocked until protection becomes available again.")
        };

        return DialogHelper.ShowOkAsync(rootElement.XamlRoot, title, content);
    }

    private static AppLockTemporaryBypassReason? GetTemporaryBypassReason(AppLockResolution resolution)
    {
        if (resolution.Mode != AppLockMode.None)
        {
            return null;
        }

        return resolution.HasConfiguredProtectionError
            ? AppLockTemporaryBypassReason.ServiceError
            : resolution.HasWindowsHelloRemoteSession
                ? AppLockTemporaryBypassReason.RemoteSession
                : null;
    }

    private static AppLockTemporaryBypassReason GetTemporaryBypassReason(
        WindowsHelloVerificationStatus status)
    {
        return status == WindowsHelloVerificationStatus.RemoteSession
            ? AppLockTemporaryBypassReason.RemoteSession
            : AppLockTemporaryBypassReason.ServiceError;
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

    private delegate IntPtr SubclassProc(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam,
        nuint subclassId,
        nuint referenceData);

    [DllImport("comctl32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowSubclass(
        IntPtr hWnd,
        SubclassProc callback,
        nuint subclassId,
        nuint referenceData);

    [DllImport("comctl32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RemoveWindowSubclass(
        IntPtr hWnd,
        SubclassProc callback,
        nuint subclassId);

    [DllImport("comctl32.dll", SetLastError = true)]
    private static extern IntPtr DefSubclassProc(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSRegisterSessionNotification(
        IntPtr hWnd,
        uint flags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);
}
