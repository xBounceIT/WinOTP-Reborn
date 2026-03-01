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
            isPinSet: true,
            isPasswordProtectionEnabled: false,
            isPasswordSet: false,
            isWindowsHelloEnabled: false,
            isWindowsHelloAvailable: false);

        Assert.Equal(AppLockMode.Pin, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_PasswordConfigured_ReturnsPasswordMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            isPinSet: false,
            isPasswordProtectionEnabled: true,
            isPasswordSet: true,
            isWindowsHelloEnabled: false,
            isWindowsHelloAvailable: false);

        Assert.Equal(AppLockMode.Password, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailable_ReturnsWindowsHelloMode()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            isPinSet: false,
            isPasswordProtectionEnabled: false,
            isPasswordSet: false,
            isWindowsHelloEnabled: true,
            isWindowsHelloAvailable: true);

        Assert.Equal(AppLockMode.WindowsHello, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloUnavailable_DisablesWindowsHello()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            isPinSet: false,
            isPasswordProtectionEnabled: false,
            isPasswordSet: false,
            isWindowsHelloEnabled: true,
            isWindowsHelloAvailable: false);

        Assert.Equal(AppLockMode.None, decision.Mode);
        Assert.True(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_NoConfiguredProtection_ReturnsNone()
    {
        var decision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            isPinSet: false,
            isPasswordProtectionEnabled: false,
            isPasswordSet: false,
            isWindowsHelloEnabled: false,
            isWindowsHelloAvailable: false);

        Assert.Equal(AppLockMode.None, decision.Mode);
        Assert.False(decision.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_MultipleProtectionFlags_PrefersPinThenPasswordThenWindowsHello()
    {
        var pinDecision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            isPinSet: true,
            isPasswordProtectionEnabled: true,
            isPasswordSet: true,
            isWindowsHelloEnabled: true,
            isWindowsHelloAvailable: true);

        var passwordDecision = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            isPinSet: false,
            isPasswordProtectionEnabled: true,
            isPasswordSet: true,
            isWindowsHelloEnabled: true,
            isWindowsHelloAvailable: true);

        Assert.Equal(AppLockMode.Pin, pinDecision.Mode);
        Assert.Equal(AppLockMode.Password, passwordDecision.Mode);
    }
}
