using Windows.Security.Credentials;
using Windows.Security.Credentials.UI;

namespace WinOTP.Services;

public interface IAppLockService
{
    AppLockCredentialStatus GetPinStatus();
    AppLockCredentialStatus GetPasswordStatus();
    Task<bool> SetPinAsync(string pin);
    Task<bool> SetPasswordAsync(string password);
    Task<bool> VerifyPinAsync(string pin);
    Task<bool> VerifyPasswordAsync(string password);
    Task<bool> RemovePinAsync();
    Task<bool> RemovePasswordAsync();
    Task<WindowsHelloAvailabilityStatus> GetWindowsHelloAvailabilityAsync();
    Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message);
}

public class AppLockService : IAppLockService
{
    private const string AppLockResource = "WinOTP_AppLock";
    private const string PinKey = "AppPin";
    private const string PasswordKey = "AppPassword";
    private const int ElementNotFoundHResult = unchecked((int)0x80070490);
    private readonly IPasswordVaultAdapter _vault;
    private readonly IWindowsHelloAdapter _windowsHello;

    public AppLockService()
        : this(new PasswordVaultAdapter(new PasswordVault()), new WindowsHelloAdapter())
    {
    }

    internal AppLockService(IPasswordVaultAdapter vault, IWindowsHelloAdapter windowsHello)
    {
        _vault = vault;
        _windowsHello = windowsHello;
    }

    public AppLockCredentialStatus GetPinStatus()
    {
        return GetCredentialStatus(PinKey);
    }

    public AppLockCredentialStatus GetPasswordStatus()
    {
        return GetCredentialStatus(PasswordKey);
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
        catch (Exception ex) when (ex.HResult == ElementNotFoundHResult)
        {
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<WindowsHelloAvailabilityStatus> GetWindowsHelloAvailabilityAsync()
    {
        try
        {
            var availability = await _windowsHello.CheckAvailabilityAsync();
            return availability switch
            {
                UserConsentVerifierAvailability.Available => WindowsHelloAvailabilityStatus.Available,
                UserConsentVerifierAvailability.DeviceNotPresent
                    or UserConsentVerifierAvailability.NotConfiguredForUser
                    or UserConsentVerifierAvailability.DisabledByPolicy => WindowsHelloAvailabilityStatus.Unavailable,
                _ => WindowsHelloAvailabilityStatus.Error
            };
        }
        catch
        {
            return WindowsHelloAvailabilityStatus.Error;
        }
    }

    public async Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message)
    {
        try
        {
            var result = await _windowsHello.RequestVerificationAsync(message);
            return result switch
            {
                UserConsentVerificationResult.Verified => new WindowsHelloVerificationOutcome(
                    WindowsHelloVerificationStatus.Verified,
                    result),
                UserConsentVerificationResult.DeviceNotPresent
                    or UserConsentVerificationResult.NotConfiguredForUser
                    or UserConsentVerificationResult.DisabledByPolicy => new WindowsHelloVerificationOutcome(
                        WindowsHelloVerificationStatus.Unavailable,
                        result),
                _ => new WindowsHelloVerificationOutcome(WindowsHelloVerificationStatus.Failed, result)
            };
        }
        catch
        {
            return new WindowsHelloVerificationOutcome(WindowsHelloVerificationStatus.Error);
        }
    }

    private AppLockCredentialStatus GetCredentialStatus(string key)
    {
        try
        {
            var credentials = _vault.FindAllByResource(AppLockResource);
            return credentials.Any(c => c.UserName == key)
                ? AppLockCredentialStatus.Set
                : AppLockCredentialStatus.NotSet;
        }
        catch (Exception ex) when (ex.HResult == ElementNotFoundHResult)
        {
            return AppLockCredentialStatus.NotSet;
        }
        catch
        {
            return AppLockCredentialStatus.Error;
        }
    }

    internal interface IPasswordVaultAdapter
    {
        IReadOnlyList<PasswordCredential> FindAllByResource(string resource);
        void Add(PasswordCredential credential);
        void Remove(PasswordCredential credential);
    }

    internal interface IWindowsHelloAdapter
    {
        Task<UserConsentVerifierAvailability> CheckAvailabilityAsync();
        Task<UserConsentVerificationResult> RequestVerificationAsync(string message);
    }

    internal sealed class PasswordVaultAdapter : IPasswordVaultAdapter
    {
        private readonly PasswordVault _vault;

        public PasswordVaultAdapter(PasswordVault vault)
        {
            _vault = vault;
        }

        public IReadOnlyList<PasswordCredential> FindAllByResource(string resource)
        {
            return _vault.FindAllByResource(resource);
        }

        public void Add(PasswordCredential credential)
        {
            _vault.Add(credential);
        }

        public void Remove(PasswordCredential credential)
        {
            _vault.Remove(credential);
        }
    }

    internal sealed class WindowsHelloAdapter : IWindowsHelloAdapter
    {
        public Task<UserConsentVerifierAvailability> CheckAvailabilityAsync()
        {
            return UserConsentVerifier.CheckAvailabilityAsync().AsTask();
        }

        public Task<UserConsentVerificationResult> RequestVerificationAsync(string message)
        {
            return UserConsentVerifier.RequestVerificationAsync(message).AsTask();
        }
    }
}
