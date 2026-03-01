namespace WinOTP.Services;

internal readonly record struct SettingsProtectionViewState(
    AppLockResolution Resolution,
    bool IsPinToggleOn,
    bool IsPasswordToggleOn,
    bool IsWindowsHelloToggleOn);

internal static class SettingsProtectionViewStateService
{
    public static async Task<SettingsProtectionViewState> ResolveAsync(
        IAppSettingsService settings,
        IAppLockService appLock)
    {
        var resolution = await AppLockResolutionService.ResolveAsync(settings, appLock);
        if (resolution.HasUnavailableConfiguredProtection)
        {
            if (resolution.DisableUnavailablePin)
            {
                settings.IsPinProtectionEnabled = false;
            }

            if (resolution.DisableUnavailablePassword)
            {
                settings.IsPasswordProtectionEnabled = false;
            }

            if (resolution.DisableUnavailableWindowsHello)
            {
                settings.IsWindowsHelloEnabled = false;
            }

            resolution = await AppLockResolutionService.ResolveAsync(settings, appLock);
        }

        return new SettingsProtectionViewState(
            resolution,
            settings.IsPinProtectionEnabled,
            settings.IsPasswordProtectionEnabled,
            settings.IsWindowsHelloEnabled);
    }
}
