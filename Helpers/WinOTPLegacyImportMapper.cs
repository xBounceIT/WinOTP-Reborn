using System.Text.Json;
using WinOTP.Models;

namespace WinOTP.Helpers;

internal sealed class WinOTPLegacyAccount
{
    public string? Issuer { get; set; }
    public string? Name { get; set; }
    public string? Secret { get; set; }
    public string? Created { get; set; }
}

internal static class WinOTPLegacyImportMapper
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static bool TryCreateDraftAccount(
        string entryId,
        WinOTPLegacyAccount? source,
        out OtpAccount account,
        out string failureReason)
    {
        if (source is null)
        {
            account = new OtpAccount();
            failureReason = $"Entry {entryId} is null.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(source.Secret))
        {
            account = new OtpAccount();
            failureReason = $"Entry {entryId} has an empty secret.";
            return false;
        }

        account = new OtpAccount
        {
            Id = Guid.NewGuid().ToString("N"),
            Issuer = source.Issuer ?? string.Empty,
            AccountName = source.Name ?? string.Empty,
            Secret = source.Secret,
            Algorithm = OtpAlgorithm.SHA1,
            Digits = 6,
            Period = 30,
            CreatedAt = DateTime.UtcNow
        };

        if (!string.IsNullOrWhiteSpace(source.Created) &&
            DateTime.TryParse(source.Created, out var createdDate))
        {
            account.CreatedAt = createdDate;
        }

        failureReason = string.Empty;
        return true;
    }
}
