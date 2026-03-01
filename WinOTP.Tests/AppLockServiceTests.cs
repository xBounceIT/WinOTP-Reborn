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
    public async Task VerifyWindowsHelloAsync_WhenVerifierThrows_ReturnsError()
    {
        var service = CreateService(
            windowsHello: new FakeWindowsHello
            {
                RequestVerificationException = new InvalidOperationException("Service unavailable")
            });

        var outcome = await service.VerifyWindowsHelloAsync("Unlock WinOTP");

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

        var outcome = await service.VerifyWindowsHelloAsync("Unlock WinOTP");

        Assert.Equal(WindowsHelloVerificationStatus.Unavailable, outcome.Status);
        Assert.Equal(result, outcome.Result);
    }

    private static AppLockService CreateService(
        FakePasswordVault? vault = null,
        FakeWindowsHello? windowsHello = null)
    {
        return new AppLockService(vault ?? new FakePasswordVault(), windowsHello ?? new FakeWindowsHello());
    }

    private sealed class FakePasswordVault : AppLockService.IPasswordVaultAdapter
    {
        public Exception? FindAllException { get; init; }
        public IReadOnlyList<PasswordCredential> Credentials { get; init; } = [];

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
        }

        public void Remove(PasswordCredential credential)
        {
        }
    }

    private sealed class FakeWindowsHello : AppLockService.IWindowsHelloAdapter
    {
        public UserConsentVerifierAvailability AvailabilityResult { get; init; } = UserConsentVerifierAvailability.Available;
        public UserConsentVerificationResult VerificationResult { get; init; } = UserConsentVerificationResult.Verified;
        public Exception? CheckAvailabilityException { get; init; }
        public Exception? RequestVerificationException { get; init; }

        public Task<UserConsentVerifierAvailability> CheckAvailabilityAsync()
        {
            if (CheckAvailabilityException != null)
            {
                throw CheckAvailabilityException;
            }

            return Task.FromResult(AvailabilityResult);
        }

        public Task<UserConsentVerificationResult> RequestVerificationAsync(string message)
        {
            if (RequestVerificationException != null)
            {
                throw RequestVerificationException;
            }

            return Task.FromResult(VerificationResult);
        }
    }
}
