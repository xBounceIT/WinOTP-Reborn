using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using WinOTP.Models;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class AppUpdateServiceTests : IDisposable
{
    private readonly string _updatesDirectoryPath;

    public AppUpdateServiceTests()
    {
        _updatesDirectoryPath = Path.Combine(Path.GetTempPath(), "WinOTP-AppUpdateTests", Guid.NewGuid().ToString("N"));
    }

    [Fact]
    public void SelectAvailableRelease_StableChannel_IgnoresPrereleases()
    {
        var releases = new[]
        {
            CreateRelease("v1.2.0-beta.1", isPreRelease: true, digest: null),
            CreateRelease("v1.1.0", isPreRelease: false, digest: null)
        };

        var result = AppUpdateService.SelectAvailableRelease(releases, "1.0.0", UpdateChannel.Stable, Architecture.X64);

        Assert.NotNull(result);
        Assert.Equal("1.1.0", result!.DisplayVersion);
    }

    [Fact]
    public void SelectAvailableRelease_PreReleaseChannel_CanPickPrerelease()
    {
        var releases = new[]
        {
            CreateRelease("v1.2.0-beta.1", isPreRelease: true, digest: null),
            CreateRelease("v1.1.0", isPreRelease: false, digest: null)
        };

        var result = AppUpdateService.SelectAvailableRelease(releases, "1.0.0", UpdateChannel.PreRelease, Architecture.X64);

        Assert.NotNull(result);
        Assert.Equal("1.2.0-beta.1", result!.DisplayVersion);
    }

    [Fact]
    public void SelectAvailableRelease_SkipsInvalidTagsAndMissingAssets()
    {
        var releases = new[]
        {
            new GitHubReleaseInfo
            {
                TagName = "release-candidate",
                Assets = [CreateAsset("WinOTP-release-candidate-win-x64-setup.exe", null)]
            },
            new GitHubReleaseInfo
            {
                TagName = "v1.3.0",
                Assets = []
            },
            CreateRelease("v1.2.0", isPreRelease: false, digest: null)
        };

        var result = AppUpdateService.SelectAvailableRelease(releases, "1.0.0", UpdateChannel.Stable, Architecture.X64);

        Assert.NotNull(result);
        Assert.Equal("1.2.0", result!.DisplayVersion);
    }

    [Fact]
    public void SelectAvailableRelease_UsesProcessArchitectureForAssetSelection()
    {
        var releases = new[]
        {
            new GitHubReleaseInfo
            {
                TagName = "v1.2.0",
                Name = "1.2.0",
                HtmlUrl = "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.2.0",
                IsDraft = false,
                IsPreRelease = false,
                Assets =
                [
                    CreateAsset("WinOTP-1.2.0-win-x64-setup.exe", null),
                    CreateAsset("WinOTP-1.2.0-win-arm64-setup.exe", null)
                ]
            }
        };

        var x64Result = AppUpdateService.SelectAvailableRelease(releases, "1.0.0", UpdateChannel.Stable, Architecture.X64);
        var arm64Result = AppUpdateService.SelectAvailableRelease(releases, "1.0.0", UpdateChannel.Stable, Architecture.Arm64);

        Assert.NotNull(x64Result);
        Assert.Equal("WinOTP-1.2.0-win-x64-setup.exe", x64Result!.InstallerName);
        Assert.NotNull(arm64Result);
        Assert.Equal("WinOTP-1.2.0-win-arm64-setup.exe", arm64Result!.InstallerName);
    }

    [Fact]
    public async Task InitializeAsync_WithAutomaticChecksDisabled_DoesNotCallNetwork()
    {
        var settings = new FakeAppSettingsService
        {
            IsUpdateCheckEnabled = false
        };
        var handler = new RecordingHttpMessageHandler(_ => throw new InvalidOperationException("Network call was not expected."));
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        await service.InitializeAsync();

        Assert.Equal(0, handler.CallCount);
        Assert.Equal(UpdateAvailabilityStatus.Disabled, service.CurrentState.Status);
    }

    [Fact]
    public async Task DownloadInstallerAsync_WithMatchingDigest_VerifiesDownload()
    {
        var installerBytes = Encoding.UTF8.GetBytes("verified-installer");
        var installerDigest = Convert.ToHexString(SHA256.HashData(installerBytes)).ToLowerInvariant();
        var handler = new RecordingHttpMessageHandler(request =>
        {
            if (request.RequestUri!.AbsoluteUri.Contains("/releases", StringComparison.Ordinal))
            {
                return CreateJsonResponse($$"""
                [
                  {
                    "tag_name": "v1.1.0",
                    "name": "1.1.0",
                    "html_url": "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.1.0",
                    "draft": false,
                    "prerelease": false,
                    "assets": [
                      {
                        "name": "WinOTP-1.1.0-win-x64-setup.exe",
                        "browser_download_url": "https://example.test/WinOTP-1.1.0-win-x64-setup.exe",
                        "digest": "sha256:{{installerDigest}}"
                      }
                    ]
                  }
                ]
                """);
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(installerBytes)
            };
        });
        using var httpClient = new HttpClient(handler);
        var service = CreateService(new FakeAppSettingsService(), httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        var result = await service.DownloadInstallerAsync();

        Assert.True(result.Success);
        Assert.True(result.IsDigestVerified);
        Assert.NotNull(result.FilePath);
        Assert.True(File.Exists(result.FilePath));
        Assert.Equal(UpdateAvailabilityStatus.LaunchReady, service.CurrentState.Status);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ManualNoUpdate_WithAutomaticChecksDisabled_ReportsUpToDate()
    {
        var settings = new FakeAppSettingsService
        {
            IsUpdateCheckEnabled = false
        };
        var handler = new RecordingHttpMessageHandler(_ => CreateJsonResponse("[]"));
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);

        Assert.Equal(UpdateAvailabilityStatus.UpToDate, service.CurrentState.Status);
        Assert.Equal("You're up to date.", service.CurrentState.StatusMessage);
        Assert.False(service.CurrentState.IsAutomaticCheckEnabled);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ManualFailure_WithAutomaticChecksDisabled_ReportsError()
    {
        var settings = new FakeAppSettingsService
        {
            IsUpdateCheckEnabled = false
        };
        var handler = new RecordingHttpMessageHandler(_ => throw new HttpRequestException("offline"));
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);

        Assert.Equal(UpdateAvailabilityStatus.Error, service.CurrentState.Status);
        Assert.Equal("Couldn't check for updates.", service.CurrentState.StatusMessage);
        Assert.Equal("offline", service.CurrentState.LastError);
        Assert.False(service.CurrentState.IsAutomaticCheckEnabled);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ChannelChangedNoUpdate_WithAutomaticChecksDisabled_ReportsUpToDate()
    {
        var settings = new FakeAppSettingsService
        {
            IsUpdateCheckEnabled = false
        };
        var handler = new RecordingHttpMessageHandler(_ => CreateJsonResponse("[]"));
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        settings.UpdateChannel = UpdateChannel.PreRelease;
        await service.CheckForUpdatesAsync(UpdateCheckTrigger.ChannelChanged);

        Assert.Equal(UpdateChannel.PreRelease, service.CurrentState.SelectedChannel);
        Assert.Equal(UpdateAvailabilityStatus.UpToDate, service.CurrentState.Status);
        Assert.Equal("You're up to date.", service.CurrentState.StatusMessage);
        Assert.False(service.CurrentState.IsAutomaticCheckEnabled);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ChannelChangedFailure_WithAutomaticChecksDisabled_ReportsError()
    {
        var settings = new FakeAppSettingsService
        {
            IsUpdateCheckEnabled = false,
            UpdateChannel = UpdateChannel.PreRelease
        };
        var callCount = 0;
        var handler = new RecordingHttpMessageHandler(_ =>
        {
            callCount++;
            return callCount == 1
                ? CreateJsonResponse("""
                [
                  {
                    "tag_name": "v1.2.0-beta.1",
                    "name": "1.2.0-beta.1",
                    "html_url": "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.2.0-beta.1",
                    "draft": false,
                    "prerelease": true,
                    "assets": [
                      {
                        "name": "WinOTP-1.2.0-beta.1-win-x64-setup.exe",
                        "browser_download_url": "https://example.test/WinOTP-1.2.0-beta.1-win-x64-setup.exe"
                      }
                    ]
                  }
                ]
                """)
                : throw new HttpRequestException("offline");
        });
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        Assert.True(service.CurrentState.IsUpdateAvailable);

        settings.UpdateChannel = UpdateChannel.Stable;
        await service.CheckForUpdatesAsync(UpdateCheckTrigger.ChannelChanged);

        Assert.Equal(UpdateChannel.Stable, service.CurrentState.SelectedChannel);
        Assert.False(service.CurrentState.IsUpdateAvailable);
        Assert.Null(service.CurrentState.AvailableUpdate);
        Assert.Null(service.CurrentState.DownloadedInstallerPath);
        Assert.False(service.CurrentState.IsDownloadedAssetDigestVerified);
        Assert.Equal(UpdateAvailabilityStatus.Error, service.CurrentState.Status);
        Assert.Equal("Couldn't check for updates.", service.CurrentState.StatusMessage);
        Assert.Equal("offline", service.CurrentState.LastError);
        Assert.False(service.CurrentState.IsAutomaticCheckEnabled);
    }

    [Fact]
    public async Task DownloadInstallerAsync_WithoutDigest_AllowsLaunch()
    {
        var installerBytes = Encoding.UTF8.GetBytes("unsigned-installer");
        var handler = new RecordingHttpMessageHandler(request =>
        {
            if (request.RequestUri!.AbsoluteUri.Contains("/releases", StringComparison.Ordinal))
            {
                return CreateJsonResponse("""
                [
                  {
                    "tag_name": "v1.1.0",
                    "name": "1.1.0",
                    "html_url": "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.1.0",
                    "draft": false,
                    "prerelease": false,
                    "assets": [
                      {
                        "name": "WinOTP-1.1.0-win-x64-setup.exe",
                        "browser_download_url": "https://example.test/WinOTP-1.1.0-win-x64-setup.exe"
                      }
                    ]
                  }
                ]
                """);
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(installerBytes)
            };
        });
        using var httpClient = new HttpClient(handler);
        ProcessStartInfo? capturedStartInfo = null;
        var service = CreateService(
            new FakeAppSettingsService(),
            httpClient,
            handler,
            startInfo =>
            {
                capturedStartInfo = startInfo;
                return Process.GetCurrentProcess();
            });

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        var download = await service.DownloadInstallerAsync();
        var launch = await service.LaunchInstallerAsync(download);

        Assert.True(download.Success);
        Assert.False(download.IsDigestVerified);
        Assert.True(launch.Success);
        Assert.NotNull(capturedStartInfo);
        Assert.Equal("/CURRENTUSER /SP- /LOG", capturedStartInfo!.Arguments);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ChannelChangedFailure_ClearsCachedUpdate()
    {
        var settings = new FakeAppSettingsService
        {
            UpdateChannel = UpdateChannel.PreRelease
        };
        var callCount = 0;
        var handler = new RecordingHttpMessageHandler(_ =>
        {
            callCount++;
            return callCount == 1
                ? CreateJsonResponse("""
                [
                  {
                    "tag_name": "v1.2.0-beta.1",
                    "name": "1.2.0-beta.1",
                    "html_url": "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.2.0-beta.1",
                    "draft": false,
                    "prerelease": true,
                    "assets": [
                      {
                        "name": "WinOTP-1.2.0-beta.1-win-x64-setup.exe",
                        "browser_download_url": "https://example.test/WinOTP-1.2.0-beta.1-win-x64-setup.exe"
                      }
                    ]
                  }
                ]
                """)
                : throw new HttpRequestException("offline");
        });
        using var httpClient = new HttpClient(handler);
        var service = CreateService(settings, httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        Assert.True(service.CurrentState.IsUpdateAvailable);
        Assert.NotNull(service.CurrentState.AvailableUpdate);

        settings.UpdateChannel = UpdateChannel.Stable;
        await service.CheckForUpdatesAsync(UpdateCheckTrigger.ChannelChanged);

        Assert.Equal(UpdateChannel.Stable, service.CurrentState.SelectedChannel);
        Assert.False(service.CurrentState.IsUpdateAvailable);
        Assert.Null(service.CurrentState.AvailableUpdate);
        Assert.Null(service.CurrentState.DownloadedInstallerPath);
        Assert.False(service.CurrentState.IsDownloadedAssetDigestVerified);
        Assert.Equal(UpdateAvailabilityStatus.Error, service.CurrentState.Status);
        Assert.Equal("offline", service.CurrentState.LastError);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_ManualFailure_PreservesCachedUpdate()
    {
        var callCount = 0;
        var handler = new RecordingHttpMessageHandler(_ =>
        {
            callCount++;
            return callCount == 1
                ? CreateJsonResponse("""
                [
                  {
                    "tag_name": "v1.1.0",
                    "name": "1.1.0",
                    "html_url": "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v1.1.0",
                    "draft": false,
                    "prerelease": false,
                    "assets": [
                      {
                        "name": "WinOTP-1.1.0-win-x64-setup.exe",
                        "browser_download_url": "https://example.test/WinOTP-1.1.0-win-x64-setup.exe"
                      }
                    ]
                  }
                ]
                """)
                : throw new HttpRequestException("offline");
        });
        using var httpClient = new HttpClient(handler);
        var service = CreateService(new FakeAppSettingsService(), httpClient, handler);

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);
        var cachedUpdate = service.CurrentState.AvailableUpdate;

        await service.CheckForUpdatesAsync(UpdateCheckTrigger.Manual);

        Assert.True(service.CurrentState.IsUpdateAvailable);
        Assert.NotNull(service.CurrentState.AvailableUpdate);
        Assert.Equal(cachedUpdate, service.CurrentState.AvailableUpdate);
        Assert.Equal(UpdateAvailabilityStatus.UpdateAvailable, service.CurrentState.Status);
        Assert.Equal("offline", service.CurrentState.LastError);
    }

    public void Dispose()
    {
        if (Directory.Exists(_updatesDirectoryPath))
        {
            Directory.Delete(_updatesDirectoryPath, true);
        }
    }

    private AppUpdateService CreateService(
        FakeAppSettingsService settings,
        HttpClient httpClient,
        RecordingHttpMessageHandler handler,
        Func<ProcessStartInfo, Process?>? processStarter = null)
    {
        _ = handler;

        return new AppUpdateService(
            settings,
            new FakeAppLogger(),
            httpClient,
            ownsHttpClient: false,
            currentVersionProvider: () => "1.0.0",
            architectureProvider: () => Architecture.X64,
            updatesDirectoryProvider: () => _updatesDirectoryPath,
            processStarter: processStarter ?? (_ => Process.GetCurrentProcess()));
    }

    private static GitHubReleaseInfo CreateRelease(string tagName, bool isPreRelease, string? digest)
    {
        var normalizedTag = tagName.TrimStart('v', 'V');
        return new GitHubReleaseInfo
        {
            TagName = tagName,
            Name = normalizedTag,
            HtmlUrl = $"https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/{tagName}",
            IsDraft = false,
            IsPreRelease = isPreRelease,
            Assets = [CreateAsset($"WinOTP-{normalizedTag}-win-x64-setup.exe", digest)]
        };
    }

    private static GitHubReleaseAssetInfo CreateAsset(string name, string? digest)
    {
        return new GitHubReleaseAssetInfo
        {
            Name = name,
            BrowserDownloadUrl = $"https://example.test/{name}",
            Digest = digest
        };
    }

    private static HttpResponseMessage CreateJsonResponse(string content)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(content, Encoding.UTF8, "application/json")
        };
    }

    private sealed class RecordingHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            _ = cancellationToken;
            CallCount++;
            return Task.FromResult(responder(request));
        }
    }

    private sealed class FakeAppSettingsService : IAppSettingsService
    {
        private bool _isUpdateCheckEnabled = true;
        private UpdateChannel _updateChannel = UpdateChannel.Stable;

        public bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
        public bool IsPinProtectionEnabled { get; set; }
        public bool IsPasswordProtectionEnabled { get; set; }
        public bool IsWindowsHelloEnabled { get; set; }
        public int AutoLockTimeoutMinutes { get; set; }
        public bool IsAutomaticBackupEnabled { get; set; }
        public string CustomBackupFolderPath { get; set; } = string.Empty;

        public bool IsUpdateCheckEnabled
        {
            get => _isUpdateCheckEnabled;
            set
            {
                if (_isUpdateCheckEnabled == value)
                {
                    return;
                }

                _isUpdateCheckEnabled = value;
                SettingsChanged?.Invoke(this, new AppSettingsChangedEventArgs(nameof(IsUpdateCheckEnabled)));
            }
        }

        public UpdateChannel UpdateChannel
        {
            get => _updateChannel;
            set
            {
                if (_updateChannel == value)
                {
                    return;
                }

                _updateChannel = value;
                SettingsChanged?.Invoke(this, new AppSettingsChangedEventArgs(nameof(UpdateChannel)));
            }
        }

        public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;
    }

    private sealed class FakeAppLogger : IAppLogger
    {
        public void Info(string message)
        {
            _ = message;
        }

        public void Warn(string message)
        {
            _ = message;
        }

        public void Error(string message, Exception? ex = null)
        {
            _ = message;
            _ = ex;
        }
    }
}
