using System.Text.Json;
using Windows.Security.Credentials;
using WinOTP.Models;

namespace WinOTP.Services;

public interface ICredentialManagerService
{
    Task<List<OtpAccount>> LoadAccountsAsync();
    Task SaveAccountAsync(OtpAccount account);
    Task DeleteAccountAsync(string id);
}

public class CredentialManagerService : ICredentialManagerService
{
    private const string AppResource = "WinOTP";
    private readonly PasswordVault _vault;

    public CredentialManagerService()
    {
        _vault = new PasswordVault();
    }

    public Task<List<OtpAccount>> LoadAccountsAsync()
    {
        try
        {
            var accounts = new List<OtpAccount>();
            var credentials = _vault.FindAllByResource(AppResource);

            foreach (var cred in credentials)
            {
                try
                {
                    cred.RetrievePassword();
                    var account = JsonSerializer.Deserialize<OtpAccount>(cred.Password);
                    if (account != null)
                    {
                        accounts.Add(account);
                    }
                }
                catch
                {
                    // Skip invalid entries
                }
            }

            return Task.FromResult(accounts);
        }
        catch
        {
            // No credentials found or vault error
            return Task.FromResult(new List<OtpAccount>());
        }
    }

    public Task SaveAccountAsync(OtpAccount account)
    {
        var json = JsonSerializer.Serialize(account);
        var credential = new PasswordCredential(
            AppResource,
            account.Id,
            json);

        try
        {
            // Remove existing credential if present
            var existing = _vault.FindAllByResource(AppResource)
                .FirstOrDefault(c => c.UserName == account.Id);
            if (existing != null)
            {
                _vault.Remove(existing);
            }
        }
        catch
        {
            // Credential doesn't exist, that's fine
        }

        _vault.Add(credential);
        return Task.CompletedTask;
    }

    public Task DeleteAccountAsync(string id)
    {
        try
        {
            var credentials = _vault.FindAllByResource(AppResource);
            var credential = credentials.FirstOrDefault(c => c.UserName == id);
            if (credential != null)
            {
                _vault.Remove(credential);
            }
        }
        catch
        {
            // Credential doesn't exist
        }

        return Task.CompletedTask;
    }
}
