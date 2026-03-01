namespace WinOTP.Services;

internal static class AppLockResolutionService
{
    public static async Task<AppLockResolution> ResolveAsync(
        IAppSettingsService appSettings,
        IAppLockService appLock)
    {
        var windowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable;

        if (appSettings.IsWindowsHelloEnabled)
        {
            windowsHelloAvailability = await appLock.GetWindowsHelloAvailabilityAsync();
        }

        return AppLockDecisionResolver.Resolve(
            appSettings.IsPinProtectionEnabled,
            appLock.GetPinStatus(),
            appSettings.IsPasswordProtectionEnabled,
            appLock.GetPasswordStatus(),
            appSettings.IsWindowsHelloEnabled,
            windowsHelloAvailability);
    }
}
