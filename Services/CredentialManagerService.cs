using Windows.Security.Credentials;
using WinOTP.Helpers;
using WinOTP.Models;

namespace WinOTP.Services;

public interface ICredentialManagerService
{
    Task<LoadAccountsResult> LoadAccountsAsync();
    Task<VaultOperationResult> SaveAccountAsync(OtpAccount account);
    Task<VaultOperationResult> DeleteAccountAsync(string id);
}

public class CredentialManagerService : ICredentialManagerService
{
    private const string AppResource = "WinOTP";
    private const int HResultElementNotFound = unchecked((int)0x80070490);

    private readonly PasswordVault _vault;
    private readonly IAppLogger _logger;

    public CredentialManagerService(IAppLogger? logger = null)
    {
        _vault = new PasswordVault();
        _logger = logger ?? new AppLogger();
    }

    public Task<LoadAccountsResult> LoadAccountsAsync()
    {
        var accounts = new List<OtpAccount>();
        var issues = new List<CredentialIssue>();

        IReadOnlyList<PasswordCredential> credentials;
        try
        {
            credentials = _vault.FindAllByResource(AppResource);
        }
        catch (Exception ex)
        {
            if (IsNoCredentialEntryException(ex))
            {
                // Missing resource is a normal "first run" condition.
                _logger.Info($"Credential lookup returned no entries: {ex.GetType().Name}");
                return Task.FromResult(new LoadAccountsResult
                {
                    Accounts = accounts,
                    Issues = issues
                });
            }

            var vaultIssue = new CredentialIssue
            {
                Code = CredentialIssueCode.VaultAccessFailed,
                CredentialId = "(vault)",
                Message = "Unable to access Windows Credential Manager while loading accounts."
            };

            issues.Add(vaultIssue);
            _logger.Error("Credential lookup failed due to vault access error.", ex);

            return Task.FromResult(new LoadAccountsResult
            {
                Accounts = accounts,
                Issues = issues
            });
        }

        foreach (var credential in credentials)
        {
            var credentialId = string.IsNullOrWhiteSpace(credential.UserName) ? "(unknown)" : credential.UserName;

            string? payload;
            try
            {
                credential.RetrievePassword();
                payload = credential.Password;
            }
            catch (Exception ex)
            {
                var issue = new CredentialIssue
                {
                    Code = CredentialIssueCode.RetrieveFailed,
                    CredentialId = credentialId,
                    Message = "Failed to retrieve credential payload from Windows Credential Manager."
                };

                issues.Add(issue);
                _logger.Warn($"Credential '{credentialId}' could not be retrieved: {ex.GetType().Name}: {ex.Message}");
                continue;
            }

            if (!OtpAccountStorageMapper.TryParseStoredJson(payload, credentialId, out var account, out var issueFromPayload))
            {
                if (issueFromPayload != null)
                {
                    issues.Add(issueFromPayload);
                    _logger.Warn($"Credential '{credentialId}' was skipped: {issueFromPayload.Code} - {issueFromPayload.Message}");
                }
                continue;
            }

            if (account != null)
            {
                accounts.Add(account);
            }
        }

        return Task.FromResult(new LoadAccountsResult
        {
            Accounts = accounts,
            Issues = issues
        });
    }

    private static bool IsNoCredentialEntryException(Exception ex)
    {
        return ex.HResult == HResultElementNotFound;
    }

    public Task<VaultOperationResult> SaveAccountAsync(OtpAccount account)
    {
        if (!OtpAccountStorageMapper.TrySanitizeForStorage(account, account.Id, out var sanitized, out var validationError))
        {
            return Task.FromResult(VaultOperationResult.Fail(
                VaultOperationErrorCode.ValidationFailed,
                validationError));
        }

        var json = System.Text.Json.JsonSerializer.Serialize(sanitized);
        var credential = new PasswordCredential(
            AppResource,
            sanitized.Id,
            json);

        try
        {
            try
            {
                var existing = _vault.FindAllByResource(AppResource)
                    .FirstOrDefault(c => c.UserName == sanitized.Id);

                if (existing != null)
                {
                    _vault.Remove(existing);
                }
            }
            catch (Exception ex)
            {
                // Missing existing credential is expected for first save.
                _logger.Info($"No existing credential to replace for '{sanitized.Id}': {ex.GetType().Name}");
            }

            _vault.Add(credential);
            return Task.FromResult(VaultOperationResult.Ok());
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to save credential '{sanitized.Id}'.", ex);
            return Task.FromResult(VaultOperationResult.Fail(
                VaultOperationErrorCode.VaultAccessFailed,
                "Failed to save account to Windows Credential Manager."));
        }
    }

    public Task<VaultOperationResult> DeleteAccountAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return Task.FromResult(VaultOperationResult.Fail(
                VaultOperationErrorCode.ValidationFailed,
                "Account id is required for deletion."));
        }

        try
        {
            var credentials = _vault.FindAllByResource(AppResource);
            var credential = credentials.FirstOrDefault(c => c.UserName == id);
            if (credential != null)
            {
                _vault.Remove(credential);
            }

            return Task.FromResult(VaultOperationResult.Ok());
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to delete credential '{id}'.", ex);
            return Task.FromResult(VaultOperationResult.Fail(
                VaultOperationErrorCode.VaultAccessFailed,
                "Failed to delete account from Windows Credential Manager."));
        }
    }
}
