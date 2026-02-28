using Windows.Security.Credentials;
using Windows.Security.Credentials.UI;

namespace WinOTP.Services;

public interface IAppLockService
{
    bool IsPinSet();
    bool IsPasswordSet();
    Task<bool> SetPinAsync(string pin);
    Task<bool> SetPasswordAsync(string password);
    Task<bool> VerifyPinAsync(string pin);
    Task<bool> VerifyPasswordAsync(string password);
    Task<bool> RemovePinAsync();
    Task<bool> RemovePasswordAsync();
    Task<bool> IsWindowsHelloAvailableAsync();
    Task<UserConsentVerificationResult> VerifyWindowsHelloAsync(string message);
}

public class AppLockService : IAppLockService
{
    private const string AppLockResource = "WinOTP_AppLock";
    private const string PinKey = "AppPin";
    private const string PasswordKey = "AppPassword";
    private readonly PasswordVault _vault;

    public AppLockService()
    {
        _vault = new PasswordVault();
    }

    public bool IsPinSet()
    {
        try
        {
            var credentials = _vault.FindAllByResource(AppLockResource);
            return credentials.Any(c => c.UserName == PinKey);
        }
        catch
        {
            return false;
        }
    }

    public bool IsPasswordSet()
    {
        try
        {
            var credentials = _vault.FindAllByResource(AppLockResource);
            return credentials.Any(c => c.UserName == PasswordKey);
        }
        catch
        {
            return false;
        }
    }

    public Task<bool> SetPinAsync(string pin)
    {
        try
        {
            // Remove existing PIN if any
            RemoveCredential(PinKey);

            var credential = new PasswordCredential(AppLockResource, PinKey, pin);
            _vault.Add(credential);
            return Task.FromResult(true);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    public Task<bool> SetPasswordAsync(string password)
    {
        try
        {
            // Remove existing password if any
            RemoveCredential(PasswordKey);

            var credential = new PasswordCredential(AppLockResource, PasswordKey, password);
            _vault.Add(credential);
            return Task.FromResult(true);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    public Task<bool> VerifyPinAsync(string pin)
    {
        try
        {
            var credential = _vault.FindAllByResource(AppLockResource)
                .FirstOrDefault(c => c.UserName == PinKey);

            if (credential == null)
                return Task.FromResult(false);

            credential.RetrievePassword();
            return Task.FromResult(credential.Password == pin);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    public Task<bool> VerifyPasswordAsync(string password)
    {
        try
        {
            var credential = _vault.FindAllByResource(AppLockResource)
                .FirstOrDefault(c => c.UserName == PasswordKey);

            if (credential == null)
                return Task.FromResult(false);

            credential.RetrievePassword();
            return Task.FromResult(credential.Password == password);
        }
        catch
        {
            return Task.FromResult(false);
        }
    }

    public Task<bool> RemovePinAsync()
    {
        return Task.FromResult(RemoveCredential(PinKey));
    }

    public Task<bool> RemovePasswordAsync()
    {
        return Task.FromResult(RemoveCredential(PasswordKey));
    }

    private bool RemoveCredential(string key)
    {
        try
        {
            var credentials = _vault.FindAllByResource(AppLockResource);
            var credential = credentials.FirstOrDefault(c => c.UserName == key);
            if (credential != null)
            {
                _vault.Remove(credential);
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<bool> IsWindowsHelloAvailableAsync()
    {
        try
        {
            var availability = await UserConsentVerifier.CheckAvailabilityAsync();
            return availability == UserConsentVerifierAvailability.Available;
        }
        catch
        {
            return false;
        }
    }

    public async Task<UserConsentVerificationResult> VerifyWindowsHelloAsync(string message)
    {
        try
        {
            return await UserConsentVerifier.RequestVerificationAsync(message);
        }
        catch
        {
            return UserConsentVerificationResult.DeviceNotPresent;
        }
    }
}
