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

    public MainWindow()
    {
        this.InitializeComponent();

        _appSettings = App.Current.AppSettings;
        _appLock = App.Current.AppLock;

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
        }
    }

    private bool ShouldShowLockScreen()
    {
        return (_appSettings.IsPinProtectionEnabled && _appLock.IsPinSet()) ||
               (_appSettings.IsPasswordProtectionEnabled && _appLock.IsPasswordSet());
    }

    private void ShowLockScreen()
    {
        LockOverlay.Visibility = Visibility.Visible;
        UnlockErrorText.Visibility = Visibility.Collapsed;

        if (_appSettings.IsPinProtectionEnabled && _appLock.IsPinSet())
        {
            PinInput.Visibility = Visibility.Visible;
            PasswordInput.Visibility = Visibility.Collapsed;
            LockSubtitleText.Text = "Enter your PIN to unlock";
            PinInput.Focus(FocusState.Programmatic);
        }
        else if (_appSettings.IsPasswordProtectionEnabled && _appLock.IsPasswordSet())
        {
            PinInput.Visibility = Visibility.Collapsed;
            PasswordInput.Visibility = Visibility.Visible;
            LockSubtitleText.Text = "Enter your password to unlock";
            PasswordInput.Focus(FocusState.Programmatic);
        }
    }

    private async void UnlockButton_Click(object sender, RoutedEventArgs e)
    {
        await AttemptUnlockAsync();
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
            // Hide lock overlay and navigate to home
            LockOverlay.Visibility = Visibility.Collapsed;
            PinInput.Text = "";
            PasswordInput.Password = "";

            ContentFrame.Navigate(typeof(HomePage));
            NavView.SelectedItem = NavView.MenuItems[0];
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
}
