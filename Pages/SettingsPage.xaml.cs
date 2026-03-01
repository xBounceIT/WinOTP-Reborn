using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Security.Credentials.UI;
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
        Loaded += SettingsPage_Loaded;
    }

    private async void GoToRepositoryButton_Click(object sender, RoutedEventArgs e)
    {
        var uri = new System.Uri(RepositoryUrl);
        await Launcher.LaunchUriAsync(uri);
    }

    private async void SettingsPage_Loaded(object sender, RoutedEventArgs e)
    {
        await LoadSettingsAsync();
    }

    private async Task LoadSettingsAsync()
    {
        _isInitializingToggle = true;
        try
        {
            var resolution = await ResolveProtectionStateAsync();

            ShowNextCodeToggle.IsOn = _appSettings.ShowNextCodeWhenFiveSecondsRemain;
            PinProtectionToggle.IsOn = resolution.IsPinEffective;
            PasswordProtectionToggle.IsOn = resolution.IsPasswordEffective;
            WindowsHelloToggle.IsOn = resolution.IsWindowsHelloEffective;

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
        }
        finally
        {
            _isInitializingToggle = false;
        }
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
            if (_appLock.GetPinStatus() == AppLockCredentialStatus.NotSet)
            {
                _appSettings.IsPinProtectionEnabled = false;
                await ShowInfoDialog("PIN protection is no longer available. Choose a password or Windows Hello now to keep the app protected.");
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
            if (_appLock.GetPasswordStatus() == AppLockCredentialStatus.NotSet)
            {
                _appSettings.IsPasswordProtectionEnabled = false;
                await ShowInfoDialog("Password protection is no longer available. Choose a PIN or Windows Hello now to keep the app protected.");
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
            var outcome = await VerifyWindowsHelloAsync("Verify your identity to disable Windows Hello");
            if (outcome.Status == WindowsHelloVerificationStatus.Verified)
            {
                _appSettings.IsWindowsHelloEnabled = false;
            }
            else if (outcome.Status == WindowsHelloVerificationStatus.Unavailable)
            {
                _appSettings.IsWindowsHelloEnabled = false;
                await ShowInfoDialog("Windows Hello is no longer available. Choose a PIN or password now to keep the app protected.");
            }
            else if (outcome.Status == WindowsHelloVerificationStatus.Error)
            {
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = true;
                _isInitializingToggle = false;
                await ShowErrorDialog("Windows Hello is temporarily unavailable. Please try again.");
            }
            else if (outcome.Result == UserConsentVerificationResult.RetriesExhausted)
            {
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = true;
                _isInitializingToggle = false;
                await ShowErrorDialog("Too many failed attempts. Please try again later.");
            }
            else
            {
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = true;
                _isInitializingToggle = false;
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
        var availability = await _appLock.GetWindowsHelloAvailabilityAsync();
        if (availability == WindowsHelloAvailabilityStatus.Unavailable)
        {
            await ShowErrorDialog("Windows Hello is not available on this device or is not configured. Please set up Windows Hello in Windows Settings first.");
            return false;
        }
        if (availability == WindowsHelloAvailabilityStatus.Error)
        {
            await ShowErrorDialog("Windows Hello is temporarily unavailable. Please try again.");
            return false;
        }

        // Request verification to confirm user identity
        var outcome = await _appLock.VerifyWindowsHelloAsync("Set up Windows Hello protection for WinOTP");

        if (outcome.Status == WindowsHelloVerificationStatus.Verified)
        {
            return true;
        }

        if (outcome.Status == WindowsHelloVerificationStatus.Error)
        {
            await ShowErrorDialog("Windows Hello is temporarily unavailable. Please try again.");
            return false;
        }

        await ShowErrorDialog(GetWindowsHelloVerificationFailureMessage(outcome));
        return false;
    }

    private Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message)
    {
        return _appLock.VerifyWindowsHelloAsync(message);
    }

    private async Task<AppLockResolution> ResolveProtectionStateAsync()
    {
        var resolution = await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
        if (!resolution.HasUnavailableConfiguredProtection)
        {
            return resolution;
        }

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

        return await AppLockResolutionService.ResolveAsync(_appSettings, _appLock);
    }

    private static string GetWindowsHelloVerificationFailureMessage(WindowsHelloVerificationOutcome outcome)
    {
        return outcome.Result switch
        {
            UserConsentVerificationResult.DeviceNotPresent => "Windows Hello is not available on this device.",
            UserConsentVerificationResult.NotConfiguredForUser => "Windows Hello is not set up. Please configure it in Windows Settings.",
            UserConsentVerificationResult.DisabledByPolicy => "Windows Hello has been disabled by policy.",
            UserConsentVerificationResult.RetriesExhausted => "Too many failed attempts. Please try again later.",
            _ => "Windows Hello verification was cancelled or failed."
        };
    }

    private async Task<bool> ShowPinSetupDialogAsync()
    {
        var pinTextBox = new PasswordBox
        {
            PlaceholderText = "Enter PIN (4-6 digits)",
            MaxLength = 6,
            PasswordRevealMode = PasswordRevealMode.Hidden
        };

        var confirmPinTextBox = new PasswordBox
        {
            PlaceholderText = "Confirm PIN",
            MaxLength = 6,
            PasswordRevealMode = PasswordRevealMode.Hidden
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
            var pin = pinTextBox.Password;
            var confirmPin = confirmPinTextBox.Password;

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
        var pinTextBox = new PasswordBox
        {
            PlaceholderText = "Enter your PIN",
            MaxLength = 6,
            PasswordRevealMode = PasswordRevealMode.Hidden
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
            var pin = pinTextBox.Password;
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
