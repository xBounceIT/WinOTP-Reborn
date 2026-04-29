using Microsoft.UI.Xaml;

namespace WinOTP.Helpers;

internal static class ImportDialogHelper
{
    public static Task ShowImportSummaryAsync(
        XamlRoot xamlRoot,
        int successCount,
        int failCount,
        int skippedCount,
        string? skippedLabel = null,
        int replacedCount = 0,
        string? additionalMessage = null)
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount,
            failCount,
            skippedCount,
            skippedLabel,
            replacedCount,
            additionalMessage);

        return DialogHelper.ShowOkAsync(xamlRoot, "Import Results", message);
    }

    public static Task ShowAccountAddedAsync(XamlRoot xamlRoot)
        => DialogHelper.ShowOkAsync(xamlRoot, "Account added", "The account was added successfully.");
}
