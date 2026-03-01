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
    private readonly IAppLockService _appLock;
    private readonly IAutoLockService _autoLock;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue _dispatcherQueue;
    private bool _autoLockHandlersSetUp;
    private bool _isApplyingProtectionRecovery;
    private AppLockMode _currentLockMode;

    private readonly record struct ResolvedProtectionState(AppLockResolution Resolution, bool ShowRecoveryDialog);

    public MainWindow()
    {
        this.InitializeComponent();

        _appSettings = App.Current.AppSettings;
        _appLock = App.Current.AppLock;
        _dispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        // Initialize auto-lock service
        App.Current.InitializeAutoLockService();
        _autoLock = App.Current.AutoLock!;
        _autoLock.SetDispatcherQueue(_dispatcherQueue);
        _autoLock.LockRequested += OnAutoLockRequested;
        _appSettings.SettingsChanged += OnAppSettingsChanged;

        // Custom title bar
        this.ExtendsContentIntoTitleBar = true;
        this.SetTitleBar(AppTitleBar);

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

        _ = InitializeAsync();
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
    }

    private async Task EvaluateProtectionStateAsync()
    {
        var state = await ResolveProtectionStateAsync();
        if (state.ShowRecoveryDialog)
        {
            await ShowProtectionRecoveryAsync();
            return;
        }

        if (state.Resolution.Mode == AppLockMode.None)
        {
            EnsureInitialPage();
            SetupAutoLockMonitoring();
            return;
        }

        await ShowLockScreenAsync(state.Resolution);
    }

    private async Task ShowLockScreenAsync()
    {
        var state = await ResolveProtectionStateAsync();
        if (state.ShowRecoveryDialog)
        {
            await ShowProtectionRecoveryAsync();
            return;
        }

        await ShowLockScreenAsync(state.Resolution);
    }

    private async Task ShowLockScreenAsync(AppLockResolution resolution)
    {
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

        if (_currentLockMode == AppLockMode.Pin)
        {
            var pin = PinInput.Password;
            if (!string.IsNullOrWhiteSpace(pin))
            {
                isValid = await _appLock.VerifyPinAsync(pin);
            }
        }
        else if (_currentLockMode == AppLockMode.Password)
        {
            var password = PasswordInput.Password;
            if (!string.IsNullOrWhiteSpace(password))
            {
                isValid = await _appLock.VerifyPasswordAsync(password);
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

            UnlockErrorText.Text = "Incorrect PIN or password. Please try again.";
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

        var outcome = await _appLock.VerifyWindowsHelloAsync("Unlock WinOTP");

        if (outcome.Status == WindowsHelloVerificationStatus.Verified)
        {
            UnlockSuccess();
        }
        else
        {
            if (outcome.Status == WindowsHelloVerificationStatus.Unavailable)
            {
                var state = await ResolveProtectionStateAsync();
                if (state.ShowRecoveryDialog)
                {
                    await ShowProtectionRecoveryAsync();
                    return;
                }

                await ShowLockScreenAsync(state.Resolution);
                return;
            }

            string errorMessage = outcome.Status switch
            {
                WindowsHelloVerificationStatus.Error => "Windows Hello is temporarily unavailable. Please try again.",
                WindowsHelloVerificationStatus.Failed when outcome.Result == UserConsentVerificationResult.RetriesExhausted
                    => "Too many failed attempts. Please try again later.",
                _ => "Windows Hello verification failed. Please try again."
            };

            UnlockErrorText.Text = errorMessage;
            UnlockErrorText.Visibility = Visibility.Visible;
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
                await ShowProtectionRecoveryAsync();
                return;
            }

            SetupAutoLockMonitoring();
        });
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
            or nameof(IAppSettingsService.AutoLockTimeoutMinutes);
    }

    private async Task<ResolvedProtectionState> ResolveProtectionStateAsync()
    {
        var resolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        if (!resolution.HasUnavailableConfiguredProtection)
        {
            return new ResolvedProtectionState(resolution, false);
        }

        ClearUnavailableProtectionSettings(resolution);
        var normalizedResolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        return new ResolvedProtectionState(normalizedResolution, normalizedResolution.Mode == AppLockMode.None);
    }

    private void ClearUnavailableProtectionSettings(AppLockResolution resolution)
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
            _ => AppLockCredentialStatus.Error
        };

        if (currentCredentialStatus != AppLockCredentialStatus.NotSet)
        {
            return false;
        }

        var state = await ResolveProtectionStateAsync();
        if (state.ShowRecoveryDialog)
        {
            await ShowProtectionRecoveryAsync();
            return true;
        }

        await ShowLockScreenAsync(state.Resolution);
        return true;
    }

    private async Task ShowProtectionRecoveryAsync()
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _currentLockMode = AppLockMode.None;
        ClearUnlockInputs();

        NavigateIfNeeded(typeof(SettingsPage));

        await ShowProtectionRecoveryDialogAsync();
        SetupAutoLockMonitoring();
    }

    private async Task ShowProtectionRecoveryDialogAsync()
    {
        var dialog = new ContentDialog
        {
            Title = "App protection unavailable",
            Content = "One or more configured protection methods are no longer available and were turned off. Choose a PIN, password, or Windows Hello in Settings to keep the app protected.",
            CloseButtonText = "OK",
            XamlRoot = LockOverlay.XamlRoot
        };

        await dialog.ShowAsync();
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
}
