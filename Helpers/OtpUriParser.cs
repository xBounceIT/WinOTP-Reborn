using WinOTP.Models;

namespace WinOTP.Helpers;

public static class OtpUriParser
{
    public static OtpAccount? TryParse(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed))
            return null;

        if (!string.Equals(parsed.Scheme, "otpauth", StringComparison.OrdinalIgnoreCase))
            return null;

        if (!string.Equals(parsed.Host, "totp", StringComparison.OrdinalIgnoreCase))
            return null;

        var label = Uri.UnescapeDataString(parsed.AbsolutePath.TrimStart('/'));
        var queryParams = ParseQuery(parsed.Query);

        if (!queryParams.TryGetValue("secret", out var secret) || string.IsNullOrWhiteSpace(secret))
            return null;

        secret = secret.Trim().ToUpperInvariant();
        if (!IsValidBase32(secret))
            return null;

        var account = new OtpAccount { Secret = secret };

        // Parse label: "Issuer:AccountName" or just "AccountName"
        var colonIndex = label.IndexOf(':');
        if (colonIndex >= 0)
        {
            account.Issuer = label[..colonIndex].Trim();
            account.AccountName = label[(colonIndex + 1)..].Trim();
        }
        else
        {
            account.AccountName = label.Trim();
        }

        // Issuer parameter overrides label issuer
        if (queryParams.TryGetValue("issuer", out var issuer) && !string.IsNullOrWhiteSpace(issuer))
            account.Issuer = issuer.Trim();

        // Algorithm
        if (queryParams.TryGetValue("algorithm", out var algo))
        {
            account.Algorithm = algo.ToUpperInvariant() switch
            {
                "SHA256" => OtpAlgorithm.SHA256,
                "SHA512" => OtpAlgorithm.SHA512,
                _ => OtpAlgorithm.SHA1
            };
        }

        // Digits
        if (queryParams.TryGetValue("digits", out var digitsStr) && int.TryParse(digitsStr, out var digits))
        {
            account.Digits = digits is 6 or 8 ? digits : 6;
        }

        // Period
        if (queryParams.TryGetValue("period", out var periodStr) && int.TryParse(periodStr, out var period))
        {
            account.Period = period > 0 ? period : 30;
        }

        return account;
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query))
            return result;

        var q = query.TrimStart('?');
        foreach (var pair in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eqIndex = pair.IndexOf('=');
            if (eqIndex < 0) continue;
            var key = Uri.UnescapeDataString(pair[..eqIndex]);
            var value = Uri.UnescapeDataString(pair[(eqIndex + 1)..]);
            result[key] = value;
        }
        return result;
    }

    private static bool IsValidBase32(string input)
    {
        var trimmed = input.TrimEnd('=');
        return trimmed.Length > 0 && trimmed.All(c => (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7'));
    }
}
