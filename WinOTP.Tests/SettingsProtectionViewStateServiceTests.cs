#pragma warning disable CS0067
using Windows.Security.Credentials.UI;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class SettingsProtectionViewStateServiceTests
{
    [Fact]
    public async Task ResolveAsync_PinStatusError_KeepsPinToggleOn()
    {
        var settings = new FakeAppSettingsService
        {
            IsPinProtectionEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            PinStatus = AppLockCredentialStatus.Error
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.True(settings.IsPinProtectionEnabled);
        Assert.True(viewState.IsPinToggleOn);
        Assert.False(viewState.Resolution.IsPinEffective);
        Assert.True(viewState.Resolution.HasPinError);
    }

    [Fact]
    public async Task ResolveAsync_MissingPinWithPasswordFallback_ClearsPinAndKeepsPassword()
    {
        var settings = new FakeAppSettingsService
        {
            IsPinProtectionEnabled = true,
            IsPasswordProtectionEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            PinStatus = AppLockCredentialStatus.NotSet,
            PasswordStatus = AppLockCredentialStatus.Set
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.False(settings.IsPinProtectionEnabled);
        Assert.True(settings.IsPasswordProtectionEnabled);
        Assert.Equal(AppLockMode.Password, viewState.Resolution.Mode);
        Assert.False(viewState.IsPinToggleOn);
        Assert.True(viewState.IsPasswordToggleOn);
    }

    [Fact]
    public async Task ResolveAsync_WindowsHelloError_KeepsToggleOn()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            WindowsHelloAvailability = WindowsHelloAvailabilityStatus.Error
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.True(settings.IsWindowsHelloEnabled);
        Assert.True(viewState.IsWindowsHelloToggleOn);
        Assert.False(viewState.Resolution.IsWindowsHelloEffective);
        Assert.True(viewState.Resolution.HasWindowsHelloError);
    }

    [Fact]
    public async Task ResolveAsync_WindowsHelloUnavailable_ClearsToggle()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            WindowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.False(settings.IsWindowsHelloEnabled);
        Assert.False(viewState.IsWindowsHelloToggleOn);
        Assert.Equal(AppLockMode.None, viewState.Resolution.Mode);
    }

    private sealed class FakeAppSettingsService : IAppSettingsService
    {
        public bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
        public bool IsPinProtectionEnabled { get; set; }
        public bool IsPasswordProtectionEnabled { get; set; }
        public bool IsWindowsHelloEnabled { get; set; }
        public int AutoLockTimeoutMinutes { get; set; }
        public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;
    }

    private sealed class FakeAppLockService : IAppLockService
    {
        public AppLockCredentialStatus PinStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public AppLockCredentialStatus PasswordStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public WindowsHelloAvailabilityStatus WindowsHelloAvailability { get; set; } = WindowsHelloAvailabilityStatus.Unavailable;

        public AppLockCredentialStatus GetPinStatus() => PinStatus;

        public AppLockCredentialStatus GetPasswordStatus() => PasswordStatus;

        public Task<bool> SetPinAsync(string pin) => Task.FromResult(true);

        public Task<bool> SetPasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> VerifyPinAsync(string pin) => Task.FromResult(true);

        public Task<bool> VerifyPasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> RemovePinAsync() => Task.FromResult(true);

        public Task<bool> RemovePasswordAsync() => Task.FromResult(true);

        public Task<WindowsHelloAvailabilityStatus> GetWindowsHelloAvailabilityAsync() =>
            Task.FromResult(WindowsHelloAvailability);

        public Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message) =>
            Task.FromResult(new WindowsHelloVerificationOutcome(
                WindowsHelloVerificationStatus.Verified,
                UserConsentVerificationResult.Verified));
    }
}
#pragma warning restore CS0067
