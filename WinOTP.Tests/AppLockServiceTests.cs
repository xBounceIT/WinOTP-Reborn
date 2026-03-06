using Windows.Security.Credentials;
using Windows.Security.Credentials.UI;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockServiceTests
{
    [Fact]
    public void GetPinStatus_VaultLookupThrows_ReturnsError()
    {
        var service = CreateService(
            vault: new FakePasswordVault
            {
                FindAllException = new InvalidOperationException("Vault unavailable")
            });

        var status = service.GetPinStatus();

        Assert.Equal(AppLockCredentialStatus.Error, status);
    }

    [Fact]
    public void GetPasswordStatus_VaultLookupThrows_ReturnsError()
    {
        var service = CreateService(
            vault: new FakePasswordVault
            {
                FindAllException = new InvalidOperationException("Vault unavailable")
            });

        var status = service.GetPasswordStatus();

        Assert.Equal(AppLockCredentialStatus.Error, status);
    }

    [Fact]
    public void GetWindowsHelloRemotePinStatus_VaultLookupThrows_ReturnsError()
    {
        var service = CreateService(
            vault: new FakePasswordVault
            {
                FindAllException = new InvalidOperationException("Vault unavailable")
            });

        var status = service.GetWindowsHelloRemotePinStatus();

        Assert.Equal(AppLockCredentialStatus.Error, status);
    }

    [Fact]
    public async Task SetWindowsHelloRemotePasswordAsync_StoresDedicatedCredential()
    {
        var vault = new FakePasswordVault();
        var service = CreateService(vault: vault);

        var success = await service.SetWindowsHelloRemotePasswordAsync("rdp-password-1");

        Assert.True(success);
        Assert.Contains("WindowsHelloRemotePassword", vault.AddedUserNames);
    }

    [Fact]
    public async Task VerifyWindowsHelloRemotePinAsync_UsesDedicatedCredential()
    {
        var vault = new FakePasswordVault();
        vault.Credentials.Add(new PasswordCredential("WinOTP_AppLock", "AppPin", "1111"));
        vault.Credentials.Add(new PasswordCredential("WinOTP_AppLock", "WindowsHelloRemotePin", "9876"));
        var service = CreateService(vault: vault);

        var isValid = await service.VerifyWindowsHelloRemotePinAsync("9876");

        Assert.True(isValid);
    }

    [Fact]
    public async Task RemoveWindowsHelloRemotePasswordAsync_RemovesDedicatedCredential()
    {
        var vault = new FakePasswordVault();
        vault.Credentials.Add(new PasswordCredential("WinOTP_AppLock", "WindowsHelloRemotePassword", "rdp-password-1"));
        var service = CreateService(vault: vault);

        var removed = await service.RemoveWindowsHelloRemotePasswordAsync();

        Assert.True(removed);
        Assert.Contains("WindowsHelloRemotePassword", vault.RemovedUserNames);
    }

    [Fact]
    public async Task GetWindowsHelloAvailabilityAsync_WhenVerifierThrows_ReturnsError()
    {
        var service = CreateService(
            windowsHello: new FakeWindowsHello
            {
                CheckAvailabilityException = new InvalidOperationException("Service unavailable")
            });

        var status = await service.GetWindowsHelloAvailabilityAsync();

        Assert.Equal(WindowsHelloAvailabilityStatus.Error, status);
    }

    [Fact]
    public async Task GetWindowsHelloAvailabilityAsync_WhenRemoteSession_ReturnsRemoteSessionWithoutCallingVerifier()
    {
        var windowsHello = new FakeWindowsHello();
        var service = CreateService(
            windowsHello: windowsHello,
            remoteSessionDetector: new FakeRemoteSessionDetector
            {
                IsRemoteSessionResult = true
            });

        var status = await service.GetWindowsHelloAvailabilityAsync();

        Assert.Equal(WindowsHelloAvailabilityStatus.RemoteSession, status);
        Assert.Equal(0, windowsHello.CheckAvailabilityCallCount);
    }

    [Fact]
    public async Task VerifyWindowsHelloAsync_WhenVerifierThrows_ReturnsError()
    {
        var service = CreateService(
            windowsHello: new FakeWindowsHello
            {
                RequestVerificationException = new InvalidOperationException("Service unavailable")
            });

        var outcome = await service.VerifyWindowsHelloAsync("Unlock WinOTP", new IntPtr(42));

        Assert.Equal(WindowsHelloVerificationStatus.Error, outcome.Status);
        Assert.Null(outcome.Result);
    }

    [Theory]
    [InlineData(UserConsentVerificationResult.DeviceNotPresent)]
    [InlineData(UserConsentVerificationResult.NotConfiguredForUser)]
    [InlineData(UserConsentVerificationResult.DisabledByPolicy)]
    public async Task VerifyWindowsHelloAsync_ExplicitUnavailabilityResults_AreUnavailable(UserConsentVerificationResult result)
    {
        var service = CreateService(
            windowsHello: new FakeWindowsHello
            {
                VerificationResult = result
            });

        var outcome = await service.VerifyWindowsHelloAsync("Unlock WinOTP", new IntPtr(42));

        Assert.Equal(WindowsHelloVerificationStatus.Unavailable, outcome.Status);
        Assert.Equal(result, outcome.Result);
    }

    [Fact]
    public async Task VerifyWindowsHelloAsync_WhenRemoteSession_ReturnsRemoteSessionWithoutCallingVerifier()
    {
        var windowsHello = new FakeWindowsHello();
        var service = CreateService(
            windowsHello: windowsHello,
            remoteSessionDetector: new FakeRemoteSessionDetector
            {
                IsRemoteSessionResult = true
            });

        var outcome = await service.VerifyWindowsHelloAsync("Unlock WinOTP", new IntPtr(42));

        Assert.Equal(WindowsHelloVerificationStatus.RemoteSession, outcome.Status);
        Assert.Null(outcome.Result);
        Assert.Equal(0, windowsHello.RequestVerificationCallCount);
    }

    [Fact]
    public async Task VerifyWindowsHelloAsync_ForwardsOwnerWindowHandle()
    {
        var windowsHello = new FakeWindowsHello();
        var service = CreateService(windowsHello: windowsHello);
        var ownerWindowHandle = new IntPtr(1234);

        await service.VerifyWindowsHelloAsync("Unlock WinOTP", ownerWindowHandle);

        Assert.Equal(ownerWindowHandle, windowsHello.LastOwnerWindowHandle);
    }

    private static AppLockService CreateService(
        FakePasswordVault? vault = null,
        FakeWindowsHello? windowsHello = null,
        FakeRemoteSessionDetector? remoteSessionDetector = null)
    {
        return new AppLockService(
            vault ?? new FakePasswordVault(),
            windowsHello ?? new FakeWindowsHello(),
            remoteSessionDetector ?? new FakeRemoteSessionDetector());
    }

    private sealed class FakePasswordVault : AppLockService.IPasswordVaultAdapter
    {
        public Exception? FindAllException { get; init; }
        public List<PasswordCredential> Credentials { get; } = [];
        public List<string> AddedUserNames { get; } = [];
        public List<string> RemovedUserNames { get; } = [];

        public IReadOnlyList<PasswordCredential> FindAllByResource(string resource)
        {
            if (FindAllException != null)
            {
                throw FindAllException;
            }

            return Credentials;
        }

        public void Add(PasswordCredential credential)
        {
            AddedUserNames.Add(credential.UserName);
            Credentials.RemoveAll(existing => existing.UserName == credential.UserName);
            Credentials.Add(credential);
        }

        public void Remove(PasswordCredential credential)
        {
            RemovedUserNames.Add(credential.UserName);
            Credentials.RemoveAll(existing => existing.UserName == credential.UserName);
        }
    }

    private sealed class FakeWindowsHello : AppLockService.IWindowsHelloAdapter
    {
        public UserConsentVerifierAvailability AvailabilityResult { get; init; } = UserConsentVerifierAvailability.Available;
        public UserConsentVerificationResult VerificationResult { get; init; } = UserConsentVerificationResult.Verified;
        public Exception? CheckAvailabilityException { get; init; }
        public Exception? RequestVerificationException { get; init; }
        public IntPtr LastOwnerWindowHandle { get; private set; }
        public int CheckAvailabilityCallCount { get; private set; }
        public int RequestVerificationCallCount { get; private set; }

        public Task<UserConsentVerifierAvailability> CheckAvailabilityAsync()
        {
            CheckAvailabilityCallCount++;

            if (CheckAvailabilityException != null)
            {
                throw CheckAvailabilityException;
            }

            return Task.FromResult(AvailabilityResult);
        }

        public Task<UserConsentVerificationResult> RequestVerificationAsync(string message, IntPtr ownerWindowHandle)
        {
            RequestVerificationCallCount++;

            if (RequestVerificationException != null)
            {
                throw RequestVerificationException;
            }

            LastOwnerWindowHandle = ownerWindowHandle;
            return Task.FromResult(VerificationResult);
        }
    }

    private sealed class FakeRemoteSessionDetector : AppLockService.IRemoteSessionDetector
    {
        public bool IsRemoteSessionResult { get; init; }

        public bool IsRemoteSession()
        {
            return IsRemoteSessionResult;
        }
    }
}
