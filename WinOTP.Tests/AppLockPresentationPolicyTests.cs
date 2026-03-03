using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppLockPresentationPolicyTests
{
    [Fact]
    public void Startup_WithPinResolution_ShowsLockScreen()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.Startup,
            CreateResolution(AppLockMode.Pin));

        Assert.True(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.False(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void Startup_WithPasswordResolution_ShowsLockScreen()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.Startup,
            CreateResolution(AppLockMode.Password));

        Assert.True(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.False(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void Startup_WithWindowsHelloResolution_ShowsLockScreen()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.Startup,
            CreateResolution(AppLockMode.WindowsHello));

        Assert.True(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.False(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void Startup_WithNoProtection_EnsuresInitialPageAndStartsMonitoring()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.Startup,
            CreateResolution(AppLockMode.None));

        Assert.False(decision.ShouldShowLockScreen);
        Assert.True(decision.ShouldEnsureInitialPage);
        Assert.True(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void SettingsChange_WithPinResolution_DoesNotShowLockScreen_AndStartsMonitoring()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.SettingsChange,
            CreateResolution(AppLockMode.Pin));

        Assert.False(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.True(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void SettingsChange_WithPasswordResolution_DoesNotShowLockScreen_AndStartsMonitoring()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.SettingsChange,
            CreateResolution(AppLockMode.Password));

        Assert.False(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.True(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void SettingsChange_WithWindowsHelloResolution_DoesNotShowLockScreen_AndStartsMonitoring()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.SettingsChange,
            CreateResolution(AppLockMode.WindowsHello));

        Assert.False(decision.ShouldShowLockScreen);
        Assert.False(decision.ShouldEnsureInitialPage);
        Assert.True(decision.ShouldStartMonitoring);
    }

    [Fact]
    public void SettingsChange_WithNoProtection_EnsuresInitialPageAndStartsMonitoring()
    {
        var decision = AppLockPresentationPolicy.Resolve(
            AppLockPresentationTrigger.SettingsChange,
            CreateResolution(AppLockMode.None));

        Assert.False(decision.ShouldShowLockScreen);
        Assert.True(decision.ShouldEnsureInitialPage);
        Assert.True(decision.ShouldStartMonitoring);
    }

    private static AppLockResolution CreateResolution(AppLockMode mode) =>
        new(
            mode,
            IsPinEffective: mode == AppLockMode.Pin,
            IsPasswordEffective: mode == AppLockMode.Password,
            IsWindowsHelloEffective: mode == AppLockMode.WindowsHello,
            HasPinError: false,
            HasPasswordError: false,
            HasWindowsHelloError: false,
            DisableUnavailablePin: false,
            DisableUnavailablePassword: false,
            DisableUnavailableWindowsHello: false);
}
