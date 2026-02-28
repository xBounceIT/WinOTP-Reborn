using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Navigation;
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

        // Check if app lock is enabled
        if (ShouldShowLockScreen())
        {
            ShowLockScreen();
        }
        else
        {
            // Navigate to Home and select the Home item
            ContentFrame.Navigate(typeof(HomePage));
            NavView.SelectedItem = NavView.MenuItems[0];

            // Start auto-lock monitoring since we're not showing lock screen
            SetupAutoLockMonitoring();
        }
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

    private bool ShouldShowLockScreen()
    {
        return (_appSettings.IsPinProtectionEnabled && _appLock.IsPinSet()) ||
               (_appSettings.IsPasswordProtectionEnabled && _appLock.IsPasswordSet()) ||
               (_appSettings.IsWindowsHelloEnabled);
    }

    private async void ShowLockScreen()
    {
        // Stop auto-lock monitoring while locked
        _autoLock.StopMonitoring();

        LockOverlay.Visibility = Visibility.Visible;
        UnlockErrorText.Visibility = Visibility.Collapsed;

        if (_appSettings.IsPinProtectionEnabled && _appLock.IsPinSet())
        {
            PinInput.Visibility = Visibility.Visible;
            PasswordInput.Visibility = Visibility.Collapsed;
            WindowsHelloButton.Visibility = Visibility.Collapsed;
            UnlockButton.Visibility = Visibility.Visible;
            LockSubtitleText.Text = "Enter your PIN to unlock";
            PinInput.Focus(FocusState.Programmatic);
        }
        else if (_appSettings.IsPasswordProtectionEnabled && _appLock.IsPasswordSet())
        {
            PinInput.Visibility = Visibility.Collapsed;
            PasswordInput.Visibility = Visibility.Visible;
            WindowsHelloButton.Visibility = Visibility.Collapsed;
            UnlockButton.Visibility = Visibility.Visible;
            LockSubtitleText.Text = "Enter your password to unlock";
            PasswordInput.Focus(FocusState.Programmatic);
        }
        else if (_appSettings.IsWindowsHelloEnabled)
        {
            PinInput.Visibility = Visibility.Collapsed;
            PasswordInput.Visibility = Visibility.Collapsed;
            UnlockButton.Visibility = Visibility.Collapsed;
            WindowsHelloButton.Visibility = Visibility.Visible;
            LockSubtitleText.Text = "Use Windows Hello to unlock";
            // Auto-trigger Windows Hello authentication
            await AttemptWindowsHelloUnlockAsync();
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

        if (_appSettings.IsPinProtectionEnabled && _appLock.IsPinSet())
        {
            var pin = PinInput.Text;
            if (!string.IsNullOrWhiteSpace(pin))
            {
                isValid = await _appLock.VerifyPinAsync(pin);
            }
        }
        else if (_appSettings.IsPasswordProtectionEnabled && _appLock.IsPasswordSet())
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
                PinInput.Text = "";
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
        var result = await _appLock.VerifyWindowsHelloAsync("Unlock WinOTP");

        if (result == Windows.Security.Credentials.UI.UserConsentVerificationResult.Verified)
        {
            UnlockSuccess();
        }
        else
        {
            string errorMessage = result switch
            {
                Windows.Security.Credentials.UI.UserConsentVerificationResult.DeviceNotPresent => "Windows Hello is not available on this device.",
                Windows.Security.Credentials.UI.UserConsentVerificationResult.NotConfiguredForUser => "Windows Hello is not set up. Please configure it in Windows Settings.",
                Windows.Security.Credentials.UI.UserConsentVerificationResult.DisabledByPolicy => "Windows Hello has been disabled by policy.",
                Windows.Security.Credentials.UI.UserConsentVerificationResult.RetriesExhausted => "Too many failed attempts. Please try again later.",
                _ => "Windows Hello verification failed. Please try again."
            };

            UnlockErrorText.Text = errorMessage;
            UnlockErrorText.Visibility = Visibility.Visible;
        }
    }

    private void UnlockSuccess()
    {
        // Hide lock overlay and navigate to home
        LockOverlay.Visibility = Visibility.Collapsed;
        PinInput.Text = "";
        PasswordInput.Password = "";

        // Setup and start auto-lock monitoring
        SetupAutoLockMonitoring();

        ContentFrame.Navigate(typeof(HomePage));
        NavView.SelectedItem = NavView.MenuItems[0];
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
                ShowLockScreen();
            }
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
}
