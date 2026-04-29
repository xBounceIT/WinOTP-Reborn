using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using WinOTP.Helpers;
using WinOTP.Models;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class ImportPage : Page
{
    private readonly ICredentialManagerService _credentialManager;
    private readonly IAppLogger _logger;
    private readonly IAppSettingsService _appSettings;
    private readonly IBackupService _backupService;

    public ImportPage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _logger = App.Current.Logger;
        _appSettings = App.Current.AppSettings;
        _backupService = App.Current.BackupService;
    }

    private async void ImportFromWinOTPOldButton_Click(object sender, RoutedEventArgs e)
    {
        _logger.Info("Starting import from WinOTP (old) backup file");

        var file = await PickFileAsync(".json");
        if (file is null) return;

        var jsonContent = await ReadFileContentAsync(file);
        if (jsonContent is null) return;

        Dictionary<string, WinOTPLegacyAccount?>? oldAccounts;
        try
        {
            oldAccounts = JsonSerializer.Deserialize<Dictionary<string, WinOTPLegacyAccount?>>(
                jsonContent, WinOTPLegacyImportMapper.JsonOptions);
            _logger.Info($"Parsed {oldAccounts?.Count ?? 0} accounts from JSON");
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to parse WinOTP backup JSON", ex);
            await ShowErrorAsync("The file is not a valid WinOTP backup JSON file.");
            return;
        }

        if (oldAccounts is null || oldAccounts.Count == 0)
        {
            _logger.Warn("No accounts found in the backup file");
            await ShowErrorAsync("No accounts found in the backup file.");
            return;
        }

        var accounts = new List<OtpAccount>();
        int skippedCount = 0;
        foreach (var kvp in oldAccounts)
        {
            if (WinOTPLegacyImportMapper.TryCreateDraftAccount(kvp.Key, kvp.Value, out var newAccount, out var failureReason))
            {
                accounts.Add(newAccount);
            }
            else
            {
                _logger.Warn($"Skipping account {kvp.Key}: {failureReason}");
                skippedCount++;
            }
        }

        await ExecuteImportAsync(accounts, skippedCount, "invalid data");
    }

    private async void ImportFromWinAuthButton_Click(object sender, RoutedEventArgs e)
    {
        _logger.Info("Starting import from WinAuth export file");

        var file = await PickFileAsync(".txt");
        if (file is null) return;

        var fileContent = await ReadFileContentAsync(file);
        if (fileContent is null) return;

        var lines = fileContent.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0)
        {
            _logger.Warn("File is empty or contains no valid lines");
            await ShowErrorAsync("The selected file is empty.");
            return;
        }

        var accounts = new List<OtpAccount>();
        int skippedCount = 0;
        foreach (var rawLine in lines)
        {
            if (WinAuthImportMapper.TryCreateDraftAccount(rawLine, out var account, out var failureReason))
            {
                accounts.Add(account);
                continue;
            }

            _logger.Warn($"Skipping WinAuth line: {failureReason}");
            skippedCount++;
        }

        await ExecuteImportAsync(accounts, skippedCount, "invalid or unsupported");
    }

    private async Task ExecuteImportAsync(List<OtpAccount> accounts, int skippedCount, string skippedLabel)
    {
        int successCount = 0;
        int failCount = 0;

        foreach (var account in accounts)
        {
            _logger.Info($"Processing account: {account.Issuer} ({account.AccountName})");
            var result = await _credentialManager.SaveAccountAsync(account);
            if (result.Success)
            {
                successCount++;
            }
            else
            {
                _logger.Error($"Failed to import account: {account.Issuer} ({account.AccountName}) - {result.Message}");
                failCount++;
            }
        }

        _logger.Info($"Import completed: {successCount} success, {failCount} failed, {skippedCount} skipped");

        var message = $"Import completed:\n• {successCount} account(s) imported successfully";
        if (failCount > 0)
            message += $"\n• {failCount} account(s) failed to import";
        if (skippedCount > 0)
            message += $"\n• {skippedCount} account(s) skipped ({skippedLabel})";

        if (successCount > 0 && _appSettings.IsAutomaticBackupEnabled)
        {
            var backupResult = await _backupService.CreateAutomaticBackupAsync();
            if (!backupResult.Success)
            {
                _logger.Warn($"Automatic backup failed after import: {backupResult.ErrorCode} - {backupResult.Message}");
                message += $"\n\nAutomatic backup failed: {backupResult.Message}";
            }
        }

        var dialog = new ContentDialog
        {
            Title = "Import Results",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.XamlRoot
        };
        await dialog.ShowAsync();

        if (successCount > 0)
            Frame.Navigate(typeof(HomePage), AddFlowNavigationHelper.CleanupCompletedAddFlowParameter);
    }

    private async Task<Windows.Storage.StorageFile?> PickFileAsync(string fileExtension)
    {
        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeFilter.Add(fileExtension);
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;

        var file = await picker.PickSingleFileAsync();
        if (file is null)
        {
            _logger.Info("User cancelled file picker");
            return null;
        }

        _logger.Info($"Selected file: {file.Path}");
        return file;
    }

    private async Task<string?> ReadFileContentAsync(Windows.Storage.StorageFile file)
    {
        try
        {
            var content = await Windows.Storage.FileIO.ReadTextAsync(file);
            _logger.Info($"Read {content.Length} characters from file");
            return content;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to read the selected file", ex);
            await ShowErrorAsync("Failed to read the selected file.");
            return null;
        }
    }

    private async Task ShowErrorAsync(string message)
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
}
