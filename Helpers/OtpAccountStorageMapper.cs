using System.Text.Json;
using WinOTP.Models;

namespace WinOTP.Helpers;

public static class OtpAccountStorageMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static bool TryParseStoredJson(string? json, string credentialId, out OtpAccount? account, out CredentialIssue? issue)
    {
        account = null;
        issue = null;

        if (string.IsNullOrWhiteSpace(json))
        {
            issue = CreateIssue(CredentialIssueCode.InvalidData, credentialId, "Stored credential payload is empty.");
            return false;
        }

        OtpAccount? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<OtpAccount>(json, JsonOptions);
        }
        catch (JsonException)
        {
            issue = CreateIssue(CredentialIssueCode.InvalidJson, credentialId, "Stored credential payload is not valid JSON.");
            return false;
        }
        catch
        {
            issue = CreateIssue(CredentialIssueCode.UnexpectedError, credentialId, "Unexpected error while parsing credential payload.");
            return false;
        }

        if (parsed is null)
        {
            issue = CreateIssue(CredentialIssueCode.InvalidData, credentialId, "Stored credential payload could not be mapped to an account.");
            return false;
        }

        if (!TrySanitizeForStorage(parsed, credentialId, out var sanitized, out var validationError))
        {
            issue = CreateIssue(CredentialIssueCode.InvalidData, credentialId, validationError);
            return false;
        }

        account = sanitized;
        return true;
    }

    public static bool TrySanitizeForStorage(OtpAccount source, string? fallbackId, out OtpAccount sanitized, out string validationError)
    {
        var id = string.IsNullOrWhiteSpace(source.Id) ? fallbackId : source.Id;
        id = string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString("N") : id.Trim();

        var issuer = source.Issuer?.Trim() ?? string.Empty;
        var accountName = source.AccountName?.Trim() ?? string.Empty;
        var secret = (source.Secret ?? string.Empty).Trim().Replace(" ", string.Empty).ToUpperInvariant();

        if (!IsValidBase32(secret))
        {
            sanitized = new OtpAccount();
            validationError = "Secret is missing or not valid Base32.";
            return false;
        }

        var createdAt = source.CreatedAt;
        if (createdAt == default)
        {
            createdAt = DateTime.UtcNow;
        }
        else if (createdAt.Kind == DateTimeKind.Unspecified)
        {
            createdAt = DateTime.SpecifyKind(createdAt, DateTimeKind.Utc);
        }
        else
        {
            createdAt = createdAt.ToUniversalTime();
        }

        sanitized = new OtpAccount
        {
            Id = id,
            Issuer = issuer,
            AccountName = accountName,
            Secret = secret,
            Algorithm = IsValidAlgorithm(source.Algorithm) ? source.Algorithm : OtpAlgorithm.SHA1,
            Digits = source.Digits is 6 or 8 ? source.Digits : 6,
            Period = source.Period > 0 ? source.Period : 30,
            CreatedAt = createdAt
        };

        validationError = string.Empty;
        return true;
    }

    private static bool IsValidAlgorithm(OtpAlgorithm algorithm)
    {
        return algorithm is OtpAlgorithm.SHA1 or OtpAlgorithm.SHA256 or OtpAlgorithm.SHA512;
    }

    private static bool IsValidBase32(string input)
    {
        var trimmed = input.TrimEnd('=');
        return trimmed.Length > 0 && trimmed.All(c => (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7'));
    }

    private static CredentialIssue CreateIssue(CredentialIssueCode code, string credentialId, string message)
    {
        return new CredentialIssue
        {
            Code = code,
            CredentialId = string.IsNullOrWhiteSpace(credentialId) ? "(unknown)" : credentialId,
            Message = message
        };
    }
}
