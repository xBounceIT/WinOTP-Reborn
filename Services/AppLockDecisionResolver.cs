namespace WinOTP.Services;

internal enum AppLockMode
{
    None,
    Pin,
    Password,
    WindowsHello,
    WindowsHelloRemotePin,
    WindowsHelloRemotePassword
}

internal readonly record struct AppLockResolution(
    AppLockMode Mode,
    bool IsPinEffective,
    bool IsPasswordEffective,
    bool IsWindowsHelloEffective,
    bool IsWindowsHelloRemotePinEffective,
    bool IsWindowsHelloRemotePasswordEffective,
    bool HasPinError,
    bool HasPasswordError,
    bool HasWindowsHelloError,
    bool HasWindowsHelloRemotePinError,
    bool HasWindowsHelloRemotePasswordError,
    bool HasWindowsHelloRemoteSession,
    bool DisableUnavailablePin,
    bool DisableUnavailablePassword,
    bool DisableUnavailableWindowsHello,
    bool DisableUnavailableWindowsHelloRemotePin,
    bool DisableUnavailableWindowsHelloRemotePassword)
{
    public bool HasUnavailableConfiguredProtection =>
        DisableUnavailablePin ||
        DisableUnavailablePassword ||
        DisableUnavailableWindowsHello ||
        DisableUnavailableWindowsHelloRemotePin ||
        DisableUnavailableWindowsHelloRemotePassword;

    public bool HasConfiguredProtectionError =>
        HasPinError ||
        HasPasswordError ||
        HasWindowsHelloError ||
        HasWindowsHelloRemotePinError ||
        HasWindowsHelloRemotePasswordError;
}

internal static class AppLockDecisionResolver
{
    public static AppLockResolution Resolve(
        bool isPinProtectionEnabled,
        AppLockCredentialStatus pinStatus,
        bool isPasswordProtectionEnabled,
        AppLockCredentialStatus passwordStatus,
        bool isWindowsHelloEnabled,
        WindowsHelloAvailabilityStatus windowsHelloAvailability,
        bool isWindowsHelloRemotePinEnabled,
        AppLockCredentialStatus windowsHelloRemotePinStatus,
        bool isWindowsHelloRemotePasswordEnabled,
        AppLockCredentialStatus windowsHelloRemotePasswordStatus)
    {
        var isPinEffective = isPinProtectionEnabled &&
            pinStatus == AppLockCredentialStatus.Set;
        var isPasswordEffective = isPasswordProtectionEnabled &&
            passwordStatus == AppLockCredentialStatus.Set;
        var isWindowsHelloEffective = isWindowsHelloEnabled &&
            windowsHelloAvailability == WindowsHelloAvailabilityStatus.Available;
        var isWindowsHelloRemotePinEffective = isWindowsHelloEnabled &&
            isWindowsHelloRemotePinEnabled &&
            windowsHelloAvailability == WindowsHelloAvailabilityStatus.RemoteSession &&
            windowsHelloRemotePinStatus == AppLockCredentialStatus.Set;
        var isWindowsHelloRemotePasswordEffective = isWindowsHelloEnabled &&
            isWindowsHelloRemotePasswordEnabled &&
            windowsHelloAvailability == WindowsHelloAvailabilityStatus.RemoteSession &&
            windowsHelloRemotePasswordStatus == AppLockCredentialStatus.Set;

        var hasPinError = isPinProtectionEnabled && pinStatus == AppLockCredentialStatus.Error;
        var hasPasswordError = isPasswordProtectionEnabled && passwordStatus == AppLockCredentialStatus.Error;
        var hasWindowsHelloError =
            isWindowsHelloEnabled && windowsHelloAvailability == WindowsHelloAvailabilityStatus.Error;
        var hasWindowsHelloRemotePinError =
            isWindowsHelloRemotePinEnabled && windowsHelloRemotePinStatus == AppLockCredentialStatus.Error;
        var hasWindowsHelloRemotePasswordError =
            isWindowsHelloRemotePasswordEnabled && windowsHelloRemotePasswordStatus == AppLockCredentialStatus.Error;
        var hasWindowsHelloRemoteSession =
            isWindowsHelloEnabled && windowsHelloAvailability == WindowsHelloAvailabilityStatus.RemoteSession;

        var disableUnavailablePin = isPinProtectionEnabled && pinStatus == AppLockCredentialStatus.NotSet;
        var disableUnavailablePassword = isPasswordProtectionEnabled && passwordStatus == AppLockCredentialStatus.NotSet;
        var disableUnavailableWindowsHello =
            isWindowsHelloEnabled && windowsHelloAvailability == WindowsHelloAvailabilityStatus.Unavailable;
        var disableUnavailableWindowsHelloRemotePin =
            isWindowsHelloRemotePinEnabled && windowsHelloRemotePinStatus == AppLockCredentialStatus.NotSet;
        var disableUnavailableWindowsHelloRemotePassword =
            isWindowsHelloRemotePasswordEnabled && windowsHelloRemotePasswordStatus == AppLockCredentialStatus.NotSet;

        var mode = AppLockMode.None;

        if (isPinEffective)
        {
            mode = AppLockMode.Pin;
        }
        else if (isPasswordEffective)
        {
            mode = AppLockMode.Password;
        }
        else if (isWindowsHelloEffective)
        {
            mode = AppLockMode.WindowsHello;
        }
        else if (isWindowsHelloRemotePinEffective)
        {
            mode = AppLockMode.WindowsHelloRemotePin;
        }
        else if (isWindowsHelloRemotePasswordEffective)
        {
            mode = AppLockMode.WindowsHelloRemotePassword;
        }

        return new AppLockResolution(
            mode,
            isPinEffective,
            isPasswordEffective,
            isWindowsHelloEffective,
            isWindowsHelloRemotePinEffective,
            isWindowsHelloRemotePasswordEffective,
            hasPinError,
            hasPasswordError,
            hasWindowsHelloError,
            hasWindowsHelloRemotePinError,
            hasWindowsHelloRemotePasswordError,
            hasWindowsHelloRemoteSession,
            disableUnavailablePin,
            disableUnavailablePassword,
            disableUnavailableWindowsHello,
            disableUnavailableWindowsHelloRemotePin,
            disableUnavailableWindowsHelloRemotePassword);
    }
}
