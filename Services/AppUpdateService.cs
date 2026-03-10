using System.Diagnostics;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using NuGet.Versioning;
using WinOTP.Helpers;
using WinOTP.Models;

namespace WinOTP.Services;

public interface IAppUpdateService
{
    UpdateState CurrentState { get; }
    event EventHandler<UpdateStateChangedEventArgs>? StateChanged;
    Task InitializeAsync();
    Task CheckForUpdatesAsync(UpdateCheckTrigger trigger, CancellationToken cancellationToken = default);
    Task<UpdateDownloadResult> DownloadInstallerAsync(CancellationToken cancellationToken = default);
    Task<UpdateInstallLaunchResult> LaunchInstallerAsync(UpdateDownloadResult downloadResult, CancellationToken cancellationToken = default);
}

public sealed class UpdateStateChangedEventArgs(UpdateState state) : EventArgs
{
    public UpdateState State { get; } = state;
}

public enum UpdateCheckTrigger
{
    Startup,
    Manual,
    ChannelChanged
}

public enum UpdateAvailabilityStatus
{
    Idle,
    Checking,
    UpToDate,
    UpdateAvailable,
    Downloading,
    LaunchReady,
    Error,
    Disabled
}

public sealed record AvailableUpdateInfo(
    NuGetVersion Version,
    string ReleaseTag,
    string ReleaseTitle,
    string ReleaseUrl,
    bool IsPreRelease,
    DateTimeOffset? PublishedAtUtc,
    string InstallerName,
    string InstallerUrl,
    string? InstallerSha256,
    string ReleaseNotes)
{
    public string DisplayVersion => Version.ToNormalizedString();
}

public sealed record UpdateState(
    string CurrentVersion,
    UpdateChannel SelectedChannel,
    UpdateAvailabilityStatus Status,
    bool IsUpdateAvailable,
    bool IsBusy,
    bool IsAutomaticCheckEnabled,
    string StatusMessage,
    DateTimeOffset? LastCheckedUtc,
    AvailableUpdateInfo? AvailableUpdate,
    string? DownloadedInstallerPath,
    bool IsDownloadedAssetDigestVerified,
    string? LastError);

public sealed record UpdateDownloadResult(
    bool Success,
    string? FilePath,
    bool IsDigestVerified,
    AvailableUpdateInfo? Update,
    string? ErrorMessage);

public sealed record UpdateInstallLaunchResult(
    bool Success,
    string? ErrorMessage);

public sealed class AppUpdateService : IAppUpdateService, IDisposable
{
    private const string ReleaseApiUrl = "https://api.github.com/repos/xBounceIT/WinOTP-Reborn/releases";
    private const int ReleasePageSize = 100;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly object _stateSync = new();
    private readonly SemaphoreSlim _operationLock = new(1, 1);
    private readonly IAppSettingsService _settings;
    private readonly IAppLogger _logger;
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly Func<string> _currentVersionProvider;
    private readonly Func<Architecture> _architectureProvider;
    private readonly Func<string> _updatesDirectoryProvider;
    private readonly Func<ProcessStartInfo, Process?> _processStarter;
    private UpdateState _currentState;
    private bool _disposed;

    public AppUpdateService(IAppSettingsService settings, IAppLogger logger)
        : this(
            settings,
            logger,
            new HttpClient(),
            ownsHttpClient: true,
            VersionHelper.GetAppVersion,
            () => RuntimeInformation.ProcessArchitecture,
            AppPaths.GetUpdatesDirectory,
            startInfo => Process.Start(startInfo))
    {
    }

    internal AppUpdateService(
        IAppSettingsService settings,
        IAppLogger logger,
        HttpClient httpClient,
        bool ownsHttpClient,
        Func<string> currentVersionProvider,
        Func<Architecture> architectureProvider,
        Func<string> updatesDirectoryProvider,
        Func<ProcessStartInfo, Process?> processStarter)
    {
        _settings = settings;
        _logger = logger;
        _httpClient = httpClient;
        _ownsHttpClient = ownsHttpClient;
        _currentVersionProvider = currentVersionProvider;
        _architectureProvider = architectureProvider;
        _updatesDirectoryProvider = updatesDirectoryProvider;
        _processStarter = processStarter;
        _currentState = CreateInitialState();

        _settings.SettingsChanged += OnSettingsChanged;
    }

    public UpdateState CurrentState
    {
        get
        {
            lock (_stateSync)
            {
                return _currentState;
            }
        }
    }

    public event EventHandler<UpdateStateChangedEventArgs>? StateChanged;

    public async Task InitializeAsync()
    {
        if (!_settings.IsUpdateCheckEnabled)
        {
            SetState(CurrentState with
            {
                Status = CurrentState.IsUpdateAvailable ? CurrentState.Status : UpdateAvailabilityStatus.Disabled,
                IsAutomaticCheckEnabled = false,
                StatusMessage = CurrentState.IsUpdateAvailable
                    ? BuildAvailableStatusMessage(CurrentState.AvailableUpdate)
                    : "Automatic update checks are turned off."
            });
            return;
        }

        await CheckForUpdatesAsync(UpdateCheckTrigger.Startup);
    }

    public async Task CheckForUpdatesAsync(UpdateCheckTrigger trigger, CancellationToken cancellationToken = default)
    {
        if (trigger == UpdateCheckTrigger.Startup && !_settings.IsUpdateCheckEnabled)
        {
            if (!CurrentState.IsUpdateAvailable)
            {
                SetState(CurrentState with
                {
                    Status = UpdateAvailabilityStatus.Disabled,
                    IsBusy = false,
                    IsAutomaticCheckEnabled = false,
                    StatusMessage = "Automatic update checks are turned off."
                });
            }

            return;
        }

        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            var checkingState = CurrentState with
            {
                SelectedChannel = _settings.UpdateChannel,
                IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
                Status = UpdateAvailabilityStatus.Checking,
                IsBusy = true,
                StatusMessage = "Checking for updates...",
                LastError = null
            };
            SetState(checkingState);

            var releases = await FetchReleasesAsync(cancellationToken);
            var selectedRelease = SelectAvailableRelease(
                releases,
                checkingState.CurrentVersion,
                _settings.UpdateChannel,
                _architectureProvider(),
                _logger);

            var lastCheckedUtc = DateTimeOffset.UtcNow;
            if (selectedRelease is null)
            {
                SetState(CurrentState with
                {
                    SelectedChannel = _settings.UpdateChannel,
                    IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
                    Status = UpdateAvailabilityStatus.UpToDate,
                    IsUpdateAvailable = false,
                    IsBusy = false,
                    StatusMessage = "You're up to date.",
                    LastCheckedUtc = lastCheckedUtc,
                    AvailableUpdate = null,
                    DownloadedInstallerPath = null,
                    IsDownloadedAssetDigestVerified = false,
                    LastError = null
                });
                return;
            }

            SetState(CurrentState with
            {
                SelectedChannel = _settings.UpdateChannel,
                IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
                Status = UpdateAvailabilityStatus.UpdateAvailable,
                IsUpdateAvailable = true,
                IsBusy = false,
                StatusMessage = BuildAvailableStatusMessage(selectedRelease),
                LastCheckedUtc = lastCheckedUtc,
                AvailableUpdate = selectedRelease,
                DownloadedInstallerPath = null,
                IsDownloadedAssetDigestVerified = false,
                LastError = null
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to check for app updates.", ex);

            var current = CurrentState;
            if (trigger == UpdateCheckTrigger.ChannelChanged)
            {
                SetState(current with
                {
                    SelectedChannel = _settings.UpdateChannel,
                    IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
                    Status = UpdateAvailabilityStatus.Error,
                    IsUpdateAvailable = false,
                    IsBusy = false,
                    StatusMessage = "Couldn't check for updates.",
                    LastCheckedUtc = DateTimeOffset.UtcNow,
                    AvailableUpdate = null,
                    DownloadedInstallerPath = null,
                    IsDownloadedAssetDigestVerified = false,
                    LastError = ex.Message
                });

                return;
            }

            var hasKnownUpdate = current.AvailableUpdate is not null;
            SetState(current with
            {
                SelectedChannel = _settings.UpdateChannel,
                IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
                Status = hasKnownUpdate
                    ? UpdateAvailabilityStatus.UpdateAvailable
                    : UpdateAvailabilityStatus.Error,
                IsUpdateAvailable = hasKnownUpdate,
                IsBusy = false,
                StatusMessage = hasKnownUpdate
                    ? BuildAvailableStatusMessage(current.AvailableUpdate)
                    : "Couldn't check for updates.",
                LastCheckedUtc = DateTimeOffset.UtcNow,
                LastError = ex.Message
            });
        }
        finally
        {
            _operationLock.Release();
        }
    }

    public async Task<UpdateDownloadResult> DownloadInstallerAsync(CancellationToken cancellationToken = default)
    {
        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            var current = CurrentState;
            var update = current.AvailableUpdate;
            if (update is null)
            {
                return new UpdateDownloadResult(false, null, false, null, "No update is currently available.");
            }

            var existingFilePath = current.DownloadedInstallerPath;
            if (!string.IsNullOrWhiteSpace(existingFilePath) && File.Exists(existingFilePath))
            {
                var cachedDigestResult = await ValidateDownloadedFileAsync(existingFilePath, update.InstallerSha256, cancellationToken);
                if (cachedDigestResult.IsValid)
                {
                    SetState(current with
                    {
                        Status = UpdateAvailabilityStatus.LaunchReady,
                        IsBusy = false,
                        StatusMessage = "Installer ready to launch.",
                        IsDownloadedAssetDigestVerified = cachedDigestResult.IsDigestVerified,
                        LastError = null
                    });

                    return new UpdateDownloadResult(true, existingFilePath, cachedDigestResult.IsDigestVerified, update, null);
                }

                TryDeleteFile(existingFilePath);
            }

            SetState(current with
            {
                Status = UpdateAvailabilityStatus.Downloading,
                IsBusy = true,
                StatusMessage = "Downloading installer...",
                LastError = null
            });

            var updatesDirectory = _updatesDirectoryProvider();
            Directory.CreateDirectory(updatesDirectory);
            CleanupOldInstallers(updatesDirectory, update.InstallerName);

            var finalPath = Path.Combine(updatesDirectory, update.InstallerName);
            var tempPath = finalPath + ".download";

            TryDeleteFile(tempPath);

            using var request = CreateRequest(HttpMethod.Get, update.InstallerUrl, CurrentState.CurrentVersion);
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            await using (var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var fileStream = File.Create(tempPath))
            {
                await responseStream.CopyToAsync(fileStream, cancellationToken);
            }

            if (File.Exists(finalPath))
            {
                TryDeleteFile(finalPath);
            }

            File.Move(tempPath, finalPath);

            var digestResult = await ValidateDownloadedFileAsync(finalPath, update.InstallerSha256, cancellationToken);
            if (!digestResult.IsValid)
            {
                TryDeleteFile(finalPath);
                SetState(CurrentState with
                {
                    Status = UpdateAvailabilityStatus.UpdateAvailable,
                    IsBusy = false,
                    StatusMessage = BuildAvailableStatusMessage(update),
                    DownloadedInstallerPath = null,
                    IsDownloadedAssetDigestVerified = false,
                    LastError = digestResult.ErrorMessage
                });

                return new UpdateDownloadResult(false, null, false, update, digestResult.ErrorMessage);
            }

            _logger.Info($"Downloaded installer asset {update.InstallerName} to {finalPath}.");

            SetState(CurrentState with
            {
                Status = UpdateAvailabilityStatus.LaunchReady,
                IsBusy = false,
                StatusMessage = "Installer ready to launch.",
                DownloadedInstallerPath = finalPath,
                IsDownloadedAssetDigestVerified = digestResult.IsDigestVerified,
                LastError = null
            });

            return new UpdateDownloadResult(true, finalPath, digestResult.IsDigestVerified, update, null);
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to download the update installer.", ex);
            var current = CurrentState;
            SetState(current with
            {
                Status = current.AvailableUpdate is null ? UpdateAvailabilityStatus.Error : UpdateAvailabilityStatus.UpdateAvailable,
                IsBusy = false,
                StatusMessage = current.AvailableUpdate is null
                    ? "Couldn't download the update installer."
                    : BuildAvailableStatusMessage(current.AvailableUpdate),
                LastError = ex.Message
            });

            return new UpdateDownloadResult(false, null, false, current.AvailableUpdate, ex.Message);
        }
        finally
        {
            _operationLock.Release();
        }
    }

    public async Task<UpdateInstallLaunchResult> LaunchInstallerAsync(
        UpdateDownloadResult downloadResult,
        CancellationToken cancellationToken = default)
    {
        if (!downloadResult.Success || string.IsNullOrWhiteSpace(downloadResult.FilePath))
        {
            return new UpdateInstallLaunchResult(false, downloadResult.ErrorMessage ?? "The installer is not ready.");
        }

        if (!File.Exists(downloadResult.FilePath))
        {
            return new UpdateInstallLaunchResult(false, "The downloaded installer could not be found.");
        }

        try
        {
            var current = CurrentState;
            var update = downloadResult.Update ?? current.AvailableUpdate;
            var expectedSha256 = update?.InstallerSha256;
            if (!string.IsNullOrWhiteSpace(expectedSha256))
            {
                var digestResult = await ValidateDownloadedFileAsync(downloadResult.FilePath, expectedSha256, cancellationToken);
                if (!digestResult.IsValid)
                {
                    TryDeleteFile(downloadResult.FilePath);

                    if (update is not null)
                    {
                        SetState(current with
                        {
                            Status = UpdateAvailabilityStatus.UpdateAvailable,
                            IsUpdateAvailable = true,
                            IsBusy = false,
                            StatusMessage = BuildAvailableStatusMessage(update),
                            AvailableUpdate = update,
                            DownloadedInstallerPath = null,
                            IsDownloadedAssetDigestVerified = false,
                            LastError = digestResult.ErrorMessage
                        });
                    }
                    else
                    {
                        SetState(current with
                        {
                            Status = UpdateAvailabilityStatus.Error,
                            IsUpdateAvailable = false,
                            IsBusy = false,
                            StatusMessage = "The installer is not ready.",
                            AvailableUpdate = null,
                            DownloadedInstallerPath = null,
                            IsDownloadedAssetDigestVerified = false,
                            LastError = digestResult.ErrorMessage
                        });
                    }

                    return new UpdateInstallLaunchResult(false, digestResult.ErrorMessage);
                }
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = downloadResult.FilePath,
                Arguments = "/CURRENTUSER /SP- /LOG",
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(downloadResult.FilePath)
            };

            var process = _processStarter(startInfo);
            if (process is null)
            {
                return new UpdateInstallLaunchResult(false, "The installer could not be started.");
            }

            _logger.Info($"Launched installer {downloadResult.FilePath}.");
            return new UpdateInstallLaunchResult(true, null);
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to launch the update installer.", ex);
            SetState(CurrentState with
            {
                Status = CurrentState.AvailableUpdate is null ? UpdateAvailabilityStatus.Error : UpdateAvailabilityStatus.LaunchReady,
                IsBusy = false,
                LastError = ex.Message
            });

            return new UpdateInstallLaunchResult(false, ex.Message);
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _settings.SettingsChanged -= OnSettingsChanged;
        _operationLock.Dispose();

        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }

    internal static AvailableUpdateInfo? SelectAvailableRelease(
        IReadOnlyList<GitHubReleaseInfo> releases,
        string currentVersion,
        UpdateChannel channel,
        Architecture architecture,
        IAppLogger? logger = null)
    {
        var currentAppVersion = ParseVersion(currentVersion);
        var assetRuntime = architecture switch
        {
            Architecture.X64 => "win-x64",
            Architecture.Arm64 => "win-arm64",
            _ => throw new NotSupportedException($"Updates are not supported on architecture '{architecture}'.")
        };

        AvailableUpdateInfo? bestMatch = null;
        foreach (var release in releases)
        {
            if (release.IsDraft)
            {
                logger?.Info($"Skipping draft release '{release.TagName}'.");
                continue;
            }

            if (channel == UpdateChannel.Stable && release.IsPreRelease)
            {
                logger?.Info($"Skipping prerelease '{release.TagName}' on stable channel.");
                continue;
            }

            if (!TryParseVersion(release.TagName, out var releaseVersion) || releaseVersion is null)
            {
                logger?.Warn($"Skipping release '{release.TagName}' because the tag is not valid semantic versioning.");
                continue;
            }

            if (releaseVersion <= currentAppVersion)
            {
                continue;
            }

            var expectedAssetName = $"WinOTP-{releaseVersion.ToNormalizedString()}-{assetRuntime}-setup.exe";
            var asset = release.Assets.FirstOrDefault(candidate =>
                string.Equals(candidate.Name, expectedAssetName, StringComparison.OrdinalIgnoreCase));

            if (asset is null)
            {
                logger?.Warn($"Skipping release '{release.TagName}' because asset '{expectedAssetName}' is missing.");
                continue;
            }

            if (bestMatch is not null && releaseVersion <= bestMatch.Version)
            {
                continue;
            }

            bestMatch = new AvailableUpdateInfo(
                releaseVersion,
                release.TagName,
                string.IsNullOrWhiteSpace(release.Name) ? releaseVersion.ToNormalizedString() : release.Name,
                release.HtmlUrl,
                release.IsPreRelease,
                release.PublishedAt,
                asset.Name,
                asset.BrowserDownloadUrl,
                NormalizeSha256Digest(asset.Digest),
                release.Body ?? string.Empty);
        }

        return bestMatch;
    }

    internal static bool TryParseVersion(string rawVersion, out NuGetVersion? version)
    {
        return NuGetVersion.TryParse(VersionHelper.NormalizeVersionString(rawVersion), out version);
    }

    private static NuGetVersion ParseVersion(string rawVersion)
    {
        if (!TryParseVersion(rawVersion, out var version) || version is null)
        {
            throw new InvalidOperationException($"The current app version '{rawVersion}' is not a valid semantic version.");
        }

        return version;
    }

    private static string? NormalizeSha256Digest(string? digest)
    {
        if (string.IsNullOrWhiteSpace(digest))
        {
            return null;
        }

        const string prefix = "sha256:";
        return digest.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? digest[prefix.Length..]
            : null;
    }

    private static string BuildAvailableStatusMessage(AvailableUpdateInfo? update)
    {
        return update is null
            ? "Update available."
            : $"Version {update.DisplayVersion} is available.";
    }

    private async Task<IReadOnlyList<GitHubReleaseInfo>> FetchReleasesAsync(CancellationToken cancellationToken)
    {
        var releases = new List<GitHubReleaseInfo>();
        var visitedPageUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var nextPageUrl = $"{ReleaseApiUrl}?per_page={ReleasePageSize}";

        while (!string.IsNullOrWhiteSpace(nextPageUrl))
        {
            if (!visitedPageUrls.Add(nextPageUrl))
            {
                throw new HttpRequestException($"GitHub releases pagination repeated page '{nextPageUrl}'.");
            }

            using var request = CreateRequest(HttpMethod.Get, nextPageUrl, CurrentState.CurrentVersion);
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var page = await JsonSerializer.DeserializeAsync<List<GitHubReleaseInfo>>(stream, JsonOptions, cancellationToken);
            if (page is not null)
            {
                releases.AddRange(page);
            }

            nextPageUrl = GetNextPageUrl(response);
        }

        return releases;
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, string url, string currentVersion)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        request.Headers.UserAgent.ParseAdd($"WinOTP/{currentVersion}");
        return request;
    }

    private static string? GetNextPageUrl(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Link", out var linkHeaderValues))
        {
            return null;
        }

        foreach (var linkHeaderValue in linkHeaderValues)
        {
            foreach (var segment in linkHeaderValue.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var parts = segment.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (parts.Length < 2)
                {
                    continue;
                }

                var target = parts[0];
                if (!target.StartsWith('<') || !target.EndsWith('>'))
                {
                    continue;
                }

                var isNext = parts
                    .Skip(1)
                    .Any(part => string.Equals(part, "rel=\"next\"", StringComparison.OrdinalIgnoreCase));

                if (isNext)
                {
                    return target[1..^1];
                }
            }
        }

        return null;
    }

    private async Task<(bool IsValid, bool IsDigestVerified, string? ErrorMessage)> ValidateDownloadedFileAsync(
        string filePath,
        string? expectedSha256,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(expectedSha256))
        {
            return (true, false, null);
        }

        await using var fileStream = File.OpenRead(filePath);
        var hash = await SHA256.HashDataAsync(fileStream, cancellationToken);
        var actualHash = Convert.ToHexString(hash);

        if (!string.Equals(actualHash, expectedSha256, StringComparison.OrdinalIgnoreCase))
        {
            var message = "The downloaded installer failed SHA-256 verification.";
            _logger.Warn(message);
            return (false, false, message);
        }

        return (true, true, null);
    }

    private UpdateState CreateInitialState()
    {
        var currentVersion = _currentVersionProvider();
        return new UpdateState(
            CurrentVersion: currentVersion,
            SelectedChannel: _settings.UpdateChannel,
            Status: _settings.IsUpdateCheckEnabled ? UpdateAvailabilityStatus.Idle : UpdateAvailabilityStatus.Disabled,
            IsUpdateAvailable: false,
            IsBusy: false,
            IsAutomaticCheckEnabled: _settings.IsUpdateCheckEnabled,
            StatusMessage: _settings.IsUpdateCheckEnabled
                ? "Ready to check for updates."
                : "Automatic update checks are turned off.",
            LastCheckedUtc: null,
            AvailableUpdate: null,
            DownloadedInstallerPath: null,
            IsDownloadedAssetDigestVerified: false,
            LastError: null);
    }

    private void OnSettingsChanged(object? sender, AppSettingsChangedEventArgs e)
    {
        if (e.PropertyName == nameof(IAppSettingsService.UpdateChannel))
        {
            SetState(CurrentState with
            {
                SelectedChannel = _settings.UpdateChannel
            });
            return;
        }

        if (e.PropertyName != nameof(IAppSettingsService.IsUpdateCheckEnabled))
        {
            return;
        }

        var current = CurrentState with
        {
            IsAutomaticCheckEnabled = _settings.IsUpdateCheckEnabled,
            Status = !_settings.IsUpdateCheckEnabled && CurrentState.LastCheckedUtc is null && CurrentState.AvailableUpdate is null
                ? UpdateAvailabilityStatus.Disabled
                : CurrentState.Status,
            StatusMessage = !_settings.IsUpdateCheckEnabled && CurrentState.LastCheckedUtc is null && CurrentState.AvailableUpdate is null
                ? "Automatic update checks are turned off."
                : CurrentState.StatusMessage
        };

        if (_settings.IsUpdateCheckEnabled && current.Status == UpdateAvailabilityStatus.Disabled)
        {
            current = current with
            {
                Status = UpdateAvailabilityStatus.Idle,
                StatusMessage = "Ready to check for updates."
            };
        }

        SetState(current);
    }

    private void SetState(UpdateState nextState)
    {
        lock (_stateSync)
        {
            _currentState = nextState;
        }

        StateChanged?.Invoke(this, new UpdateStateChangedEventArgs(nextState));
    }

    private static void TryDeleteFile(string filePath)
    {
        try
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
        catch
        {
            // Best-effort cleanup only.
        }
    }

    private void CleanupOldInstallers(string updatesDirectory, string currentInstallerName)
    {
        try
        {
            foreach (var file in Directory.GetFiles(updatesDirectory, "*.exe"))
            {
                var fileName = Path.GetFileName(file);
                if (!string.Equals(fileName, currentInstallerName, StringComparison.OrdinalIgnoreCase))
                {
                    TryDeleteFile(file);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.Warn($"Failed to clean up old installers: {ex.Message}");
        }
    }
}

public sealed class GitHubReleaseInfo
{
    [JsonPropertyName("tag_name")]
    public string TagName { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("html_url")]
    public string HtmlUrl { get; set; } = string.Empty;

    [JsonPropertyName("body")]
    public string? Body { get; set; }

    [JsonPropertyName("draft")]
    public bool IsDraft { get; set; }

    [JsonPropertyName("prerelease")]
    public bool IsPreRelease { get; set; }

    [JsonPropertyName("published_at")]
    public DateTimeOffset? PublishedAt { get; set; }

    [JsonPropertyName("assets")]
    public List<GitHubReleaseAssetInfo> Assets { get; set; } = [];
}

public sealed class GitHubReleaseAssetInfo
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("browser_download_url")]
    public string BrowserDownloadUrl { get; set; } = string.Empty;

    [JsonPropertyName("digest")]
    public string? Digest { get; set; }
}
