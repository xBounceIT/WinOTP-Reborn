use chrono::{DateTime, Utc};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

const RELEASE_API_URL: &str = "https://api.github.com/repos/xBounceIT/WinOTP-Reborn/releases";
const RELEASE_PAGE_SIZE: u32 = 100;
const MAX_RESPONSE_BODY_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateChannel {
    #[serde(rename = "Stable")]
    Stable,
    #[serde(rename = "Pre-release")]
    PreRelease,
}

impl UpdateChannel {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "pre-release" | "prerelease" | "pre_release" => Self::PreRelease,
            _ => Self::Stable,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateAvailabilityStatus {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "checking")]
    Checking,
    #[serde(rename = "upToDate")]
    UpToDate,
    #[serde(rename = "updateAvailable")]
    UpdateAvailable,
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "launchReady")]
    LaunchReady,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "disabled")]
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppPlatform {
    Windows,
    Linux,
    MacOs,
    Unknown,
}

impl AppPlatform {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "win32" | "windows" => Self::Windows,
            "linux" => Self::Linux,
            "darwin" | "macos" | "mac" => Self::MacOs,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppArchitecture {
    X64,
    Arm64,
    Unknown,
}

impl AppArchitecture {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "x64" | "amd64" => Self::X64,
            "arm64" | "aarch64" => Self::Arm64,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdateInfo {
    pub version: String,
    pub display_version: String,
    pub release_tag: String,
    pub release_title: String,
    pub release_url: String,
    pub is_pre_release: bool,
    pub published_at_utc: Option<DateTime<Utc>>,
    pub installer_name: String,
    pub installer_url: String,
    pub installer_sha256: Option<String>,
    pub release_notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub current_version: String,
    pub selected_channel: UpdateChannel,
    pub status: UpdateAvailabilityStatus,
    pub is_update_available: bool,
    pub is_busy: bool,
    pub is_automatic_check_enabled: bool,
    pub status_message: String,
    pub last_checked_utc: Option<DateTime<Utc>>,
    pub available_update: Option<AvailableUpdateInfo>,
    pub downloaded_installer_path: Option<String>,
    pub is_downloaded_asset_digest_verified: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub is_digest_verified: bool,
    pub update: Option<AvailableUpdateInfo>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallLaunchResult {
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateConfig {
    pub current_version: String,
    pub selected_channel: UpdateChannel,
    pub platform: AppPlatform,
    pub architecture: AppArchitecture,
    pub updates_directory: PathBuf,
    pub automatic_check_enabled: bool,
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Blocking transport abstraction keeps release selection and file handling
/// testable without making network requests.
pub trait HttpTransport: Send + Sync {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubReleaseInfo {
    #[serde(rename = "tag_name")]
    pub tag_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "html_url", default)]
    pub html_url: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(rename = "published_at", default)]
    pub published_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAssetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubReleaseAssetInfo {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "browser_download_url", default)]
    pub browser_download_url: String,
    #[serde(default)]
    pub digest: Option<String>,
}

pub struct UpdateService {
    config: UpdateConfig,
    transport: Arc<dyn HttpTransport>,
    process_starter: Arc<dyn Fn(&Path) -> bool + Send + Sync>,
    state: Mutex<UpdateState>,
}

impl UpdateService {
    pub fn new(
        config: UpdateConfig,
        transport: Arc<dyn HttpTransport>,
        process_starter: Arc<dyn Fn(&Path) -> bool + Send + Sync>,
    ) -> Self {
        let enabled = config.automatic_check_enabled;
        let state = UpdateState {
            current_version: normalize_version_string(&config.current_version),
            selected_channel: config.selected_channel,
            status: if enabled {
                UpdateAvailabilityStatus::Idle
            } else {
                UpdateAvailabilityStatus::Disabled
            },
            is_update_available: false,
            is_busy: false,
            is_automatic_check_enabled: enabled,
            status_message: if enabled {
                "Ready to check for updates.".to_string()
            } else {
                "Automatic update checks are turned off.".to_string()
            },
            last_checked_utc: None,
            available_update: None,
            downloaded_installer_path: None,
            is_downloaded_asset_digest_verified: false,
            last_error: None,
        };

        Self {
            config,
            transport,
            process_starter,
            state: Mutex::new(state),
        }
    }

    pub fn with_system_launcher(config: UpdateConfig, transport: Arc<dyn HttpTransport>) -> Self {
        let platform = config.platform;
        Self::new(
            config,
            transport,
            Arc::new(move |path| launch_installer_process(path, platform)),
        )
    }

    pub fn current_state(&self) -> UpdateState {
        self.state.lock().unwrap().clone()
    }

    pub fn check_for_updates(&self) -> UpdateState {
        let current = self.current_state();
        self.set_state(UpdateState {
            selected_channel: self.config.selected_channel,
            status: UpdateAvailabilityStatus::Checking,
            is_busy: true,
            is_automatic_check_enabled: self.config.automatic_check_enabled,
            status_message: "Checking for updates...".to_string(),
            last_error: None,
            ..current
        });

        let last_checked_utc = Some(Utc::now());
        match self.fetch_and_select() {
            Ok(Some(update)) => {
                let current = self.current_state();
                self.set_state(UpdateState {
                    selected_channel: self.config.selected_channel,
                    status: UpdateAvailabilityStatus::UpdateAvailable,
                    is_update_available: true,
                    is_busy: false,
                    is_automatic_check_enabled: self.config.automatic_check_enabled,
                    status_message: format!("Version {} is available.", update.display_version),
                    last_checked_utc,
                    available_update: Some(update),
                    downloaded_installer_path: None,
                    is_downloaded_asset_digest_verified: false,
                    last_error: None,
                    ..current
                });
            }
            Ok(None) => {
                let current = self.current_state();
                self.set_state(UpdateState {
                    selected_channel: self.config.selected_channel,
                    status: UpdateAvailabilityStatus::UpToDate,
                    is_update_available: false,
                    is_busy: false,
                    is_automatic_check_enabled: self.config.automatic_check_enabled,
                    status_message: "You're up to date.".to_string(),
                    last_checked_utc,
                    available_update: None,
                    downloaded_installer_path: None,
                    is_downloaded_asset_digest_verified: false,
                    last_error: None,
                    ..current
                });
            }
            Err(error) => {
                let current = self.current_state();
                let has_known_update = current.available_update.is_some();
                self.set_state(UpdateState {
                    selected_channel: self.config.selected_channel,
                    status: if has_known_update {
                        UpdateAvailabilityStatus::UpdateAvailable
                    } else {
                        UpdateAvailabilityStatus::Error
                    },
                    is_update_available: has_known_update,
                    is_busy: false,
                    is_automatic_check_enabled: self.config.automatic_check_enabled,
                    status_message: if has_known_update {
                        format!(
                            "Version {} is available.",
                            current
                                .available_update
                                .as_ref()
                                .map(|update| update.display_version.as_str())
                                .unwrap_or_default()
                        )
                    } else {
                        "Couldn't check for updates.".to_string()
                    },
                    last_checked_utc,
                    last_error: Some(error),
                    ..current
                });
            }
        }

        self.current_state()
    }

    pub fn download_installer(&self, update: AvailableUpdateInfo) -> UpdateDownloadResult {
        if let Err(error) = validate_installer_name(&update.installer_name) {
            return self.fail_download(update, error);
        }

        if !is_https_url(&update.installer_url) {
            return self.fail_download(update, "The installer URL is not secure.".to_string());
        }

        if let Err(error) = fs::create_dir_all(&self.config.updates_directory) {
            return self.fail_download(
                update,
                format!("Unable to create the updates directory: {error}"),
            );
        }

        self.cleanup_old_installers(&update.installer_name);
        let final_path = self.config.updates_directory.join(&update.installer_name);
        let final_path_string = final_path.to_string_lossy().into_owned();

        if final_path.exists() {
            match validate_downloaded_file(&final_path, update.installer_sha256.as_deref()) {
                Ok((true, true)) => {
                    self.set_state(UpdateState {
                        status: UpdateAvailabilityStatus::LaunchReady,
                        is_update_available: true,
                        is_busy: false,
                        status_message: "Installer ready to launch.".to_string(),
                        available_update: Some(update.clone()),
                        downloaded_installer_path: Some(final_path_string.clone()),
                        is_downloaded_asset_digest_verified: true,
                        last_error: None,
                        ..self.current_state()
                    });

                    return UpdateDownloadResult {
                        success: true,
                        file_path: Some(final_path_string),
                        is_digest_verified: true,
                        update: Some(update),
                        error_message: None,
                    };
                }
                Ok((true, false)) | Ok((false, _)) | Err(_) => try_delete_file(&final_path),
            }
        }

        self.set_state(UpdateState {
            status: UpdateAvailabilityStatus::Downloading,
            is_update_available: true,
            is_busy: true,
            status_message: "Downloading installer...".to_string(),
            available_update: Some(update.clone()),
            downloaded_installer_path: None,
            is_downloaded_asset_digest_verified: false,
            last_error: None,
            ..self.current_state()
        });

        let temporary_path = PathBuf::from(format!("{final_path_string}.download"));
        try_delete_file(&temporary_path);

        let response = self.transport.send(HttpRequest {
            url: update.installer_url.clone(),
            headers: create_request_headers(&self.current_state().current_version),
        });

        let body = match response {
            Ok(response) if (200..300).contains(&response.status) => response.body,
            Ok(response) => {
                return self.fail_download(
                    update,
                    format!(
                        "The installer download returned HTTP status {}.",
                        response.status
                    ),
                )
            }
            Err(error) => return self.fail_download(update, error),
        };

        if let Err(error) = fs::write(&temporary_path, body) {
            try_delete_file(&temporary_path);
            return self.fail_download(
                update,
                format!("Unable to write the downloaded installer: {error}"),
            );
        }

        if let Err(error) = fs::rename(&temporary_path, &final_path) {
            try_delete_file(&temporary_path);
            return self.fail_download(
                update,
                format!("Unable to move the downloaded installer into place: {error}"),
            );
        }

        match validate_downloaded_file(&final_path, update.installer_sha256.as_deref()) {
            Ok((true, digest_verified)) => {
                self.set_state(UpdateState {
                    status: UpdateAvailabilityStatus::LaunchReady,
                    is_update_available: true,
                    is_busy: false,
                    status_message: "Installer ready to launch.".to_string(),
                    available_update: Some(update.clone()),
                    downloaded_installer_path: Some(final_path_string.clone()),
                    is_downloaded_asset_digest_verified: digest_verified,
                    last_error: None,
                    ..self.current_state()
                });

                UpdateDownloadResult {
                    success: true,
                    file_path: Some(final_path_string),
                    is_digest_verified: digest_verified,
                    update: Some(update),
                    error_message: None,
                }
            }
            Ok((false, _)) => {
                try_delete_file(&final_path);
                self.fail_download(
                    update,
                    "The downloaded installer failed SHA-256 verification.".to_string(),
                )
            }
            Err(DownloadValidationError::DigestMismatch) => {
                try_delete_file(&final_path);
                self.fail_download(
                    update,
                    "The downloaded installer failed SHA-256 verification.".to_string(),
                )
            }
            Err(DownloadValidationError::Read(error)) => {
                try_delete_file(&final_path);
                self.fail_download(update, error)
            }
        }
    }

    pub fn launch_installer(
        &self,
        update: AvailableUpdateInfo,
        file_path: &str,
    ) -> UpdateInstallLaunchResult {
        if let Err(error) = validate_installer_name(&update.installer_name) {
            return UpdateInstallLaunchResult {
                success: false,
                error_message: Some(error),
            };
        }

        let expected_path = self.config.updates_directory.join(&update.installer_name);
        let path = Path::new(file_path);
        if !same_path(path, &expected_path) {
            return UpdateInstallLaunchResult {
                success: false,
                error_message: Some("The installer path is not managed by WinOTP.".to_string()),
            };
        }

        if !path.is_file() {
            return self.fail_install(
                update,
                "The downloaded installer could not be found.".to_string(),
            );
        }

        let digest_verified =
            match validate_downloaded_file(path, update.installer_sha256.as_deref()) {
                Ok((true, digest_verified)) => digest_verified,
                Ok((false, _)) => {
                    return self.fail_install(
                        update,
                        "The downloaded installer failed SHA-256 verification.".to_string(),
                    );
                }
                Err(error) => {
                    let message = match error {
                        DownloadValidationError::DigestMismatch => {
                            "The downloaded installer failed SHA-256 verification.".to_string()
                        }
                        DownloadValidationError::Read(error) => error,
                    };
                    return self.fail_install(update, message);
                }
            };

        if (self.process_starter)(path) {
            self.set_state(UpdateState {
                status: UpdateAvailabilityStatus::LaunchReady,
                is_busy: false,
                status_message: "Installer ready to launch.".to_string(),
                is_downloaded_asset_digest_verified: digest_verified,
                downloaded_installer_path: Some(path.to_string_lossy().into_owned()),
                ..self.current_state()
            });
            UpdateInstallLaunchResult {
                success: true,
                error_message: None,
            }
        } else {
            let message = "The installer could not be started.".to_string();
            self.set_state(UpdateState {
                status: UpdateAvailabilityStatus::LaunchReady,
                is_busy: false,
                last_error: Some(message.clone()),
                ..self.current_state()
            });
            UpdateInstallLaunchResult {
                success: false,
                error_message: Some(message),
            }
        }
    }

    pub fn select_available_release(
        releases: &[GitHubReleaseInfo],
        current_version: &str,
        channel: UpdateChannel,
        platform: AppPlatform,
        architecture: AppArchitecture,
    ) -> Result<Option<AvailableUpdateInfo>, String> {
        let current_app_version = AppVersion::parse(current_version)
            .ok_or_else(|| format!("The current app version '{current_version}' is invalid."))?;
        let best_asset_suffix = asset_suffix(platform, architecture)?;
        let mut best_match: Option<(AppVersion, AvailableUpdateInfo)> = None;

        for release in releases {
            if release.draft || (channel == UpdateChannel::Stable && release.prerelease) {
                continue;
            }

            let Some(release_version) = AppVersion::parse(&release.tag_name) else {
                continue;
            };
            if release_version <= current_app_version {
                continue;
            }

            let expected_asset_name = format!(
                "WinOTP-{}-{}",
                release_version.normalized, best_asset_suffix
            );
            let Some(asset) = release
                .assets
                .iter()
                .find(|candidate| candidate.name.eq_ignore_ascii_case(&expected_asset_name))
            else {
                continue;
            };

            if !is_https_url(&asset.browser_download_url) {
                continue;
            }

            let installer_sha256 = match normalize_sha256_digest(asset.digest.as_deref()) {
                Ok(digest) => digest,
                Err(_) => continue,
            };

            if best_match
                .as_ref()
                .is_some_and(|(version, _)| release_version <= *version)
            {
                continue;
            }

            let release_title = if release.name.trim().is_empty() {
                release_version.normalized.clone()
            } else {
                release.name.clone()
            };

            let update = AvailableUpdateInfo {
                version: release_version.normalized.clone(),
                display_version: release_version.normalized.clone(),
                release_tag: release.tag_name.clone(),
                release_title,
                release_url: release.html_url.clone(),
                is_pre_release: release.prerelease,
                published_at_utc: release.published_at,
                installer_name: asset.name.clone(),
                installer_url: asset.browser_download_url.clone(),
                installer_sha256,
                release_notes: release.body.clone().unwrap_or_default(),
            };
            best_match = Some((release_version, update));
        }

        Ok(best_match.map(|(_, update)| update))
    }

    fn fetch_and_select(&self) -> Result<Option<AvailableUpdateInfo>, String> {
        let releases = self.fetch_releases()?;
        Self::select_available_release(
            &releases,
            &self.current_state().current_version,
            self.config.selected_channel,
            self.config.platform,
            self.config.architecture,
        )
    }

    fn fetch_releases(&self) -> Result<Vec<GitHubReleaseInfo>, String> {
        let mut releases = Vec::new();
        let mut visited_page_urls = std::collections::HashSet::new();
        let mut next_page_url = format!("{RELEASE_API_URL}?per_page={RELEASE_PAGE_SIZE}");

        while !next_page_url.is_empty() {
            if !visited_page_urls.insert(next_page_url.clone()) {
                return Err(format!(
                    "GitHub releases pagination repeated page '{next_page_url}'."
                ));
            }
            if !is_https_url(&next_page_url) {
                return Err("GitHub returned an insecure releases page URL.".to_string());
            }

            let response = self.transport.send(HttpRequest {
                url: next_page_url,
                headers: create_request_headers(&self.current_state().current_version),
            })?;
            if !(200..300).contains(&response.status) {
                return Err(format!(
                    "GitHub API returned HTTP status {}.",
                    response.status
                ));
            }

            let page: Vec<GitHubReleaseInfo> = serde_json::from_slice(&response.body)
                .map_err(|error| format!("Failed to parse GitHub releases response: {error}"))?;
            releases.extend(page);
            next_page_url = get_next_page_url(&response.headers).unwrap_or_default();
        }

        Ok(releases)
    }

    fn fail_download(
        &self,
        update: AvailableUpdateInfo,
        error_message: String,
    ) -> UpdateDownloadResult {
        self.set_state(UpdateState {
            status: UpdateAvailabilityStatus::UpdateAvailable,
            is_update_available: true,
            is_busy: false,
            status_message: format!("Version {} is available.", update.display_version),
            available_update: Some(update.clone()),
            downloaded_installer_path: None,
            is_downloaded_asset_digest_verified: false,
            last_error: Some(error_message.clone()),
            ..self.current_state()
        });
        UpdateDownloadResult {
            success: false,
            file_path: None,
            is_digest_verified: false,
            update: Some(update),
            error_message: Some(error_message),
        }
    }

    fn fail_install(
        &self,
        update: AvailableUpdateInfo,
        error_message: String,
    ) -> UpdateInstallLaunchResult {
        try_delete_file(&self.config.updates_directory.join(&update.installer_name));
        self.set_state(UpdateState {
            status: UpdateAvailabilityStatus::UpdateAvailable,
            is_update_available: true,
            is_busy: false,
            status_message: format!("Version {} is available.", update.display_version),
            available_update: Some(update),
            downloaded_installer_path: None,
            is_downloaded_asset_digest_verified: false,
            last_error: Some(error_message.clone()),
            ..self.current_state()
        });
        UpdateInstallLaunchResult {
            success: false,
            error_message: Some(error_message),
        }
    }

    fn set_state(&self, state: UpdateState) {
        *self.state.lock().unwrap() = state;
    }

    fn cleanup_old_installers(&self, current_installer_name: &str) {
        let Ok(entries) = fs::read_dir(&self.config.updates_directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_installer = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extension.eq_ignore_ascii_case("exe")
                        || extension.eq_ignore_ascii_case("appimage")
                        || extension.eq_ignore_ascii_case("dmg")
                });
            let is_current = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case(current_installer_name));
            if is_installer && !is_current {
                try_delete_file(&path);
            }
        }
    }
}

#[derive(Debug, Clone)]
struct AppVersion {
    normalized: String,
    version: Version,
}

impl AppVersion {
    fn parse(raw_version: &str) -> Option<Self> {
        let normalized = normalize_version_string(raw_version);
        let version = Version::parse(&normalized).ok()?;
        Some(Self {
            normalized,
            version,
        })
    }
}

impl PartialEq for AppVersion {
    fn eq(&self, other: &Self) -> bool {
        self.version == other.version
    }
}

impl Eq for AppVersion {}

impl PartialOrd for AppVersion {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for AppVersion {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.version.cmp(&other.version)
    }
}

pub fn normalize_version_string(raw_version: &str) -> String {
    let mut normalized = raw_version.trim().to_string();
    if let Some(stripped) = normalized
        .strip_prefix('v')
        .or_else(|| normalized.strip_prefix('V'))
    {
        normalized = stripped.to_string();
    }
    if let Some(separator_index) = normalized.find('+') {
        normalized.truncate(separator_index);
    }
    normalized
}

fn asset_suffix(
    platform: AppPlatform,
    architecture: AppArchitecture,
) -> Result<&'static str, String> {
    match platform {
        AppPlatform::Windows => match architecture {
            AppArchitecture::X64 => Ok("win-x64-setup.exe"),
            AppArchitecture::Arm64 => Ok("win-arm64-setup.exe"),
            AppArchitecture::Unknown => {
                Err("Updates are not supported on this architecture.".to_string())
            }
        },
        AppPlatform::Linux => match architecture {
            AppArchitecture::X64 => Ok("linux-x64-setup.AppImage"),
            AppArchitecture::Arm64 => Ok("linux-arm64-setup.AppImage"),
            AppArchitecture::Unknown => {
                Err("Updates are not supported on this architecture.".to_string())
            }
        },
        AppPlatform::MacOs => Ok("mac-universal-setup.dmg"),
        AppPlatform::Unknown => Err("Updates are not supported on this platform.".to_string()),
    }
}

fn create_request_headers(current_version: &str) -> Vec<(String, String)> {
    vec![
        (
            "Accept".to_string(),
            "application/vnd.github+json".to_string(),
        ),
        ("X-GitHub-Api-Version".to_string(), "2022-11-28".to_string()),
        (
            "User-Agent".to_string(),
            format!("WinOTP/{current_version}"),
        ),
    ]
}

fn get_next_page_url(headers: &[(String, String)]) -> Option<String> {
    let link_header = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("link"))
        .map(|(_, value)| value.as_str())?;

    for segment in link_header
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let parts: Vec<&str> = segment.split(';').map(str::trim).collect();
        if parts.len() < 2 {
            continue;
        }
        let target = parts[0];
        if !target.starts_with('<') || !target.ends_with('>') {
            continue;
        }
        if parts.iter().skip(1).any(|part| {
            part.eq_ignore_ascii_case("rel=\"next\"") || part.eq_ignore_ascii_case("rel=next")
        }) {
            return Some(target[1..target.len() - 1].to_string());
        }
    }
    None
}

fn normalize_sha256_digest(digest: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = digest.map(str::trim) else {
        return Ok(None);
    };
    let Some(prefix) = value.get(.."sha256:".len()) else {
        return Err("The release contains an invalid SHA-256 digest.".to_string());
    };
    if !prefix.eq_ignore_ascii_case("sha256:") {
        return Err("The release contains an invalid SHA-256 digest.".to_string());
    }
    let value = &value["sha256:".len()..];
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("The release contains an invalid SHA-256 digest.".to_string());
    }
    Ok(Some(value.to_ascii_lowercase()))
}

#[derive(Debug)]
enum DownloadValidationError {
    DigestMismatch,
    Read(String),
}

fn validate_downloaded_file(
    path: &Path,
    expected_sha256: Option<&str>,
) -> Result<(bool, bool), DownloadValidationError> {
    let Some(expected_sha256) = expected_sha256
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok((true, false));
    };
    let expected_sha256 = expected_sha256
        .strip_prefix("sha256:")
        .or_else(|| expected_sha256.strip_prefix("SHA256:"))
        .unwrap_or(expected_sha256);
    let bytes = fs::read(path).map_err(|error| DownloadValidationError::Read(error.to_string()))?;
    let actual_hash = hex::encode(sha2::Sha256::digest(bytes));
    if !actual_hash.eq_ignore_ascii_case(expected_sha256) {
        return Err(DownloadValidationError::DigestMismatch);
    }
    Ok((true, true))
}

fn validate_installer_name(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    if name.trim().is_empty()
        || path.is_absolute()
        || path.components().count() != 1
        || path.file_name().and_then(|file| file.to_str()) != Some(name)
    {
        return Err("The release contains an invalid installer name.".to_string());
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn try_delete_file(path: &Path) {
    let _ = fs::remove_file(path);
}

fn is_https_url(url: &str) -> bool {
    url.strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty() && !rest.contains(char::is_whitespace))
}

fn launch_installer_process(path: &Path, platform: AppPlatform) -> bool {
    match platform {
        AppPlatform::Windows => Command::new(path)
            .args(["/CURRENTUSER", "/SP-", "/LOG"])
            .spawn()
            .is_ok(),
        AppPlatform::Linux => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(metadata) = fs::metadata(path) {
                    let mut permissions = metadata.permissions();
                    permissions.set_mode(permissions.mode() | 0o111);
                    let _ = fs::set_permissions(path, permissions);
                }
            }
            Command::new(path).spawn().is_ok()
        }
        AppPlatform::MacOs => Command::new("open").arg(path).spawn().is_ok(),
        AppPlatform::Unknown => false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterRequest {
    pub command: String,
    #[serde(default)]
    pub current_version: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub architecture: String,
    #[serde(default)]
    pub updates_directory: PathBuf,
    #[serde(default = "default_true")]
    pub automatic_check_enabled: bool,
    #[serde(default)]
    pub update: Option<AvailableUpdateInfo>,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterResponse {
    pub success: bool,
    pub state: UpdateState,
    pub message: Option<String>,
    pub file_path: Option<String>,
    pub is_digest_verified: bool,
    pub update: Option<AvailableUpdateInfo>,
}

impl UpdaterResponse {
    pub fn failure(message: String) -> Self {
        Self {
            success: false,
            state: UpdateState {
                current_version: String::new(),
                selected_channel: UpdateChannel::Stable,
                status: UpdateAvailabilityStatus::Error,
                is_update_available: false,
                is_busy: false,
                is_automatic_check_enabled: false,
                status_message: "The Rust update bridge is unavailable.".to_string(),
                last_checked_utc: None,
                available_update: None,
                downloaded_installer_path: None,
                is_downloaded_asset_digest_verified: false,
                last_error: Some(message.clone()),
            },
            message: Some(message),
            file_path: None,
            is_digest_verified: false,
            update: None,
        }
    }
}

pub fn run_request(request: UpdaterRequest) -> Result<UpdaterResponse, String> {
    let config = UpdateConfig {
        current_version: request.current_version,
        selected_channel: UpdateChannel::parse(&request.channel),
        platform: AppPlatform::parse(&request.platform),
        architecture: AppArchitecture::parse(&request.architecture),
        updates_directory: request.updates_directory,
        automatic_check_enabled: request.automatic_check_enabled,
    };
    let service = UpdateService::with_system_launcher(config, Arc::new(UreqTransport));

    match request.command.trim().to_ascii_lowercase().as_str() {
        "status" => {
            let state = service.current_state();
            Ok(UpdaterResponse {
                success: true,
                state,
                message: None,
                file_path: None,
                is_digest_verified: false,
                update: None,
            })
        }
        "check" => {
            let state = service.check_for_updates();
            Ok(UpdaterResponse {
                success: state.status != UpdateAvailabilityStatus::Error,
                message: state.last_error.clone(),
                update: state.available_update.clone(),
                state,
                file_path: None,
                is_digest_verified: false,
            })
        }
        "download" => {
            let update = request
                .update
                .ok_or_else(|| "No update is currently available.".to_string())?;
            let result = service.download_installer(update);
            Ok(UpdaterResponse {
                success: result.success,
                message: result.error_message.clone(),
                state: service.current_state(),
                file_path: result.file_path,
                is_digest_verified: result.is_digest_verified,
                update: result.update,
            })
        }
        "install" => {
            let update = request
                .update
                .ok_or_else(|| "No update is currently available.".to_string())?;
            let file_path = request
                .file_path
                .ok_or_else(|| "The installer is not ready.".to_string())?;
            let result = service.launch_installer(update.clone(), &file_path);
            let state = service.current_state();
            Ok(UpdaterResponse {
                success: result.success,
                message: result.error_message,
                is_digest_verified: state.is_downloaded_asset_digest_verified,
                state,
                file_path: Some(file_path),
                update: Some(update),
            })
        }
        command => Err(format!("Unknown updater command '{command}'.")),
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Default)]
pub struct UreqTransport;

impl HttpTransport for UreqTransport {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        let user_agent = request
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| "WinOTP".to_string());

        let config = ureq::Agent::config_builder().user_agent(user_agent).build();
        let agent = ureq::Agent::new_with_config(config);
        let mut http_request = agent.get(&request.url);
        for (name, value) in &request.headers {
            if !name.eq_ignore_ascii_case("user-agent") {
                http_request = http_request.header(name, value);
            }
        }

        let response = http_request.call().map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let mut body = response.into_body();
        let body = body
            .with_config()
            .limit(MAX_RESPONSE_BODY_BYTES)
            .read_to_vec()
            .map_err(|error| error.to_string())?;

        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}
