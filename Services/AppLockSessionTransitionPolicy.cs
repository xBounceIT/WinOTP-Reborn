namespace WinOTP.Services;

internal static class AppLockSessionTransitionPolicy
{
    public static bool ShouldRefreshBeforeCredentialVerification(
        AppLockMode currentLockMode,
        AppLockResolution resolution)
    {
        return currentLockMode is AppLockMode.WindowsHelloRemotePin or AppLockMode.WindowsHelloRemotePassword &&
            resolution.Mode != currentLockMode;
    }

    public static bool ShouldReapplyProtectionOnActivation(
        bool hadRemoteSessionContext,
        AppLockResolution resolution)
    {
        return hadRemoteSessionContext && !resolution.HasWindowsHelloRemoteSession;
    }
}
