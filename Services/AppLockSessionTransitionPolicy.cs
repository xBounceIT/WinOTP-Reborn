namespace WinOTP.Services;

internal enum AppLockTemporaryBypassReason
{
    ServiceError,
    RemoteSession
}

internal readonly record struct AppLockProtectionPresentationState(
    AppLockMode Mode,
    bool ShowRecoveryDialog,
    AppLockTemporaryBypassReason? TemporaryBypassReason)
{
    public bool HasRemoteSessionContext =>
        Mode is AppLockMode.WindowsHelloRemotePin or AppLockMode.WindowsHelloRemotePassword ||
        TemporaryBypassReason == AppLockTemporaryBypassReason.RemoteSession;
}

internal static class AppLockSessionTransitionPolicy
{
    internal const uint ConsoleConnectSessionChange = 0x1;
    internal const uint ConsoleDisconnectSessionChange = 0x2;
    internal const uint RemoteConnectSessionChange = 0x3;
    internal const uint RemoteDisconnectSessionChange = 0x4;

    public static bool ShouldResolveOnReconciliation(
        bool isWindowsHelloEnabled,
        AppLockProtectionPresentationState previousState)
    {
        return isWindowsHelloEnabled || previousState.HasRemoteSessionContext;
    }

    public static bool ShouldRefreshBeforeCredentialVerification(
        AppLockMode currentLockMode,
        AppLockResolution resolution)
    {
        return currentLockMode is AppLockMode.WindowsHelloRemotePin or AppLockMode.WindowsHelloRemotePassword &&
            resolution.Mode != currentLockMode;
    }

    public static bool ShouldPresentResolvedProtectionState(
        AppLockProtectionPresentationState previousState,
        AppLockProtectionPresentationState currentState)
    {
        return previousState != currentState;
    }

    public static bool ShouldRequireImmediateLockOnSettingsChange(
        AppLockProtectionPresentationState previousState,
        AppLockProtectionPresentationState currentState)
    {
        return previousState.TemporaryBypassReason == AppLockTemporaryBypassReason.RemoteSession &&
            currentState.Mode is AppLockMode.WindowsHelloRemotePin or AppLockMode.WindowsHelloRemotePassword;
    }

    public static bool ShouldReconcileOnSessionChange(uint sessionChangeCode)
    {
        return sessionChangeCode is
            ConsoleConnectSessionChange or
            ConsoleDisconnectSessionChange or
            RemoteConnectSessionChange or
            RemoteDisconnectSessionChange;
    }
}
