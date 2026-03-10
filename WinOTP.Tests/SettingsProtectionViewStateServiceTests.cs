#pragma warning disable CS0067
using Windows.Security.Credentials.UI;
using WinOTP.Models;
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
    public async Task ResolveAsync_WindowsHelloUnavailable_ClearsToggleAndRemoteFallback()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = true,
            IsWindowsHelloRemotePinEnabled = true,
            IsWindowsHelloRemotePasswordEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            WindowsHelloAvailability = WindowsHelloAvailabilityStatus.Unavailable
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.False(settings.IsWindowsHelloEnabled);
        Assert.False(settings.IsWindowsHelloRemotePinEnabled);
        Assert.False(settings.IsWindowsHelloRemotePasswordEnabled);
        Assert.False(viewState.IsWindowsHelloToggleOn);
        Assert.False(viewState.IsWindowsHelloRemotePinToggleOn);
        Assert.False(viewState.IsWindowsHelloRemotePasswordToggleOn);
        Assert.Equal(1, appLock.RemoveWindowsHelloRemotePinCallCount);
        Assert.Equal(1, appLock.RemoveWindowsHelloRemotePasswordCallCount);
        Assert.Equal(AppLockMode.None, viewState.Resolution.Mode);
    }

    [Fact]
    public async Task ResolveAsync_WindowsHelloRemoteSession_KeepsToggleOn()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            WindowsHelloAvailability = WindowsHelloAvailabilityStatus.RemoteSession
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.True(settings.IsWindowsHelloEnabled);
        Assert.True(viewState.IsWindowsHelloToggleOn);
        Assert.False(viewState.Resolution.IsWindowsHelloEffective);
        Assert.True(viewState.Resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public async Task ResolveAsync_MissingWindowsHelloRemotePin_ClearsOnlyRemotePinToggle()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = true,
            IsWindowsHelloRemotePinEnabled = true
        };
        var appLock = new FakeAppLockService
        {
            WindowsHelloAvailability = WindowsHelloAvailabilityStatus.RemoteSession,
            WindowsHelloRemotePinStatus = AppLockCredentialStatus.NotSet
        };

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.True(settings.IsWindowsHelloEnabled);
        Assert.False(settings.IsWindowsHelloRemotePinEnabled);
        Assert.False(viewState.IsWindowsHelloRemotePinToggleOn);
        Assert.Equal(1, appLock.RemoveWindowsHelloRemotePinCallCount);
        Assert.True(viewState.IsWindowsHelloToggleOn);
        Assert.True(viewState.Resolution.HasWindowsHelloRemoteSession);
    }

    [Fact]
    public async Task ResolveAsync_WindowsHelloDisabled_ClearsRemoteFallback()
    {
        var settings = new FakeAppSettingsService
        {
            IsWindowsHelloEnabled = false,
            IsWindowsHelloRemotePinEnabled = true,
            IsWindowsHelloRemotePasswordEnabled = true
        };
        var appLock = new FakeAppLockService();

        var viewState = await SettingsProtectionViewStateService.ResolveAsync(settings, appLock);

        Assert.False(settings.IsWindowsHelloRemotePinEnabled);
        Assert.False(settings.IsWindowsHelloRemotePasswordEnabled);
        Assert.False(viewState.IsWindowsHelloRemotePinToggleOn);
        Assert.False(viewState.IsWindowsHelloRemotePasswordToggleOn);
        Assert.Equal(1, appLock.RemoveWindowsHelloRemotePinCallCount);
        Assert.Equal(1, appLock.RemoveWindowsHelloRemotePasswordCallCount);
    }

    private sealed class FakeAppSettingsService : IAppSettingsService
    {
        public bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
        public SortOption AccountSortOption { get; set; } = SortOption.DateAddedDesc;
        public bool IsPinProtectionEnabled { get; set; }
        public bool IsPasswordProtectionEnabled { get; set; }
        public bool IsWindowsHelloEnabled { get; set; }
        public bool IsWindowsHelloRemotePinEnabled { get; set; }
        public bool IsWindowsHelloRemotePasswordEnabled { get; set; }
        public int AutoLockTimeoutMinutes { get; set; }
        public bool IsAutomaticBackupEnabled { get; set; }
        public string CustomBackupFolderPath { get; set; } = string.Empty;
        public bool IsUpdateCheckEnabled { get; set; } = true;
        public UpdateChannel UpdateChannel { get; set; } = UpdateChannel.Stable;
        public bool MinimizeOnClose { get; set; }
        public bool MinimizeToTrayOnClose { get; set; }
        public bool ShowTotpInTrayMenu { get; set; }
        public bool AutoStartOnBoot { get; set; }
        public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;
    }

    private sealed class FakeAppLockService : IAppLockService
    {
        public AppLockCredentialStatus PinStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public AppLockCredentialStatus PasswordStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public AppLockCredentialStatus WindowsHelloRemotePinStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public AppLockCredentialStatus WindowsHelloRemotePasswordStatus { get; set; } = AppLockCredentialStatus.NotSet;
        public WindowsHelloAvailabilityStatus WindowsHelloAvailability { get; set; } = WindowsHelloAvailabilityStatus.Unavailable;
        public int RemoveWindowsHelloRemotePinCallCount { get; private set; }
        public int RemoveWindowsHelloRemotePasswordCallCount { get; private set; }

        public AppLockCredentialStatus GetPinStatus() => PinStatus;

        public AppLockCredentialStatus GetPasswordStatus() => PasswordStatus;

        public AppLockCredentialStatus GetWindowsHelloRemotePinStatus() => WindowsHelloRemotePinStatus;

        public AppLockCredentialStatus GetWindowsHelloRemotePasswordStatus() => WindowsHelloRemotePasswordStatus;

        public Task<bool> SetPinAsync(string pin) => Task.FromResult(true);

        public Task<bool> SetPasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> SetWindowsHelloRemotePinAsync(string pin) => Task.FromResult(true);

        public Task<bool> SetWindowsHelloRemotePasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> VerifyPinAsync(string pin) => Task.FromResult(true);

        public Task<bool> VerifyPasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> VerifyWindowsHelloRemotePinAsync(string pin) => Task.FromResult(true);

        public Task<bool> VerifyWindowsHelloRemotePasswordAsync(string password) => Task.FromResult(true);

        public Task<bool> RemovePinAsync() => Task.FromResult(true);

        public Task<bool> RemovePasswordAsync() => Task.FromResult(true);

        public Task<bool> RemoveWindowsHelloRemotePinAsync()
        {
            RemoveWindowsHelloRemotePinCallCount++;
            return Task.FromResult(true);
        }

        public Task<bool> RemoveWindowsHelloRemotePasswordAsync()
        {
            RemoveWindowsHelloRemotePasswordCallCount++;
            return Task.FromResult(true);
        }

        public Task<WindowsHelloAvailabilityStatus> GetWindowsHelloAvailabilityAsync() =>
            Task.FromResult(WindowsHelloAvailability);

        public Task<WindowsHelloVerificationOutcome> VerifyWindowsHelloAsync(string message, IntPtr ownerWindowHandle) =>
            Task.FromResult(new WindowsHelloVerificationOutcome(
                WindowsHelloVerificationStatus.Verified,
                UserConsentVerificationResult.Verified));
    }
}
#pragma warning restore CS0067
