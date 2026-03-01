using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockDecisionResolverTests
{
    [Fact]
    public void Resolve_PinConfigured_ReturnsPinMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Pin, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_PasswordConfigured_ReturnsPasswordMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Password, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailable_ReturnsWindowsHelloMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.WindowsHello, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloUnavailable_DisablesWindowsHello()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, decision.Mode);
        Assert.True(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_NoConfiguredProtection_ReturnsNone()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_PinLookupError_ReturnsPinMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Error,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Pin, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_PasswordLookupError_ReturnsPasswordMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Error,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Password, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailabilityError_ReturnsWindowsHelloMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Error);

        Assert.Equal(AppLockMode.WindowsHello, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_MultipleProtectionFlags_PrefersPinThenPasswordThenWindowsHello()
    {
        var pinDecision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        var passwordDecision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.Pin, pinDecision.Mode);
        Assert.Equal(AppLockMode.Password, passwordDecision.Mode);
    }
}
