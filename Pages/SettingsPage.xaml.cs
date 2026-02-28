using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;
using WinOTP.Helpers;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class SettingsPage : Page
{
    private const string RepositoryUrl = "https://github.com/xBounceIT/WinOTP-Reborn";
    private readonly IAppSettingsService _appSettings;
    private readonly IAppLockService _appLock;
    private bool _isInitializingToggle;

    public SettingsPage()
    {
        this.InitializeComponent();
        _appSettings = App.Current.AppSettings;
        _appLock = App.Current.AppLock;

        VersionTextBlock.Text = VersionHelper.GetAppVersion();
        LoadSettings();
    }

    private async void GoToRepositoryButton_Click(object sender, RoutedEventArgs e)
    {
        var uri = new System.Uri(RepositoryUrl);
        await Launcher.LaunchUriAsync(uri);
    }

    private void LoadSettings()
    {
        _isInitializingToggle = true;
        ShowNextCodeToggle.IsOn = _appSettings.ShowNextCodeWhenFiveSecondsRemain;
        PinProtectionToggle.IsOn = _appSettings.IsPinProtectionEnabled;
        PasswordProtectionToggle.IsOn = _appSettings.IsPasswordProtectionEnabled;
        WindowsHelloToggle.IsOn = _appSettings.IsWindowsHelloEnabled;
        _isInitializingToggle = false;
    }

    private void ShowNextCodeToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        _appSettings.ShowNextCodeWhenFiveSecondsRemain = ShowNextCodeToggle.IsOn;
    }

    private async void PinProtectionToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (PinProtectionToggle.IsOn)
        {
            // User wants to enable PIN protection - show setup dialog
            var success = await ShowPinSetupDialogAsync();
            if (!success)
            {
                // User cancelled or setup failed - revert toggle
                _isInitializingToggle = true;
                PinProtectionToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsPinProtectionEnabled = true;
                // Disable other protection methods
                if (PasswordProtectionToggle.IsOn)
                {
                    _isInitializingToggle = true;
                    PasswordProtectionToggle.IsOn = false;
                    _isInitializingToggle = false;
                    _appSettings.IsPasswordProtectionEnabled = false;
                    await _appLock.RemovePasswordAsync();
                }
            }
        }
        else
        {
            // User wants to disable PIN protection - verify first
            var verified = await ShowPinVerificationDialogAsync();
            if (!verified)
            {
                // Verification failed - revert toggle
                _isInitializingToggle = true;
                PinProtectionToggle.IsOn = true;
                _isInitializingToggle = false;
            }
            else
            {
                await _appLock.RemovePinAsync();
                _appSettings.IsPinProtectionEnabled = false;
            }
        }
    }

    private async void PasswordProtectionToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (PasswordProtectionToggle.IsOn)
        {
            // User wants to enable password protection - show setup dialog
            var success = await ShowPasswordSetupDialogAsync();
            if (!success)
            {
                // User cancelled or setup failed - revert toggle
                _isInitializingToggle = true;
                PasswordProtectionToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsPasswordProtectionEnabled = true;
                // Disable other protection methods
                if (PinProtectionToggle.IsOn)
                {
                    _isInitializingToggle = true;
                    PinProtectionToggle.IsOn = false;
                    _isInitializingToggle = false;
                    _appSettings.IsPinProtectionEnabled = false;
                    await _appLock.RemovePinAsync();
                }
            }
        }
        else
        {
            // User wants to disable password protection - verify first
            var verified = await ShowPasswordVerificationDialogAsync();
            if (!verified)
            {
                // Verification failed - revert toggle
                _isInitializingToggle = true;
                PasswordProtectionToggle.IsOn = true;
                _isInitializingToggle = false;
            }
            else
            {
                await _appLock.RemovePasswordAsync();
                _appSettings.IsPasswordProtectionEnabled = false;
            }
        }
    }

    private async void WindowsHelloToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        // Placeholder for Windows Hello implementation
        _isInitializingToggle = true;
        WindowsHelloToggle.IsOn = false;
        _isInitializingToggle = false;

        await ShowInfoDialog("Windows Hello protection is not yet implemented.");
    }

    private async Task<bool> ShowPinSetupDialogAsync()
    {
        var pinTextBox = new TextBox
        {
            PlaceholderText = "Enter PIN (4-6 digits)",
            MaxLength = 6
        };

        var confirmPinTextBox = new TextBox
        {
            PlaceholderText = "Confirm PIN",
            MaxLength = 6
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = "Choose a 4-6 digit PIN to protect the app." });
        stackPanel.Children.Add(pinTextBox);
        stackPanel.Children.Add(confirmPinTextBox);

        var dialog = new ContentDialog
        {
            Title = "Set up PIN",
            Content = stackPanel,
            PrimaryButtonText = "Set PIN",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();

        if (result == ContentDialogResult.Primary)
        {
            var pin = pinTextBox.Text;
            var confirmPin = confirmPinTextBox.Text;

            if (string.IsNullOrWhiteSpace(pin) || pin.Length < 4)
            {
                await ShowErrorDialog("PIN must be at least 4 digits.");
                return false;
            }

            if (!pin.All(char.IsDigit))
            {
                await ShowErrorDialog("PIN must contain only digits.");
                return false;
            }

            if (pin != confirmPin)
            {
                await ShowErrorDialog("PINs do not match.");
                return false;
            }

            var success = await _appLock.SetPinAsync(pin);
            if (!success)
            {
                await ShowErrorDialog("Failed to save PIN. Please try again.");
                return false;
            }

            return true;
        }

        return false;
    }

    private async Task<bool> ShowPasswordSetupDialogAsync()
    {
        var passwordBox = new PasswordBox
        {
            PlaceholderText = "Enter password"
        };

        var confirmPasswordBox = new PasswordBox
        {
            PlaceholderText = "Confirm password"
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = "Choose a password to protect the app." });
        stackPanel.Children.Add(passwordBox);
        stackPanel.Children.Add(confirmPasswordBox);

        var dialog = new ContentDialog
        {
            Title = "Set up Password",
            Content = stackPanel,
            PrimaryButtonText = "Set Password",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();

        if (result == ContentDialogResult.Primary)
        {
            var password = passwordBox.Password;
            var confirmPassword = confirmPasswordBox.Password;

            if (string.IsNullOrWhiteSpace(password) || password.Length < 4)
            {
                await ShowErrorDialog("Password must be at least 4 characters.");
                return false;
            }

            if (password != confirmPassword)
            {
                await ShowErrorDialog("Passwords do not match.");
                return false;
            }

            var success = await _appLock.SetPasswordAsync(password);
            if (!success)
            {
                await ShowErrorDialog("Failed to save password. Please try again.");
                return false;
            }

            return true;
        }

        return false;
    }

    private async Task<bool> ShowPinVerificationDialogAsync()
    {
        var pinTextBox = new TextBox
        {
            PlaceholderText = "Enter your PIN",
            MaxLength = 6
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = "Enter your PIN to disable PIN protection." });
        stackPanel.Children.Add(pinTextBox);

        var dialog = new ContentDialog
        {
            Title = "Verify PIN",
            Content = stackPanel,
            PrimaryButtonText = "Verify",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();

        if (result == ContentDialogResult.Primary)
        {
            var pin = pinTextBox.Text;
            var isValid = await _appLock.VerifyPinAsync(pin);

            if (!isValid)
            {
                await ShowErrorDialog("Incorrect PIN.");
                return false;
            }

            return true;
        }

        return false;
    }

    private async Task<bool> ShowPasswordVerificationDialogAsync()
    {
        var passwordBox = new PasswordBox
        {
            PlaceholderText = "Enter your password"
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = "Enter your password to disable password protection." });
        stackPanel.Children.Add(passwordBox);

        var dialog = new ContentDialog
        {
            Title = "Verify Password",
            Content = stackPanel,
            PrimaryButtonText = "Verify",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();

        if (result == ContentDialogResult.Primary)
        {
            var password = passwordBox.Password;
            var isValid = await _appLock.VerifyPasswordAsync(password);

            if (!isValid)
            {
                await ShowErrorDialog("Incorrect password.");
                return false;
            }

            return true;
        }

        return false;
    }

    private async Task ShowErrorDialog(string message)
    {
        var dialog = new ContentDialog
        {
            Title = "Error",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.XamlRoot
        };

        await dialog.ShowAsync();
    }

    private async Task ShowInfoDialog(string message)
    {
        var dialog = new ContentDialog
        {
            Title = "Information",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.XamlRoot
        };

        await dialog.ShowAsync();
    }
}
