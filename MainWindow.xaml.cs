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
    private bool _isApplyingWindowsHelloRecovery;
    private AppLockMode _currentLockMode;

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
            rootGrid.PointerMoved += OnGlobalPointerActivity;
            rootGrid.PointerPressed += OnGlobalPointerActivity;
            rootGrid.KeyDown += OnGlobalKeyActivity;
        }

        ContentFrame.PointerMoved += OnGlobalPointerActivity;
        ContentFrame.PointerPressed += OnGlobalPointerActivity;
        ContentFrame.KeyDown += OnGlobalKeyActivity;

        NavView.PointerMoved += OnGlobalPointerActivity;
        NavView.PointerPressed += OnGlobalPointerActivity;

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
        var decision = await GetAppLockDecisionAsync();

        if (decision.DisableUnavailableWindowsHello)
        {
            await RecoverFromUnavailableWindowsHelloAsync();
            return;
        }

        if (decision.Mode == AppLockMode.None)
        {
            EnsureInitialPage();
            SetupAutoLockMonitoring();
            return;
        }

        await ShowLockScreenAsync(decision);
    }

    private async Task ShowLockScreenAsync()
    {
        await ShowLockScreenAsync(await GetAppLockDecisionAsync());
    }

    private async Task ShowLockScreenAsync(AppLockDecision decision)
    {
        if (decision.DisableUnavailableWindowsHello)
        {
            await RecoverFromUnavailableWindowsHelloAsync();
            return;
        }

        if (decision.Mode == AppLockMode.None)
        {
            LockOverlay.Visibility = Visibility.Collapsed;
            ClearUnlockInputs();
            SetupAutoLockMonitoring();
            return;
        }

        _autoLock.StopMonitoring();
        _currentLockMode = decision.Mode;

        LockOverlay.Visibility = Visibility.Visible;
        UnlockErrorText.Visibility = Visibility.Collapsed;

        switch (decision.Mode)
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
                await RecoverFromUnavailableWindowsHelloAsync();
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
        if (_isApplyingWindowsHelloRecovery || !IsProtectionSetting(e.PropertyName))
        {
            return;
        }

        _dispatcherQueue.TryEnqueue(async () =>
        {
            if (LockOverlay.Visibility == Visibility.Visible)
            {
                return;
            }

            var decision = await GetAppLockDecisionAsync();
            _autoLock.StopMonitoring();

            if (decision.DisableUnavailableWindowsHello)
            {
                await RecoverFromUnavailableWindowsHelloAsync();
                return;
            }

            SetupAutoLockMonitoring();
        });
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

    private async Task<AppLockDecision> GetAppLockDecisionAsync()
    {
        var windowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable;

        if (_appSettings.IsWindowsHelloEnabled)
        {
            windowsHelloAvailability = await _appLock.GetWindowsHelloAvailabilityAsync();
        }

        return AppLockDecisionResolver.Resolve(
            _appSettings.IsPinProtectionEnabled,
            _appLock.GetPinStatus(),
            _appSettings.IsPasswordProtectionEnabled,
            _appLock.GetPasswordStatus(),
            _appSettings.IsWindowsHelloEnabled,
            windowsHelloAvailability);
    }

    private async Task RecoverFromUnavailableWindowsHelloAsync()
    {
        _autoLock.StopMonitoring();
        LockOverlay.Visibility = Visibility.Collapsed;
        _currentLockMode = AppLockMode.None;
        ClearUnlockInputs();

        try
        {
            _isApplyingWindowsHelloRecovery = true;
            _appSettings.IsWindowsHelloEnabled = false;
        }
        finally
        {
            _isApplyingWindowsHelloRecovery = false;
        }

        NavigateIfNeeded(typeof(SettingsPage));

        await ShowWindowsHelloRecoveryDialogAsync();
        SetupAutoLockMonitoring();
    }

    private async Task ShowWindowsHelloRecoveryDialogAsync()
    {
        var dialog = new ContentDialog
        {
            Title = "Windows Hello unavailable",
            Content = "Windows Hello is no longer available, so app protection with Windows Hello was turned off. Choose a PIN or password in Settings to keep the app protected.",
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
