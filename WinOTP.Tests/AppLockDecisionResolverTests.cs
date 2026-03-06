using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockDecisionResolverTests
{
    [Fact]
    public void Resolve_PinConfigured_ReturnsPinMode()
    {
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set);

        Assert.Equal(AppLockMode.Pin, resolution.Mode);
        Assert.True(resolution.IsPinEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_PasswordConfigured_ReturnsPasswordMode()
    {
        var resolution = Resolve(
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.IsPasswordEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_WindowsHelloAvailable_ReturnsWindowsHelloMode()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        Assert.Equal(AppLockMode.WindowsHello, resolution.Mode);
        Assert.True(resolution.IsWindowsHelloEffective);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_WindowsHelloUnavailable_DisablesWindowsHello()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_WindowsHelloRemoteSession_KeepsWindowsHelloEnabledForLater()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.False(resolution.DisableUnavailableWindowsHello);
        Assert.False(resolution.HasConfiguredProtectionError);
        Assert.True(resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public void Resolve_NoConfiguredProtection_ReturnsNone()
    {
        var resolution = Resolve();

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.False(resolution.HasUnavailableConfiguredProtection);
    }

    [Fact]
    public void Resolve_PinLookupError_ReturnsNoneAndFlagsTransientError()
    {
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Error);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.False(resolution.IsPinEffective);
        Assert.True(resolution.HasPinError);
        Assert.True(resolution.HasConfiguredProtectionError);
        Assert.False(resolution.DisableUnavailablePin);
    }

    [Fact]
    public void Resolve_PasswordLookupError_FallsBackToWindowsHello()
    {
        var resolution = Resolve(
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
        var resolution = Resolve(
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
    public void Resolve_WindowsHelloRemoteSession_FallsBackToPassword()
    {
        var resolution = Resolve(
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.IsPasswordEffective);
        Assert.False(resolution.DisableUnavailableWindowsHello);
        Assert.True(resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public void Resolve_WindowsHelloRemoteSession_WithRemotePinConfigured_ReturnsRemotePinMode()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession,
            isWindowsHelloRemotePinEnabled: true,
            windowsHelloRemotePinStatus: AppLockCredentialStatus.Set);

        Assert.Equal(AppLockMode.WindowsHelloRemotePin, resolution.Mode);
        Assert.True(resolution.IsWindowsHelloRemotePinEffective);
        Assert.True(resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public void Resolve_WindowsHelloRemoteSession_WithRemotePasswordConfigured_ReturnsRemotePasswordMode()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession,
            isWindowsHelloRemotePasswordEnabled: true,
            windowsHelloRemotePasswordStatus: AppLockCredentialStatus.Set);

        Assert.Equal(AppLockMode.WindowsHelloRemotePassword, resolution.Mode);
        Assert.True(resolution.IsWindowsHelloRemotePasswordEffective);
        Assert.True(resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public void Resolve_MultipleProtectionFlags_PrefersPinThenPasswordThenWindowsHello()
    {
        var pinResolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.Set,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set,
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.Available);

        var passwordResolution = Resolve(
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
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.False(resolution.IsPinEffective);
    }

    [Fact]
    public void Resolve_PasswordEnabledButMissingWithoutFallback_DisablesPasswordAndReturnsNone()
    {
        var resolution = Resolve(
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.NotSet);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePassword);
        Assert.False(resolution.IsPasswordEffective);
    }

    [Fact]
    public void Resolve_MissingPinFallsBackToPassword()
    {
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Set);

        Assert.Equal(AppLockMode.Password, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.True(resolution.IsPasswordEffective);
    }

    [Fact]
    public void Resolve_MissingPasswordFallsBackToWindowsHello()
    {
        var resolution = Resolve(
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
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.NotSet,
            isWindowsHelloEnabled: true);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.True(resolution.DisableUnavailablePassword);
        Assert.True(resolution.DisableUnavailableWindowsHello);
    }

    [Fact]
    public void Resolve_MissingPinAndPasswordError_OnlyDisablesMissingMethod()
    {
        var resolution = Resolve(
            isPinProtectionEnabled: true,
            pinStatus: AppLockCredentialStatus.NotSet,
            isPasswordProtectionEnabled: true,
            passwordStatus: AppLockCredentialStatus.Error);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailablePin);
        Assert.False(resolution.DisableUnavailablePassword);
        Assert.True(resolution.HasPasswordError);
        Assert.True(resolution.HasConfiguredProtectionError);
    }

    [Fact]
    public void Resolve_WindowsHelloRemoteSession_WithMissingRemotePin_DisablesOnlyRemotePin()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession,
            isWindowsHelloRemotePinEnabled: true,
            windowsHelloRemotePinStatus: AppLockCredentialStatus.NotSet);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.DisableUnavailableWindowsHelloRemotePin);
        Assert.False(resolution.DisableUnavailableWindowsHello);
        Assert.True(resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public void Resolve_WindowsHelloRemoteSession_WithRemotePinError_FlagsTransientError()
    {
        var resolution = Resolve(
            isWindowsHelloEnabled: true,
            windowsHelloAvailability: WindowsHelloAvailabilityStatus.RemoteSession,
            isWindowsHelloRemotePinEnabled: true,
            windowsHelloRemotePinStatus: AppLockCredentialStatus.Error);

        Assert.Equal(AppLockMode.None, resolution.Mode);
        Assert.True(resolution.HasWindowsHelloRemotePinError);
        Assert.True(resolution.HasConfiguredProtectionError);
        Assert.False(resolution.DisableUnavailableWindowsHelloRemotePin);
    }

    private static AppLockResolution Resolve(
        bool isPinProtectionEnabled = false,
        AppLockCredentialStatus pinStatus = AppLockCredentialStatus.NotSet,
        bool isPasswordProtectionEnabled = false,
        AppLockCredentialStatus passwordStatus = AppLockCredentialStatus.NotSet,
        bool isWindowsHelloEnabled = false,
        WindowsHelloAvailabilityStatus windowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable,
        bool isWindowsHelloRemotePinEnabled = false,
        AppLockCredentialStatus windowsHelloRemotePinStatus = AppLockCredentialStatus.NotSet,
        bool isWindowsHelloRemotePasswordEnabled = false,
        AppLockCredentialStatus windowsHelloRemotePasswordStatus = AppLockCredentialStatus.NotSet)
    {
        return AppLockDecisionResolver.Resolve(
            isPinProtectionEnabled,
            pinStatus,
            isPasswordProtectionEnabled,
            passwordStatus,
            isWindowsHelloEnabled,
            windowsHelloAvailability,
            isWindowsHelloRemotePinEnabled,
            windowsHelloRemotePinStatus,
            isWindowsHelloRemotePasswordEnabled,
            windowsHelloRemotePasswordStatus);
    }
}
