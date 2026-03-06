namespace WinOTP.Services;

internal static class AppLockResolutionService
{
    public static async Task<AppLockResolution> ResolveAsync(
        IAppSettingsService appSettings,
        IAppLockService appLock)
    {
        var windowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable;
        var windowsHelloRemotePinStatus = AppLockCredentialStatus.NotSet;
        var windowsHelloRemotePasswordStatus = AppLockCredentialStatus.NotSet;

        if (appSettings.IsWindowsHelloEnabled)
        {
            windowsHelloAvailability = await appLock.GetWindowsHelloAvailabilityAsync();
        }

        if (appSettings.IsWindowsHelloRemotePinEnabled)
        {
            windowsHelloRemotePinStatus = appLock.GetWindowsHelloRemotePinStatus();
        }

        if (appSettings.IsWindowsHelloRemotePasswordEnabled)
        {
            windowsHelloRemotePasswordStatus = appLock.GetWindowsHelloRemotePasswordStatus();
        }

        return AppLockDecisionResolver.Resolve(
            appSettings.IsPinProtectionEnabled,
            appLock.GetPinStatus(),
            appSettings.IsPasswordProtectionEnabled,
            appLock.GetPasswordStatus(),
            appSettings.IsWindowsHelloEnabled,
            windowsHelloAvailability,
            appSettings.IsWindowsHelloRemotePinEnabled,
            windowsHelloRemotePinStatus,
            appSettings.IsWindowsHelloRemotePasswordEnabled,
            windowsHelloRemotePasswordStatus);
    }
}
