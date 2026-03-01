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
        bool isPinSet,
        bool isPasswordProtectionEnabled,
        bool isPasswordSet,
        bool isWindowsHelloEnabled,
        bool isWindowsHelloAvailable)
    {
        if (isPinProtectionEnabled && isPinSet)
        {
            return new AppLockDecision(AppLockMode.Pin, false);
        }

        if (isPasswordProtectionEnabled && isPasswordSet)
        {
            return new AppLockDecision(AppLockMode.Password, false);
        }

        if (isWindowsHelloEnabled)
        {
            return isWindowsHelloAvailable
                ? new AppLockDecision(AppLockMode.WindowsHello, false)
                : new AppLockDecision(AppLockMode.None, true);
        }

        return new AppLockDecision(AppLockMode.None, false);
    }
}
