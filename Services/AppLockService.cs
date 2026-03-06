using System.Runtime.InteropServices;
using Windows.Security.Credentials;
using Windows.Security.Credentials.UI;

namespace WinOTP.Services;

public interface IAppLockService
{
    AppLockCredentialStatus GetPinStatus();
    AppLockCredentialStatus GetPasswordStatus();
    AppLockCredentialStatus GetWindowsHelloRemotePinStatus();
    AppLockCredentialStatus GetWindowsHelloRemotePasswordStatus();
    Task<bool> SetPinAsync(string pin);
    Task<bool> SetPasswordAsync(string password);
    Task<bool> SetWindowsHelloRemotePinAsync(string pin);
    Task<bool> SetWindowsHelloRemotePasswordAsync(string password);
    Task<bool> VerifyPinAsync(string pin);
    Task<bool> VerifyPasswordAsync(string password);
    Task<bool> VerifyWindowsHelloRemotePinAsync(string pin);
    Task<bool> VerifyWindowsHelloRemotePasswordAsync(string password);
    Task<bool> RemovePinAsync();
    Task<bool> RemovePasswordAsync();
    Task<bool> RemoveWindowsHelloRemotePinAsync();
    Task<bool> RemoveWindowsHelloRemotePasswordAsync();
    Task<WindowsHelloAvailabilityStatus> GetWindowsHelloAvailabilityAsync();
    Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message, IntPtr ownerWindowHandle);
}

public class AppLockService : IAppLockService
{
    private const string AppLockResource = "WinOTP_AppLock";
    private const string PinKey = "AppPin";
    private const string PasswordKey = "AppPassword";
    private const string WindowsHelloRemotePinKey = "WindowsHelloRemotePin";
    private const string WindowsHelloRemotePasswordKey = "WindowsHelloRemotePassword";
    private const int ElementNotFoundHResult = unchecked((int)0x80070490);
    private readonly IPasswordVaultAdapter _vault;
    private readonly IWindowsHelloAdapter _windowsHello;
    private readonly IRemoteSessionDetector _remoteSessionDetector;

    public AppLockService()
        : this(new PasswordVaultAdapter(new PasswordVault()), new WindowsHelloAdapter(), new RemoteSessionDetector())
    {
    }

    internal AppLockService(
        IPasswordVaultAdapter vault,
        IWindowsHelloAdapter windowsHello,
        IRemoteSessionDetector remoteSessionDetector)
    {
        _vault = vault;
        _windowsHello = windowsHello;
        _remoteSessionDetector = remoteSessionDetector;
    }

    public AppLockCredentialStatus GetPinStatus()
    {
        return GetCredentialStatus(PinKey);
    }

    public AppLockCredentialStatus GetPasswordStatus()
    {
        return GetCredentialStatus(PasswordKey);
    }

    public AppLockCredentialStatus GetWindowsHelloRemotePinStatus()
    {
        return GetCredentialStatus(WindowsHelloRemotePinKey);
    }

    public AppLockCredentialStatus GetWindowsHelloRemotePasswordStatus()
    {
        return GetCredentialStatus(WindowsHelloRemotePasswordKey);
    }

    public Task<bool> SetPinAsync(string pin)
    {
        return Task.FromResult(SetCredential(PinKey, pin));
    }

    public Task<bool> SetPasswordAsync(string password)
    {
        return Task.FromResult(SetCredential(PasswordKey, password));
    }

    public Task<bool> SetWindowsHelloRemotePinAsync(string pin)
    {
        return Task.FromResult(SetCredential(WindowsHelloRemotePinKey, pin));
    }

    public Task<bool> SetWindowsHelloRemotePasswordAsync(string password)
    {
        return Task.FromResult(SetCredential(WindowsHelloRemotePasswordKey, password));
    }

    public Task<bool> VerifyPinAsync(string pin)
    {
        return Task.FromResult(VerifyCredential(PinKey, pin));
    }

    public Task<bool> VerifyPasswordAsync(string password)
    {
        return Task.FromResult(VerifyCredential(PasswordKey, password));
    }

    public Task<bool> VerifyWindowsHelloRemotePinAsync(string pin)
    {
        return Task.FromResult(VerifyCredential(WindowsHelloRemotePinKey, pin));
    }

    public Task<bool> VerifyWindowsHelloRemotePasswordAsync(string password)
    {
        return Task.FromResult(VerifyCredential(WindowsHelloRemotePasswordKey, password));
    }

    public Task<bool> RemovePinAsync()
    {
        return Task.FromResult(RemoveCredential(PinKey));
    }

    public Task<bool> RemovePasswordAsync()
    {
        return Task.FromResult(RemoveCredential(PasswordKey));
    }

    public Task<bool> RemoveWindowsHelloRemotePinAsync()
    {
        return Task.FromResult(RemoveCredential(WindowsHelloRemotePinKey));
    }

    public Task<bool> RemoveWindowsHelloRemotePasswordAsync()
    {
        return Task.FromResult(RemoveCredential(WindowsHelloRemotePasswordKey));
    }

    private bool SetCredential(string key, string secret)
    {
        try
        {
            RemoveCredential(key);

            var credential = new PasswordCredential(AppLockResource, key, secret);
            _vault.Add(credential);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private bool VerifyCredential(string key, string secret)
    {
        try
        {
            var credential = _vault.FindAllByResource(AppLockResource)
                .FirstOrDefault(c => c.UserName == key);

            if (credential == null)
            {
                return false;
            }

            credential.RetrievePassword();
            return credential.Password == secret;
        }
        catch
        {
            return false;
        }
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
            if (_remoteSessionDetector.IsRemoteSession())
            {
                return WindowsHelloAvailabilityStatus.RemoteSession;
            }

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

    public async Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message, IntPtr ownerWindowHandle)
    {
        try
        {
            if (_remoteSessionDetector.IsRemoteSession())
            {
                return new WindowsHelloVerificationOutcome(WindowsHelloVerificationStatus.RemoteSession);
            }

            var result = await _windowsHello.RequestVerificationAsync(message, ownerWindowHandle);
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
        Task<UserConsentVerificationResult> RequestVerificationAsync(string message, IntPtr ownerWindowHandle);
    }

    internal interface IRemoteSessionDetector
    {
        bool IsRemoteSession();
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

        public Task<UserConsentVerificationResult> RequestVerificationAsync(string message, IntPtr ownerWindowHandle)
        {
            if (ownerWindowHandle != IntPtr.Zero && OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
            {
                return UserConsentVerifierInterop.RequestVerificationForWindowAsync(ownerWindowHandle, message).AsTask();
            }

            return UserConsentVerifier.RequestVerificationAsync(message).AsTask();
        }
    }

    internal sealed class RemoteSessionDetector : IRemoteSessionDetector
    {
        private const int SmRemoteSession = 0x1000;

        public bool IsRemoteSession()
        {
            return GetSystemMetrics(SmRemoteSession) != 0;
        }

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);
    }
}
