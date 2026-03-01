namespace WinOTP.Services;

internal enum AppLockMode
{
    None,
    Pin,
    Password,
    WindowsHello
}

internal readonly record struct AppLockResolution(
    AppLockMode Mode,
    bool IsPinEffective,
    bool IsPasswordEffective,
    bool IsWindowsHelloEffective,
    bool HasPinError,
    bool HasPasswordError,
    bool HasWindowsHelloError,
    bool DisableUnavailablePin,
    bool DisableUnavailablePassword,
    bool DisableUnavailableWindowsHello)
{
    public bool HasUnavailableConfiguredProtection =>
        DisableUnavailablePin || DisableUnavailablePassword || DisableUnavailableWindowsHello;

    public bool HasConfiguredProtectionError =>
        HasPinError || HasPasswordError || HasWindowsHelloError;
}

internal static class AppLockDecisionResolver
{
    public static AppLockResolution Resolve(
        bool isPinProtectionEnabled,
        AppLockCredentialStatus pinStatus,
        bool isPasswordProtectionEnabled,
        AppLockCredentialStatus passwordStatus,
        bool isWindowsHelloEnabled,
        WindowsHelloAvailabilityStatus windowsHelloAvailability)
    {
        var isPinEffective = isPinProtectionEnabled &&
            pinStatus == AppLockCredentialStatus.Set;
        var isPasswordEffective = isPasswordProtectionEnabled &&
            passwordStatus == AppLockCredentialStatus.Set;
        var isWindowsHelloEffective = isWindowsHelloEnabled &&
            windowsHelloAvailability == WindowsHelloAvailabilityStatus.Available;

        var hasPinError = isPinProtectionEnabled && pinStatus == AppLockCredentialStatus.Error;
        var hasPasswordError = isPasswordProtectionEnabled && passwordStatus == AppLockCredentialStatus.Error;
        var hasWindowsHelloError =
            isWindowsHelloEnabled && windowsHelloAvailability == WindowsHelloAvailabilityStatus.Error;

        var disableUnavailablePin = isPinProtectionEnabled && pinStatus == AppLockCredentialStatus.NotSet;
        var disableUnavailablePassword = isPasswordProtectionEnabled && passwordStatus == AppLockCredentialStatus.NotSet;
        var disableUnavailableWindowsHello =
            isWindowsHelloEnabled && windowsHelloAvailability == WindowsHelloAvailabilityStatus.Unavailable;

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

        return new AppLockResolution(
            mode,
            isPinEffective,
            isPasswordEffective,
            isWindowsHelloEffective,
            hasPinError,
            hasPasswordError,
            hasWindowsHelloError,
            disableUnavailablePin,
            disableUnavailablePassword,
            disableUnavailableWindowsHello);
    }
}
