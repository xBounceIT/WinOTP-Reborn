using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockDecisionResolverTests
{
    [Fact]
    public void Resolve_PinConfigured_ReturnsPinMode()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Pin, resolution.Mode);
        Assert.True(resolution.IsPinEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_PasswordConfigured_ReturnsPasswordMode()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.IsPasswordEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailable_ReturnsWindowsHelloMode()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.WindowsHello, resolution.Mode);
        Assert.True(resolution.IsWindowsHelloEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_WindowsHelloUnavailable_DisablesWindowsHello()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_NoConfiguredProtection_ReturnsNone()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_PinLookupError_ReturnsNoneAndFlagsTransientError()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Error,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.False(resolution.IsPinEffective);
        Assert.True(resolution.HasPinError);
        Assert.True(resolution.HasConfiguredProtectionError);
        Assert.False(resolution.DisableUnavailablePin);
    }

    [Fact]
    public void Resolve_PasswordLookupError_FallsBackToWindowsHello()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Error,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.WindowsHello, resolution.Mode);
        Assert.False(resolution.IsPasswordEffective);
        Assert.True(resolution.IsWindowsHelloEffective);
        Assert.True(resolution.HasPasswordError);
        Assert.True(resolution.HasConfiguredProtectionError);
        Assert.False(resolution.DisableUnavailablePassword);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailabilityError_FallsBackToPassword()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Error);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.IsPasswordEffective);
        Assert.False(resolution.IsWindowsHelloEffective);
        Assert.True(resolution.HasWindowsHelloError);
        Assert.True(resolution.HasConfiguredProtectionError);
        Assert.False(resolution.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_MultipleProtectionFlags_PrefersPinThenPasswordThenWindowsHello()
    {
        var pinResolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        var passwordResolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.Pin, pinResolution.Mode);
        Assert.Equal(AppLockMode.Password, passwordResolution.Mode);
        Assert.True(passwordResolution.DisableUnavailablePin);
    }

    [Fact]
    public void Resolve_PinEnabledButMissingWithoutFallback_DisablesPinAndReturnsNone()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: false,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.False(resolution.IsPinEffective);
    }

    [Fact]
    public void Resolve_PasswordEnabledButMissingWithoutFallback_DisablesPasswordAndReturnsNone()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePassword);
        Assert.False(resolution.IsPasswordEffective);
    }

    [Fact]
    public void Resolve_MissingPinFallsBackToPassword()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.True(resolution.IsPasswordEffective);
    }

    [Fact]
    public void Resolve_MissingPasswordFallsBackToWindowsHello()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: false,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.WindowsHello, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePassword);
        Assert.True(resolution.IsWindowsHelloEffective);
    }

    [Fact]
    public void Resolve_MultipleUnavailableConfiguredMethods_ReturnsAllDisableFlags()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.True(resolution.DisableUnavailablePassword);
        Assert.True(resolution.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_MissingPinAndPasswordError_OnlyDisablesMissingMethod()
    {
        var resolution = AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Error,
            isWindowsHelloEnabled: false,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Unavailable);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.False(resolution.DisableUnavailablePassword);
        Assert.True(resolution.HasPasswordError);
        Assert.True(resolution.HasConfiguredProtectionError);
    }
}
