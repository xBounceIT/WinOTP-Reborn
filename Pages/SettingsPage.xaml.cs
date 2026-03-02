using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Security.Credentials.UI;
using Windows.System;
using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class SettingsPage : Page
{
    private const string RepositoryUrl = "https://github.com/xBounceIT/WinOTP-Reborn";
    private readonly IAppSettingsService _appSettings;
    private readonly IAppLockService _appLock;
    private readonly IBackupService _backupService;
    private bool _isInitializingToggle;

    public SettingsPage()
    {
        this.InitializeComponent();
        _appSettings = App.Current.AppSettings;
        _appLock = App.Current.AppLock;
        _backupService = App.Current.BackupService;

        VersionTextBlock.Text = VersionHelper.GetAppVersion();
        RefreshBackupFolderUi();
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
            var viewState = await SettingsProtectionViewStateService.ResolveAsync(_appSettings, _appLock);

            ShowNextCodeToggle.IsOn = _appSettings.ShowNextCodeWhenFiveSecondsRemain;
            PinProtectionToggle.IsOn = viewState.IsPinToggleOn;
            PasswordProtectionToggle.IsOn = viewState.IsPasswordToggleOn;
            WindowsHelloToggle.IsOn = viewState.IsWindowsHelloToggleOn;
            AutomaticBackupToggle.IsOn = _appSettings.IsAutomaticBackupEnabled;

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
            RefreshBackupFolderUi();
        }
        finally
        {
            _isInitializingToggle = false;
        }
    }

    private void UpdateProtectionControlsState()
    {
        var isAnyProtectionEnabled = PinProtectionToggle.IsOn || PasswordProtectionToggle.IsOn || WindowsHelloToggle.IsOn;

        AutoLockComboBox.IsEnabled = isAnyProtectionEnabled;

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

    private async void AutomaticBackupToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (AutomaticBackupToggle.IsOn)
        {
            var password = await ShowBackupPasswordSetupDialogAsync(
                "Enable automatic backup",
                "Choose a backup password. It will be stored in Windows Credential Manager and used for automatic backups.",
                "Enable backup");

            if (password == null)
            {
                await RevertAutomaticBackupToggleAsync(false);
                return;
            }

            var storeResult = await _backupService.SetAutomaticBackupPasswordAsync(password);
            if (!storeResult.Success)
            {
                await RevertAutomaticBackupToggleAsync(false);
                await ShowErrorDialog(storeResult.Message);
                return;
            }

            _appSettings.IsAutomaticBackupEnabled = true;

            var backupResult = await _backupService.CreateAutomaticBackupAsync();
            if (!backupResult.Success)
            {
                await _backupService.ClearAutomaticBackupPasswordAsync();
                _appSettings.IsAutomaticBackupEnabled = false;
                await RevertAutomaticBackupToggleAsync(false);
                await ShowErrorDialog($"Failed to create the initial automatic backup. {backupResult.Message}");
                return;
            }

            RefreshBackupFolderUi();
            await ShowInfoDialog($"Automatic backup is enabled. Backups will be stored in:\n{_backupService.GetEffectiveAutomaticBackupFolderPath()}");
            return;
        }

        var clearResult = await _backupService.ClearAutomaticBackupPasswordAsync();
        if (!clearResult.Success)
        {
            await RevertAutomaticBackupToggleAsync(true);
            await ShowErrorDialog(clearResult.Message);
            return;
        }

        _appSettings.IsAutomaticBackupEnabled = false;
        await ShowInfoDialog("Automatic backup has been disabled. Existing backup files were kept.");
    }

    private async void BrowseBackupFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FolderPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeFilter.Add("*");
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;

        var folder = await picker.PickSingleFolderAsync();
        if (folder is null)
        {
            return;
        }

        var validation = _backupService.ValidateAutomaticBackupFolder(folder.Path);
        if (!validation.Success)
        {
            await ShowErrorDialog(validation.Message);
            return;
        }

        var normalizedPath = NormalizeBackupFolderSetting(validation.ResolvedPath);
        if (string.Equals(_appSettings.CustomBackupFolderPath, normalizedPath, StringComparison.Ordinal))
        {
            return;
        }

        var updated = await ApplyBackupFolderChangeAsync(normalizedPath);
        if (updated)
        {
            await ShowInfoDialog($"Automatic backup folder updated to:\n{_backupService.GetEffectiveAutomaticBackupFolderPath()}");
        }
    }

    private async void ResetBackupFolderButton_Click(object sender, RoutedEventArgs e)
    {
        if (IsUsingDefaultBackupFolder())
        {
            return;
        }

        var updated = await ApplyBackupFolderChangeAsync(string.Empty);
        if (updated)
        {
            await ShowInfoDialog($"Automatic backup folder reset to default:\n{_backupService.GetDefaultBackupFolderPath()}");
        }
    }

    private async void ImportBackupButton_Click(object sender, RoutedEventArgs e)
    {
        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeFilter.Add(".wotpbackup");
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;

        var file = await picker.PickSingleFileAsync();
        if (file is null)
        {
            return;
        }

        var password = await ShowBackupPasswordPromptDialogAsync(
            "Import backup",
            "Enter the password used to protect this backup file.",
            "Import");

        if (password == null)
        {
            return;
        }

        var importResult = await _backupService.ImportBackupAsync(file.Path, password);
        if (!importResult.Success)
        {
            await ShowErrorDialog(importResult.Message);
            return;
        }

        var message = $"Import completed:\n• {importResult.ImportedCount} account(s) imported";
        if (importResult.ReplacedCount > 0)
        {
            message += $"\n• {importResult.ReplacedCount} existing account(s) replaced";
        }
        if (importResult.SkippedCount > 0)
        {
            message += $"\n• {importResult.SkippedCount} account(s) skipped";
        }
        if (importResult.FailedCount > 0)
        {
            message += $"\n• {importResult.FailedCount} account(s) failed to save";
        }

        if (importResult.ImportedCount > 0 && _appSettings.IsAutomaticBackupEnabled)
        {
            var backupResult = await _backupService.CreateAutomaticBackupAsync();
            if (!backupResult.Success)
            {
                message += $"\n\nAutomatic backup failed after import: {backupResult.Message}";
            }
        }

        await ShowInfoDialog(message);
    }

    private async void ExportBackupButton_Click(object sender, RoutedEventArgs e)
    {
        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FileSavePicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeChoices.Add("WinOTP Backup", [".wotpbackup"]);
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;
        picker.SuggestedFileName = $"winotp-backup-{DateTime.UtcNow:yyyyMMddTHHmmssZ}";

        var file = await picker.PickSaveFileAsync();
        if (file is null)
        {
            return;
        }

        string? passwordOverride = null;
        if (!_backupService.HasStoredAutomaticBackupPassword())
        {
            passwordOverride = await ShowBackupPasswordSetupDialogAsync(
                "Export backup",
                "Choose a password for this exported backup file.",
                "Export");

            if (passwordOverride == null)
            {
                return;
            }
        }

        var exportResult = await _backupService.ExportBackupAsync(file.Path, passwordOverride);
        if (!exportResult.Success)
        {
            await ShowErrorDialog(exportResult.Message);
            return;
        }

        await ShowInfoDialog($"Backup exported successfully.\n\nFile: {exportResult.FilePath}\nAccounts: {exportResult.AccountCount}");
    }

    private async void PinProtectionToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (PinProtectionToggle.IsOn)
        {
            var success = await ShowPinSetupDialogAsync();
            if (!success)
            {
                _isInitializingToggle = true;
                PinProtectionToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsPinProtectionEnabled = true;
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
                var verified = await ShowPinVerificationDialogAsync();
                if (!verified)
                {
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
            var success = await ShowPasswordSetupDialogAsync();
            if (!success)
            {
                _isInitializingToggle = true;
                PasswordProtectionToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsPasswordProtectionEnabled = true;
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
                var verified = await ShowPasswordVerificationDialogAsync();
                if (!verified)
                {
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
            var success = await EnableWindowsHelloAsync();
            if (!success)
            {
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = false;
                _isInitializingToggle = false;
            }
            else
            {
                _appSettings.IsWindowsHelloEnabled = true;
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

    private async Task<string?> ShowBackupPasswordSetupDialogAsync(string title, string message, string primaryButtonText)
    {
        var passwordBox = new PasswordBox
        {
            PlaceholderText = "Enter backup password"
        };

        var confirmPasswordBox = new PasswordBox
        {
            PlaceholderText = "Confirm backup password"
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.WrapWholeWords });
        stackPanel.Children.Add(passwordBox);
        stackPanel.Children.Add(confirmPasswordBox);

        var dialog = new ContentDialog
        {
            Title = title,
            Content = stackPanel,
            PrimaryButtonText = primaryButtonText,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return null;
        }

        var password = passwordBox.Password;
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            await ShowErrorDialog("Backup password must be at least 8 characters.");
            return null;
        }

        if (password != confirmPasswordBox.Password)
        {
            await ShowErrorDialog("Backup passwords do not match.");
            return null;
        }

        return password;
    }

    private async Task<string?> ShowBackupPasswordPromptDialogAsync(string title, string message, string primaryButtonText)
    {
        var passwordBox = new PasswordBox
        {
            PlaceholderText = "Enter backup password"
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.WrapWholeWords });
        stackPanel.Children.Add(passwordBox);

        var dialog = new ContentDialog
        {
            Title = title,
            Content = stackPanel,
            PrimaryButtonText = primaryButtonText,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return null;
        }

        var password = passwordBox.Password;
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            await ShowErrorDialog("Backup password must be at least 8 characters.");
            return null;
        }

        return password;
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

    private async Task<bool> ApplyBackupFolderChangeAsync(string customBackupFolderPath)
    {
        var previousFolderPath = _appSettings.CustomBackupFolderPath;
        _appSettings.CustomBackupFolderPath = customBackupFolderPath;
        RefreshBackupFolderUi();

        if (!_appSettings.IsAutomaticBackupEnabled)
        {
            return true;
        }

        var backupResult = await _backupService.CreateAutomaticBackupAsync();
        if (backupResult.Success)
        {
            return true;
        }

        _appSettings.CustomBackupFolderPath = previousFolderPath;
        RefreshBackupFolderUi();
        await ShowErrorDialog($"Failed to use the selected backup folder. {backupResult.Message}");
        return false;
    }

    private void RefreshBackupFolderUi()
    {
        BackupFolderPathTextBlock.Text = $"Backup folder: {_backupService.GetEffectiveAutomaticBackupFolderPath()}";
        ResetBackupFolderButton.IsEnabled = !IsUsingDefaultBackupFolder();
    }

    private bool IsUsingDefaultBackupFolder()
    {
        return ArePathsEqual(
            _backupService.GetEffectiveAutomaticBackupFolderPath(),
            _backupService.GetDefaultBackupFolderPath());
    }

    private string NormalizeBackupFolderSetting(string selectedPath)
    {
        if (ArePathsEqual(selectedPath, _backupService.GetDefaultBackupFolderPath()))
        {
            return string.Empty;
        }

        return selectedPath;
    }

    private static bool ArePathsEqual(string left, string right)
    {
        try
        {
            return string.Equals(
                Path.GetFullPath(left),
                Path.GetFullPath(right),
                StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);
        }
    }

    private async Task RevertAutomaticBackupToggleAsync(bool isOn)
    {
        _isInitializingToggle = true;
        AutomaticBackupToggle.IsOn = isOn;
        _isInitializingToggle = false;
        await Task.CompletedTask;
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
