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

        // Load auto-lock timeout setting
        var timeout = _appSettings.AutoLockTimeoutMinutes;
        for (int i = 0; i < AutoLockComboBox.Items.Count; i++)
        {
            var item = AutoLockComboBox.Items[i] as ComboBoxItem;
            if (item != null && int.TryParse(item.Tag?.ToString(), out var tagValue) && tagValue == timeout)
            {
                AutoLockComboBox.SelectedIndex = i;
                break;
            }
        }

        UpdateProtectionControlsState();
        _isInitializingToggle = false;
    }

    private void UpdateProtectionControlsState()
    {
        var isAnyProtectionEnabled = PinProtectionToggle.IsOn || PasswordProtectionToggle.IsOn || WindowsHelloToggle.IsOn;
        
        // Enable auto-lock dropdown only when protection is enabled
        AutoLockComboBox.IsEnabled = isAnyProtectionEnabled;
        
        // Disable other protection toggles when one is enabled
        if (PinProtectionToggle.IsOn)
        {
            PasswordProtectionToggle.IsEnabled = false;
            WindowsHelloToggle.IsEnabled = false;
        }
        else if (PasswordProtectionToggle.IsOn)
        {
            PinProtectionToggle.IsEnabled = false;
            WindowsHelloToggle.IsEnabled = false;
        }
        else if (WindowsHelloToggle.IsOn)
        {
            PinProtectionToggle.IsEnabled = false;
            PasswordProtectionToggle.IsEnabled = false;
        }
        else
        {
            // No protection enabled, enable all toggles
            PinProtectionToggle.IsEnabled = true;
            PasswordProtectionToggle.IsEnabled = true;
            WindowsHelloToggle.IsEnabled = true;
        }
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
        
        UpdateProtectionControlsState();
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
        
        UpdateProtectionControlsState();
    }

    private async void WindowsHelloToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (WindowsHelloToggle.IsOn)
        {
            // User wants to enable Windows Hello - check availability and verify
            var success = await EnableWindowsHelloAsync();
            if (!success)
            {
                // User cancelled, verification failed, or not available - revert toggle
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsWindowsHelloEnabled = true;
                // Disable other protection methods
                if (PinProtectionToggle.IsOn)
                {
                    _isInitializingToggle = true;
                    PinProtectionToggle.IsOn = false;
                    _isInitializingToggle = false;
                    _appSettings.IsPinProtectionEnabled = false;
                    await _appLock.RemovePinAsync();
                }
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
            // User wants to disable Windows Hello - verify first
            var verified = await VerifyWindowsHelloAsync("Verify your identity to disable Windows Hello");
            if (!verified)
            {
                // Verification failed - revert toggle
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = true;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsWindowsHelloEnabled = false;
            }
        }
        
        UpdateProtectionControlsState();
    }

    private void AutoLockComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        var selectedItem = AutoLockComboBox.SelectedItem as ComboBoxItem;
        if (selectedItem != null && selectedItem.Tag != null)
        {
            if (int.TryParse(selectedItem.Tag.ToString(), out var minutes))
            {
                _appSettings.AutoLockTimeoutMinutes = minutes;
            }
        }
    }

    private async Task<bool> EnableWindowsHelloAsync()
    {
        // Check if Windows Hello is available
        var isAvailable = await _appLock.IsWindowsHelloAvailableAsync();
        if (!isAvailable)
        {
            await ShowErrorDialog("Windows Hello is not available on this device or is not configured. Please set up Windows Hello in Windows Settings first.");
            return false;
        }

        // Request verification to confirm user identity
        var result = await _appLock.VerifyWindowsHelloAsync("Set up Windows Hello protection for WinOTP");

        if (result == Windows.Security.Credentials.UI.UserConsentVerificationResult.Verified)
        {
            return true;
        }

        // Handle specific error cases
        string errorMessage = result switch
        {
            Windows.Security.Credentials.UI.UserConsentVerificationResult.DeviceNotPresent => "Windows Hello is not available on this device.",
            Windows.Security.Credentials.UI.UserConsentVerificationResult.NotConfiguredForUser => "Windows Hello is not set up. Please configure it in Windows Settings.",
            Windows.Security.Credentials.UI.UserConsentVerificationResult.DisabledByPolicy => "Windows Hello has been disabled by policy.",
            Windows.Security.Credentials.UI.UserConsentVerificationResult.RetriesExhausted => "Too many failed attempts. Please try again later.",
            _ => "Windows Hello verification was cancelled or failed."
        };

        await ShowErrorDialog(errorMessage);
        return false;
    }

    private async Task<bool> VerifyWindowsHelloAsync(string message)
    {
        var result = await _appLock.VerifyWindowsHelloAsync(message);
        return result == Windows.Security.Credentials.UI.UserConsentVerificationResult.Verified;
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
