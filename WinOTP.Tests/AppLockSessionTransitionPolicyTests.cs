using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockSessionTransitionPolicyTests
{
    [Fact]
    public void ShouldRefreshBeforeCredentialVerification_RemotePinWithMatchingResolution_ReturnsFalse()
    {
        var shouldRefresh = AppLockSessionTransitionPolicy.ShouldRefreshBeforeCredentialVerification(
            AppLockMode.WindowsHelloRemotePin,
            CreateResolution(AppLockMode.WindowsHelloRemotePin, hasWindowsHelloRemoteSession: true));

        Assert.False(shouldRefresh);
    }

    [Fact]
    public void ShouldRefreshBeforeCredentialVerification_RemoteFallbackWithLocalWindowsHello_ReturnsTrue()
    {
        var shouldRefresh = AppLockSessionTransitionPolicy.ShouldRefreshBeforeCredentialVerification(
            AppLockMode.WindowsHelloRemotePassword,
            CreateResolution(AppLockMode.WindowsHello, hasWindowsHelloRemoteSession: false));

        Assert.True(shouldRefresh);
    }

    [Fact]
    public void ShouldRefreshBeforeCredentialVerification_RemoteFallbackWithLocalPassword_ReturnsTrue()
    {
        var shouldRefresh = AppLockSessionTransitionPolicy.ShouldRefreshBeforeCredentialVerification(
            AppLockMode.WindowsHelloRemotePin,
            CreateResolution(AppLockMode.Password, hasWindowsHelloRemoteSession: false));

        Assert.True(shouldRefresh);
    }

    [Fact]
    public void ShouldReapplyProtectionOnActivation_RemoteSessionEndedAndProtectionResolved_ReturnsTrue()
    {
        var shouldReapply = AppLockSessionTransitionPolicy.ShouldReapplyProtectionOnActivation(
            hadRemoteSessionContext: true,
            CreateResolution(AppLockMode.WindowsHello, hasWindowsHelloRemoteSession: false));

        Assert.True(shouldReapply);
    }

    [Fact]
    public void ShouldReapplyProtectionOnActivation_RemoteSessionStillActive_ReturnsFalse()
    {
        var shouldReapply = AppLockSessionTransitionPolicy.ShouldReapplyProtectionOnActivation(
            hadRemoteSessionContext: true,
            CreateResolution(AppLockMode.WindowsHelloRemotePassword, hasWindowsHelloRemoteSession: true));

        Assert.False(shouldReapply);
    }

    [Fact]
    public void ShouldReapplyProtectionOnActivation_NoPreviousRemoteSession_ReturnsFalse()
    {
        var shouldReapply = AppLockSessionTransitionPolicy.ShouldReapplyProtectionOnActivation(
            hadRemoteSessionContext: false,
            CreateResolution(AppLockMode.WindowsHello, hasWindowsHelloRemoteSession: false));

        Assert.False(shouldReapply);
    }

    private static AppLockResolution CreateResolution(
        AppLockMode mode,
        bool hasWindowsHelloRemoteSession)
    {
        return new AppLockResolution(
            mode,
            IsPinEffective: mode == AppLockMode.Pin,
            IsPasswordEffective: mode == AppLockMode.Password,
            IsWindowsHelloEffective: mode == AppLockMode.WindowsHello,
            IsWindowsHelloRemotePinEffective: mode == AppLockMode.WindowsHelloRemotePin,
            IsWindowsHelloRemotePasswordEffective: mode == AppLockMode.WindowsHelloRemotePassword,
            HasPinError: false,
            HasPasswordError: false,
            HasWindowsHelloError: false,
            HasWindowsHelloRemotePinError: false,
            HasWindowsHelloRemotePasswordError: false,
            HasWindowsHelloRemoteSession: hasWindowsHelloRemoteSession,
            DisableUnavailablePin: false,
            DisableUnavailablePassword: false,
            DisableUnavailableWindowsHello: false,
            DisableUnavailableWindowsHelloRemotePin: false,
            DisableUnavailableWindowsHelloRemotePassword: false);
    }
}
