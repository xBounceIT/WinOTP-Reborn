using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel;
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
    private readonly IAppUpdateService _appUpdate;
    private readonly IAppLockService _appLock;
    private readonly IBackupService _backupService;
    private bool _isInitializingToggle;

    public SettingsPage()
    {
        this.InitializeComponent();
        _appSettings = App.Current.AppSettings;
        _appUpdate = App.Current.AppUpdate;
        _appLock = App.Current.AppLock;
        _backupService = App.Current.BackupService;

        CurrentVersionTextBlock.Text = VersionHelper.GetAppVersion();
        RefreshBackupFolderUi();
        Loaded += SettingsPage_Loaded;
        Unloaded += SettingsPage_Unloaded;
    }

    private async void GoToRepositoryButton_Click(object sender, RoutedEventArgs e)
    {
        var uri = new System.Uri(RepositoryUrl);
        await Launcher.LaunchUriAsync(uri);
    }

    private async void SettingsPage_Loaded(object sender, RoutedEventArgs e)
    {
        _appUpdate.StateChanged += AppUpdate_StateChanged;
        await LoadSettingsAsync();
        ApplyUpdateState(_appUpdate.CurrentState);
    }

    private void SettingsPage_Unloaded(object sender, RoutedEventArgs e)
    {
        _appUpdate.StateChanged -= AppUpdate_StateChanged;
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
            WindowsHelloRemotePinToggle.IsOn = viewState.IsWindowsHelloRemotePinToggleOn;
            WindowsHelloRemotePasswordToggle.IsOn = viewState.IsWindowsHelloRemotePasswordToggleOn;
            AutomaticBackupToggle.IsOn = _appSettings.IsAutomaticBackupEnabled;
            UpdateCheckToggle.IsOn = _appSettings.IsUpdateCheckEnabled;
            UpdateChannelComboBox.SelectedIndex = _appSettings.UpdateChannel == UpdateChannel.PreRelease ? 1 : 0;

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

        WindowsHelloRemoteFallbackPanel.Visibility = WindowsHelloToggle.IsOn
            ? Visibility.Visible
            : Visibility.Collapsed;
        WindowsHelloRemotePinToggle.IsEnabled = WindowsHelloToggle.IsOn &&
            !WindowsHelloRemotePasswordToggle.IsOn;
        WindowsHelloRemotePasswordToggle.IsEnabled = WindowsHelloToggle.IsOn &&
            !WindowsHelloRemotePinToggle.IsOn;
    }

    private void ShowNextCodeToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        _appSettings.ShowNextCodeWhenFiveSecondsRemain = ShowNextCodeToggle.IsOn;
    }

    private async void UpdateCheckToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        _appSettings.IsUpdateCheckEnabled = UpdateCheckToggle.IsOn;
        if (UpdateCheckToggle.IsOn)
        {
            await _appUpdate.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        }
    }

    private async void UpdateChannelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isInitializingToggle || UpdateChannelComboBox.SelectedIndex < 0)
        {
            return;
        }

        var selectedChannel = UpdateChannelComboBox.SelectedIndex == 1
            ? UpdateChannel.PreRelease
            : UpdateChannel.Stable;

        if (_appSettings.UpdateChannel == selectedChannel)
        {
            return;
        }

        _appSettings.UpdateChannel = selectedChannel;
        await _appUpdate.CheckForUpdatesAsync(UpdateCheckTrigger.ChannelChanged);
    }

    private async void CheckNowButton_Click(object sender, RoutedEventArgs e)
    {
        await _appUpdate.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        var state = _appUpdate.CurrentState;
        if (!string.IsNullOrWhiteSpace(state.LastError) && !state.IsUpdateAvailable)
        {
            await ShowErrorDialog(state.LastError);
        }
    }

    private async void DownloadAndInstallButton_Click(object sender, RoutedEventArgs e)
    {
        var downloadResult = await _appUpdate.DownloadInstallerAsync();
        if (!downloadResult.Success)
        {
            await ShowErrorDialog(downloadResult.ErrorMessage ?? "The update installer could not be downloaded.");
            return;
        }

        var confirmed = await ShowUpdateInstallConfirmationDialogAsync(downloadResult);
        if (!confirmed)
        {
            return;
        }

        var launchResult = await _appUpdate.LaunchInstallerAsync(downloadResult);
        if (!launchResult.Success)
        {
            await ShowErrorDialog(launchResult.ErrorMessage ?? "The update installer could not be launched.");
            return;
        }

        App.Current.MainWindow?.Close();
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
                await ClearWindowsHelloRemoteFallbackAsync();
            }
            else if (outcome.Status == WindowsHelloVerificationStatus.RemoteSession)
            {
                _isInitializingToggle = true;
                WindowsHelloToggle.IsOn = true;
                _isInitializingToggle = false;
                await ShowErrorDialog("Windows Hello can't be changed from a Remote Desktop session. Open WinOTP locally on the host device to disable Windows Hello.");
            }
            else if (outcome.Status == WindowsHelloVerificationStatus.Unavailable)
            {
                _appSettings.IsWindowsHelloEnabled = false;
                await ClearWindowsHelloRemoteFallbackAsync();
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

    private async void WindowsHelloRemotePinToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (WindowsHelloRemotePinToggle.IsOn)
        {
            var success = await ShowWindowsHelloRemotePinSetupDialogAsync();
            if (!success)
            {
                SetToggleStateWithoutEvent(WindowsHelloRemotePinToggle, false);
            }
            else
            {
                _appSettings.IsWindowsHelloRemotePinEnabled = true;
                if (WindowsHelloRemotePasswordToggle.IsOn)
                {
                    SetToggleStateWithoutEvent(WindowsHelloRemotePasswordToggle, false);
                    _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
                    await _appLock.RemoveWindowsHelloRemotePasswordAsync();
                }
            }
        }
        else
        {
            if (_appLock.GetWindowsHelloRemotePinStatus() == AppLockCredentialStatus.NotSet)
            {
                _appSettings.IsWindowsHelloRemotePinEnabled = false;
                await ShowInfoDialog("The Remote Desktop PIN is no longer available and was turned off.");
            }
            else
            {
                var verified = await ShowWindowsHelloRemotePinVerificationDialogAsync();
                if (!verified)
                {
                    SetToggleStateWithoutEvent(WindowsHelloRemotePinToggle, true);
                }
                else
                {
                    await _appLock.RemoveWindowsHelloRemotePinAsync();
                    _appSettings.IsWindowsHelloRemotePinEnabled = false;
                }
            }
        }

        UpdateProtectionControlsState();
    }

    private async void WindowsHelloRemotePasswordToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        if (WindowsHelloRemotePasswordToggle.IsOn)
        {
            var success = await ShowWindowsHelloRemotePasswordSetupDialogAsync();
            if (!success)
            {
                SetToggleStateWithoutEvent(WindowsHelloRemotePasswordToggle, false);
            }
            else
            {
                _appSettings.IsWindowsHelloRemotePasswordEnabled = true;
                if (WindowsHelloRemotePinToggle.IsOn)
                {
                    SetToggleStateWithoutEvent(WindowsHelloRemotePinToggle, false);
                    _appSettings.IsWindowsHelloRemotePinEnabled = false;
                    await _appLock.RemoveWindowsHelloRemotePinAsync();
                }
            }
        }
        else
        {
            if (_appLock.GetWindowsHelloRemotePasswordStatus() == AppLockCredentialStatus.NotSet)
            {
                _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
                await ShowInfoDialog("The Remote Desktop password is no longer available and was turned off.");
            }
            else
            {
                var verified = await ShowWindowsHelloRemotePasswordVerificationDialogAsync();
                if (!verified)
                {
                    SetToggleStateWithoutEvent(WindowsHelloRemotePasswordToggle, true);
                }
                else
                {
                    await _appLock.RemoveWindowsHelloRemotePasswordAsync();
                    _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
                }
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
        if (availability == WindowsHelloAvailabilityStatus.RemoteSession)
        {
            await ShowErrorDialog("Windows Hello can't be enabled from a Remote Desktop session. Open WinOTP locally on the host device to enable Windows Hello.");
            return false;
        }
        if (availability == WindowsHelloAvailabilityStatus.Error)
        {
            await ShowErrorDialog("Windows Hello is temporarily unavailable. Please try again.");
            return false;
        }

        var outcome = await VerifyWindowsHelloAsync("Set up Windows Hello protection for WinOTP");

        if (outcome.Status == WindowsHelloVerificationStatus.Verified)
        {
            return true;
        }

        if (outcome.Status == WindowsHelloVerificationStatus.RemoteSession)
        {
            await ShowErrorDialog("Windows Hello can't be enabled from a Remote Desktop session. Open WinOTP locally on the host device to enable Windows Hello.");
            return false;
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
        var window = App.Current.MainWindow
            ?? throw new InvalidOperationException("Main window is not available for Windows Hello verification.");
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
        return _appLock.VerifyWindowsHelloAsync(message, hwnd);
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

    private Task<bool> ShowPinSetupDialogAsync()
    {
        return ShowPinSetupDialogAsync(
            "Set up PIN",
            "Choose a 4-6 digit PIN to protect the app.",
            "Set PIN",
            _appLock.SetPinAsync,
            "Failed to save PIN. Please try again.");
    }

    private Task<bool> ShowWindowsHelloRemotePinSetupDialogAsync()
    {
        return ShowPinSetupDialogAsync(
            "Set up Remote Desktop PIN",
            "Choose a 4-6 digit PIN that WinOTP will require only when Windows Hello is unavailable over Remote Desktop.",
            "Set PIN",
            _appLock.SetWindowsHelloRemotePinAsync,
            "Failed to save the Remote Desktop PIN. Please try again.");
    }

    private async Task<bool> ShowPinSetupDialogAsync(
        string title,
        string message,
        string primaryButtonText,
        Func<string, Task<bool>> saveAsync,
        string saveErrorMessage)
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
        stackPanel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.WrapWholeWords });
        stackPanel.Children.Add(pinTextBox);
        stackPanel.Children.Add(confirmPinTextBox);

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

            var success = await saveAsync(pin);
            if (!success)
            {
                await ShowErrorDialog(saveErrorMessage);
                return false;
            }

            return true;
        }

        return false;
    }

    private Task<bool> ShowPasswordSetupDialogAsync()
    {
        return ShowPasswordSetupDialogAsync(
            "Set up Password",
            "Choose a password to protect the app.",
            "Set Password",
            _appLock.SetPasswordAsync,
            "Failed to save password. Please try again.");
    }

    private Task<bool> ShowWindowsHelloRemotePasswordSetupDialogAsync()
    {
        return ShowPasswordSetupDialogAsync(
            "Set up Remote Desktop Password",
            "Choose a password that WinOTP will require only when Windows Hello is unavailable over Remote Desktop.",
            "Set Password",
            _appLock.SetWindowsHelloRemotePasswordAsync,
            "Failed to save the Remote Desktop password. Please try again.");
    }

    private async Task<bool> ShowPasswordSetupDialogAsync(
        string title,
        string message,
        string primaryButtonText,
        Func<string, Task<bool>> saveAsync,
        string saveErrorMessage)
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

            var success = await saveAsync(password);
            if (!success)
            {
                await ShowErrorDialog(saveErrorMessage);
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

    private Task<bool> ShowPinVerificationDialogAsync()
    {
        return ShowPinVerificationDialogAsync(
            "Verify PIN",
            "Enter your PIN to disable PIN protection.",
            "Enter your PIN",
            "Incorrect PIN.",
            _appLock.VerifyPinAsync);
    }

    private Task<bool> ShowWindowsHelloRemotePinVerificationDialogAsync()
    {
        return ShowPinVerificationDialogAsync(
            "Verify Remote Desktop PIN",
            "Enter your Remote Desktop PIN to disable the Remote Desktop PIN fallback.",
            "Enter your Remote Desktop PIN",
            "Incorrect Remote Desktop PIN.",
            _appLock.VerifyWindowsHelloRemotePinAsync);
    }

    private async Task<bool> ShowPinVerificationDialogAsync(
        string title,
        string message,
        string placeholderText,
        string invalidCredentialMessage,
        Func<string, Task<bool>> verifyAsync)
    {
        var pinTextBox = new PasswordBox
        {
            PlaceholderText = placeholderText,
            MaxLength = 6,
            PasswordRevealMode = PasswordRevealMode.Hidden
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.WrapWholeWords });
        stackPanel.Children.Add(pinTextBox);

        var dialog = new ContentDialog
        {
            Title = title,
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
            var isValid = await verifyAsync(pin);

            if (!isValid)
            {
                await ShowErrorDialog(invalidCredentialMessage);
                return false;
            }

            return true;
        }

        return false;
    }

    private Task<bool> ShowPasswordVerificationDialogAsync()
    {
        return ShowPasswordVerificationDialogAsync(
            "Verify Password",
            "Enter your password to disable password protection.",
            "Enter your password",
            "Incorrect password.",
            _appLock.VerifyPasswordAsync);
    }

    private Task<bool> ShowWindowsHelloRemotePasswordVerificationDialogAsync()
    {
        return ShowPasswordVerificationDialogAsync(
            "Verify Remote Desktop Password",
            "Enter your Remote Desktop password to disable the Remote Desktop password fallback.",
            "Enter your Remote Desktop password",
            "Incorrect Remote Desktop password.",
            _appLock.VerifyWindowsHelloRemotePasswordAsync);
    }

    private async Task<bool> ShowPasswordVerificationDialogAsync(
        string title,
        string message,
        string placeholderText,
        string invalidCredentialMessage,
        Func<string, Task<bool>> verifyAsync)
    {
        var passwordBox = new PasswordBox
        {
            PlaceholderText = placeholderText
        };

        var stackPanel = new StackPanel { Spacing = 12 };
        stackPanel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.WrapWholeWords });
        stackPanel.Children.Add(passwordBox);

        var dialog = new ContentDialog
        {
            Title = title,
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
            var isValid = await verifyAsync(password);

            if (!isValid)
            {
                await ShowErrorDialog(invalidCredentialMessage);
                return false;
            }

            return true;
        }

        return false;
    }

    private async Task ClearWindowsHelloRemoteFallbackAsync()
    {
        SetToggleStateWithoutEvent(WindowsHelloRemotePinToggle, false);
        SetToggleStateWithoutEvent(WindowsHelloRemotePasswordToggle, false);
        _appSettings.IsWindowsHelloRemotePinEnabled = false;
        _appSettings.IsWindowsHelloRemotePasswordEnabled = false;
        await _appLock.RemoveWindowsHelloRemotePinAsync();
        await _appLock.RemoveWindowsHelloRemotePasswordAsync();
    }

    private void SetToggleStateWithoutEvent(ToggleSwitch toggle, bool isOn)
    {
        _isInitializingToggle = true;
        toggle.IsOn = isOn;
        _isInitializingToggle = false;
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

    private void AppUpdate_StateChanged(object? sender, UpdateStateChangedEventArgs e)
    {
        DispatcherQueue.TryEnqueue(() => ApplyUpdateState(e.State));
    }

    private void ApplyUpdateState(UpdateState state)
    {
        UpdateAvailabilityBadge.Visibility = state.IsUpdateAvailable
            ? Visibility.Visible
            : Visibility.Collapsed;

        UpdateProgressRing.IsActive = state.IsBusy;
        UpdateProgressRing.Visibility = state.IsBusy
            ? Visibility.Visible
            : Visibility.Collapsed;

        UpdateStatusTextBlock.Text = state.StatusMessage;
        LatestVersionRow.Visibility = state.AvailableUpdate is null
            ? Visibility.Collapsed
            : Visibility.Visible;
        LatestVersionTextBlock.Text = state.AvailableUpdate?.DisplayVersion ?? string.Empty;

        UpdateErrorTextBlock.Visibility = string.IsNullOrWhiteSpace(state.LastError)
            ? Visibility.Collapsed
            : Visibility.Visible;
        UpdateErrorTextBlock.Text = state.LastError ?? string.Empty;

        UpdateCheckToggle.IsEnabled = !state.IsBusy;
        UpdateChannelComboBox.IsEnabled = !state.IsBusy;
        CheckNowButton.IsEnabled = !state.IsBusy;
        Grid.SetColumnSpan(CheckNowButton, state.IsUpdateAvailable ? 1 : 2);
        DownloadAndInstallButton.Visibility = state.IsUpdateAvailable
            ? Visibility.Visible
            : Visibility.Collapsed;
        DownloadAndInstallButton.IsEnabled = state.IsUpdateAvailable && !state.IsBusy;
    }

    private async Task<bool> ShowUpdateInstallConfirmationDialogAsync(UpdateDownloadResult downloadResult)
    {
        var update = downloadResult.Update
            ?? throw new InvalidOperationException("Update metadata is required before launching the installer.");

        var digestMessage = downloadResult.IsDigestVerified
            ? "Installer SHA-256 digest verified."
            : "GitHub did not provide a SHA-256 digest for this installer.";

        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(new TextBlock
        {
            Text = $"Version {update.DisplayVersion} is ready to install.",
            TextWrapping = TextWrapping.WrapWholeWords
        });
        panel.Children.Add(new TextBlock
        {
            Text = digestMessage,
            TextWrapping = TextWrapping.WrapWholeWords
        });
        panel.Children.Add(new TextBlock
        {
            Text = "The installer will open and WinOTP will close so the upgrade can continue.",
            TextWrapping = TextWrapping.WrapWholeWords
        });

        var dialog = new ContentDialog
        {
            Title = "Install update",
            Content = panel,
            PrimaryButtonText = "Install",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.XamlRoot
        };

        return await dialog.ShowAsync() == ContentDialogResult.Primary;
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
