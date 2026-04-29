using WinOTP.Models;

namespace WinOTP.Helpers;

internal static class WinAuthImportMapper
{
    public static bool TryCreateDraftAccount(string? rawLine, out OtpAccount account, out string failureReason)
    {
        account = new OtpAccount();
        var line = rawLine?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(line))
        {
            failureReason = "Line is empty.";
            return false;
        }

        if (!line.StartsWith("otpauth://", StringComparison.OrdinalIgnoreCase))
        {
            failureReason = "Line is not an otpauth URI.";
            return false;
        }

        // WinAuth encodes spaces as '+' in both the label and query string portions.
        // Normalize to percent-encoding before parsing since '+' is literal per RFC 3986.
        line = line.Replace("+", "%20");

        var parsed = OtpUriParser.TryParse(line);
        if (parsed is null)
        {
            failureReason = "Line is invalid or unsupported.";
            return false;
        }

        if (IsWinAuthIssuerOnlyLine(line, parsed))
        {
            parsed.Issuer = parsed.AccountName;
            parsed.AccountName = string.Empty;
        }

        account = parsed;
        failureReason = string.Empty;
        return true;
    }

    private static bool IsWinAuthIssuerOnlyLine(string line, OtpAccount parsed)
    {
        if (!string.IsNullOrWhiteSpace(parsed.Issuer) ||
            string.IsNullOrWhiteSpace(parsed.AccountName))
        {
            return false;
        }

        if (!Uri.TryCreate(line, UriKind.Absolute, out var uri))
            return false;

        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eqIndex = pair.IndexOf('=');
            if (eqIndex < 0)
                continue;

            var key = Uri.UnescapeDataString(pair[..eqIndex]);
            var value = Uri.UnescapeDataString(pair[(eqIndex + 1)..]);
            if (string.Equals(key, "icon", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(value, "WinAuth", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
