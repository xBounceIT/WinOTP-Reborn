namespace WinOTP.Helpers;

internal static class ImportSummaryMessageBuilder
{
    public static string Build(
        int successCount,
        int failCount,
        int skippedCount,
        string? skippedLabel = null,
        int replacedCount = 0,
        string? additionalMessage = null)
    {
        var message = $"Import completed:\n• {successCount} account(s) imported successfully";

        if (replacedCount > 0)
            message += $"\n• {replacedCount} existing account(s) replaced";

        if (failCount > 0)
            message += $"\n• {failCount} account(s) failed to import";

        if (skippedCount > 0)
        {
            var label = string.IsNullOrEmpty(skippedLabel) ? string.Empty : $" ({skippedLabel})";
            message += $"\n• {skippedCount} account(s) skipped{label}";
        }

        if (!string.IsNullOrEmpty(additionalMessage))
            message += $"\n\n{additionalMessage}";

        return message;
    }
}
