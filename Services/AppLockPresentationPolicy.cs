namespace WinOTP.Services;

internal enum AppLockPresentationTrigger
{
    Startup,
    SettingsChange
}

internal readonly record struct AppLockPresentationDecision(
    bool ShouldShowLockScreen,
    bool ShouldEnsureInitialPage,
    bool ShouldStartMonitoring);

internal static class AppLockPresentationPolicy
{
    public static AppLockPresentationDecision Resolve(
        AppLockPresentationTrigger trigger,
        AppLockResolution resolution)
    {
        var hasEffectiveProtection = resolution.Mode != AppLockMode.None;

        return trigger switch
        {
            AppLockPresentationTrigger.Startup when hasEffectiveProtection =>
                new AppLockPresentationDecision(
                    ShouldShowLockScreen: true,
                    ShouldEnsureInitialPage: false,
                    ShouldStartMonitoring: false),

            AppLockPresentationTrigger.Startup =>
                new AppLockPresentationDecision(
                    ShouldShowLockScreen: false,
                    ShouldEnsureInitialPage: true,
                    ShouldStartMonitoring: true),

            AppLockPresentationTrigger.SettingsChange when hasEffectiveProtection =>
                new AppLockPresentationDecision(
                    ShouldShowLockScreen: false,
                    ShouldEnsureInitialPage: false,
                    ShouldStartMonitoring: true),

            _ =>
                new AppLockPresentationDecision(
                    ShouldShowLockScreen: false,
                    ShouldEnsureInitialPage: true,
                    ShouldStartMonitoring: true)
        };
    }
}
