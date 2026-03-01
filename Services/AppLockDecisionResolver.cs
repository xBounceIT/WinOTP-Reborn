namespace WinOTP.Services;

internal enum AppLockMode
{
    None,
    Pin,
    Password,
    WindowsHello
}

internal readonly record struct AppLockDecision(AppLockMode Mode, bool DisableUnavailableWindowsHello);

internal static class AppLockDecisionResolver
{
    public static AppLockDecision Resolve(
        bool isPinProtectionEnabled,
        AppLockCredentialStatus pinStatus,
        bool isPasswordProtectionEnabled,
        AppLockCredentialStatus passwordStatus,
        bool isWindowsHelloEnabled,
        WindowsHelloAvailabilityStatus windowsHelloAvailability)
    {
        if (isPinProtectionEnabled && pinStatus is AppLockCredentialStatus.Set or AppLockCredentialStatus.Error)
        {
            return new AppLockDecision(AppLockMode.Pin, false);
        }

        if (isPasswordProtectionEnabled && passwordStatus is AppLockCredentialStatus.Set or AppLockCredentialStatus.Error)
        {
            return new AppLockDecision(AppLockMode.Password, false);
        }

        if (isWindowsHelloEnabled)
        {
            return windowsHelloAvailability switch
            {
                WindowsHelloAvailabilityStatus.Available or WindowsHelloAvailabilityStatus.Error
                    => new AppLockDecision(AppLockMode.WindowsHello, false),
                WindowsHelloAvailabilityStatus.Unavailable
                    => new AppLockDecision(AppLockMode.None, true),
                _ => new AppLockDecision(AppLockMode.None, false)
            };
        }

        return new AppLockDecision(AppLockMode.None, false);
    }
}
