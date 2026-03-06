using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockSessionTransitionPolicyTests
{
    [Fact]
    public void ShouldResolveOnReconciliation_WindowsHelloEnabled_ReturnsTrue()
    {
        var shouldResolve = AppLockSessionTransitionPolicy.ShouldResolveOnReconciliation(
            isWindowsHelloEnabled: true,
            CreatePresentationState(AppLockMode.None));

        Assert.True(shouldResolve);
    }

    [Fact]
    public void ShouldResolveOnReconciliation_PreviouslyRemote_ReturnsTrue()
    {
        var shouldResolve = AppLockSessionTransitionPolicy.ShouldResolveOnReconciliation(
            isWindowsHelloEnabled: false,
            CreatePresentationState(
                AppLockMode.WindowsHelloRemotePassword));

        Assert.True(shouldResolve);
    }

    [Fact]
    public void ShouldResolveOnReconciliation_PreviousRemoteTemporaryBypass_ReturnsTrue()
    {
        var shouldResolve = AppLockSessionTransitionPolicy.ShouldResolveOnReconciliation(
            isWindowsHelloEnabled: false,
            CreatePresentationState(
                AppLockMode.None,
                temporaryBypassReason: AppLockTemporaryBypassReason.RemoteSession));

        Assert.True(shouldResolve);
    }

    [Fact]
    public void ShouldResolveOnReconciliation_NoWindowsHelloAndNoPreviousRemote_ReturnsFalse()
    {
        var shouldResolve = AppLockSessionTransitionPolicy.ShouldResolveOnReconciliation(
            isWindowsHelloEnabled: false,
            CreatePresentationState(AppLockMode.None));

        Assert.False(shouldResolve);
    }

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
    public void ShouldPresentResolvedProtectionState_LocalToRemoteFallback_ReturnsTrue()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.WindowsHello),
            CreatePresentationState(AppLockMode.WindowsHelloRemotePassword));

        Assert.True(shouldPresent);
    }

    [Fact]
    public void ShouldPresentResolvedProtectionState_LocalToRemoteTemporaryBypass_ReturnsTrue()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.WindowsHello),
            CreatePresentationState(
                AppLockMode.None,
                temporaryBypassReason: AppLockTemporaryBypassReason.RemoteSession));

        Assert.True(shouldPresent);
    }

    [Fact]
    public void ShouldPresentResolvedProtectionState_ServiceErrorBypassWithoutSessionChange_ReturnsTrue()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.WindowsHello),
            CreatePresentationState(
                AppLockMode.None,
                temporaryBypassReason: AppLockTemporaryBypassReason.ServiceError));

        Assert.True(shouldPresent);
    }

    [Fact]
    public void ShouldPresentResolvedProtectionState_RemoteToLocal_ReturnsTrue()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.WindowsHelloRemotePin),
            CreatePresentationState(AppLockMode.WindowsHello));

        Assert.True(shouldPresent);
    }

    [Fact]
    public void ShouldPresentResolvedProtectionState_PresentationUnchanged_ReturnsFalse()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.WindowsHelloRemotePassword),
            CreatePresentationState(AppLockMode.WindowsHelloRemotePassword));

        Assert.False(shouldPresent);
    }

    [Fact]
    public void ShouldPresentResolvedProtectionState_SameEffectiveModeAcrossSessionFlip_ReturnsFalse()
    {
        var shouldPresent = AppLockSessionTransitionPolicy.ShouldPresentResolvedProtectionState(
            CreatePresentationState(AppLockMode.Password),
            CreatePresentationState(AppLockMode.Password));

        Assert.False(shouldPresent);
    }

    [Theory]
    [InlineData(AppLockSessionTransitionPolicy.ConsoleConnectSessionChange)]
    [InlineData(AppLockSessionTransitionPolicy.ConsoleDisconnectSessionChange)]
    [InlineData(AppLockSessionTransitionPolicy.RemoteConnectSessionChange)]
    [InlineData(AppLockSessionTransitionPolicy.RemoteDisconnectSessionChange)]
    public void ShouldReconcileOnSessionChange_RelevantCodes_ReturnTrue(uint sessionChangeCode)
    {
        var shouldReconcile = AppLockSessionTransitionPolicy.ShouldReconcileOnSessionChange(sessionChangeCode);

        Assert.True(shouldReconcile);
    }

    [Theory]
    [InlineData(0u)]
    [InlineData(5u)]
    [InlineData(7u)]
    [InlineData(8u)]
    public void ShouldReconcileOnSessionChange_IrrelevantCodes_ReturnFalse(uint sessionChangeCode)
    {
        var shouldReconcile = AppLockSessionTransitionPolicy.ShouldReconcileOnSessionChange(sessionChangeCode);

        Assert.False(shouldReconcile);
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

    private static AppLockProtectionPresentationState CreatePresentationState(
        AppLockMode mode,
        bool showRecoveryDialog = false,
        AppLockTemporaryBypassReason? temporaryBypassReason = null)
    {
        return new AppLockProtectionPresentationState(
            mode,
            showRecoveryDialog,
            temporaryBypassReason);
    }
}
