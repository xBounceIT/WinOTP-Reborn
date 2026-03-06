namespace WinOTP.Services;

internal readonly record struct SettingsProtectionViewState(
    AppLockResolution Resolution,
    bool IsPinToggleOn,
    bool IsPasswordToggleOn,
    bool IsWindowsHelloToggleOn,
    bool IsWindowsHelloRemotePinToggleOn,
    bool IsWindowsHelloRemotePasswordToggleOn);

internal static class SettingsProtectionViewStateService
{
    public static async Task<SettingsProtectionViewState> ResolveAsync(
        IAppSettingsService settings,
        IAppLockService appLock)
    {
        if (!settings.IsWindowsHelloEnabled &&
            (settings.IsWindowsHelloRemotePinEnabled || settings.IsWindowsHelloRemotePasswordEnabled))
        {
            await ClearWindowsHelloRemoteFallbackAsync(settings, appLock);
        }

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
                await ClearWindowsHelloRemoteFallbackAsync(settings, appLock);
            }
            else if (resolution.DisableUnavailableWindowsHelloRemotePin)
            {
                settings.IsWindowsHelloRemotePinEnabled = false;
                await appLock.RemoveWindowsHelloRemotePinAsync();
            }

            if (!resolution.DisableUnavailableWindowsHello &&
                resolution.DisableUnavailableWindowsHelloRemotePassword)
            {
                settings.IsWindowsHelloRemotePasswordEnabled = false;
                await appLock.RemoveWindowsHelloRemotePasswordAsync();
            }

            resolution = await AppLockResolutionService.ResolveAsync(settings, appLock);
        }

        return new SettingsProtectionViewState(
            resolution,
            settings.IsPinProtectionEnabled,
            settings.IsPasswordProtectionEnabled,
            settings.IsWindowsHelloEnabled,
            settings.IsWindowsHelloRemotePinEnabled,
            settings.IsWindowsHelloRemotePasswordEnabled);
    }

    private static async Task ClearWindowsHelloRemoteFallbackAsync(
        IAppSettingsService settings,
        IAppLockService appLock)
    {
        settings.IsWindowsHelloRemotePinEnabled = false;
        settings.IsWindowsHelloRemotePasswordEnabled = false;
        await appLock.RemoveWindowsHelloRemotePinAsync();
        await appLock.RemoveWindowsHelloRemotePasswordAsync();
    }
}
