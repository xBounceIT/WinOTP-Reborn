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
    bool DisableUnavailablePin,
    bool DisableUnavailablePassword,
    bool DisableUnavailableWindowsHello)
{
    public bool HasUnavailableConfiguredProtection =>
        DisableUnavailablePin || DisableUnavailablePassword || DisableUnavailableWindowsHello;
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
            pinStatus is AppLockCredentialStatus.Set or AppLockCredentialStatus.Error;
        var isPasswordEffective = isPasswordProtectionEnabled &&
            passwordStatus is AppLockCredentialStatus.Set or AppLockCredentialStatus.Error;
        var isWindowsHelloEffective = isWindowsHelloEnabled &&
            windowsHelloAvailability is WindowsHelloAvailabilityStatus.Available or WindowsHelloAvailabilityStatus.Error;

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
            disableUnavailablePin,
            disableUnavailablePassword,
            disableUnavailableWindowsHello);
    }
}
