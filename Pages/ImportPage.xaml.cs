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

    public ImportPage()
    {
        this.InitializeComponent();
        _credentialManager = App.Current.CredentialManager;
        _logger = App.Current.Logger;
    }

    private async void ImportFromWinOTPOldButton_Click(object sender, RoutedEventArgs e)
    {
        _logger.Info("Starting import from WinOTP (old) backup file");

        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeFilter.Add(".json");
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;

        var file = await picker.PickSingleFileAsync();
        if (file is null)
        {
            _logger.Info("User cancelled file picker");
            return;
        }

        _logger.Info($"Selected file: {file.Path}");

        string jsonContent;
        try
        {
            jsonContent = await Windows.Storage.FileIO.ReadTextAsync(file);
            _logger.Info($"Read {jsonContent.Length} characters from file");
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to read the selected file", ex);
            await ShowErrorAsync("Failed to read the selected file.");
            return;
        }

        // Parse the WinOTP old format: {"uuid": {"issuer": "...", "name": "...", "secret": "...", "created": "..."}, ...}
        Dictionary<string, WinOTPLegacyAccount?>? oldAccounts;
        try
        {
            oldAccounts = JsonSerializer.Deserialize<Dictionary<string, WinOTPLegacyAccount?>>(
                jsonContent,
                WinOTPLegacyImportMapper.JsonOptions);
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

        int successCount = 0;
        int failCount = 0;
        int skippedCount = 0;
        foreach (var kvp in oldAccounts)
        {
            var uuid = kvp.Key;
            if (!WinOTPLegacyImportMapper.TryCreateDraftAccount(
                uuid,
                kvp.Value,
                out var newAccount,
                out var failureReason))
            {
                _logger.Warn($"Skipping account {uuid}: {failureReason}");
                skippedCount++;
                continue;
            }

            _logger.Info($"Processing account: {newAccount.Issuer} ({newAccount.AccountName})");

            // Validate and save
            if (OtpAccountStorageMapper.TrySanitizeForStorage(newAccount, newAccount.Id, out var sanitized, out var validationError))
            {
                _logger.Info($"Account sanitized successfully: {sanitized.DisplayLabel}");
                var result = await _credentialManager.SaveAccountAsync(sanitized);
                if (result.Success)
                {
                    _logger.Info($"Account saved successfully: {sanitized.DisplayLabel}");
                    successCount++;
                }
                else
                {
                    _logger.Error($"Failed to save account: {sanitized.DisplayLabel} - {result.Message}");
                    failCount++;
                }
            }
            else
            {
                _logger.Error($"Failed to sanitize account: {newAccount.Issuer} ({newAccount.AccountName}) - {validationError}");
                failCount++;
            }
        }

        _logger.Info($"Import completed: {successCount} success, {failCount} failed, {skippedCount} skipped");

        // Show import results
        var message = $"Import completed:\n• {successCount} account(s) imported successfully";
        if (failCount > 0)
        {
            message += $"\n• {failCount} account(s) failed to import";
        }
        if (skippedCount > 0)
        {
            message += $"\n• {skippedCount} account(s) skipped (invalid data)";
        }

        var dialog = new ContentDialog
        {
            Title = "Import Results",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.XamlRoot
        };
        await dialog.ShowAsync();

        // Navigate back to home if at least one account was imported
        if (successCount > 0)
        {
            Frame.Navigate(typeof(HomePage), AddFlowNavigationHelper.CleanupCompletedAddFlowParameter);
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
