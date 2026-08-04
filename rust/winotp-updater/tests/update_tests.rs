use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use sha2::Digest;
use tempfile::tempdir;
use winotp_updater::{
    AppArchitecture, AppPlatform, GitHubReleaseAssetInfo, GitHubReleaseInfo, HttpRequest,
    HttpResponse, HttpTransport, UpdateAvailabilityStatus, UpdateChannel, UpdateConfig,
    UpdateService,
};

struct FakeTransport {
    handler: Box<dyn Fn(HttpRequest) -> Result<HttpResponse, String> + Send + Sync>,
}

impl FakeTransport {
    fn new(
        handler: impl Fn(HttpRequest) -> Result<HttpResponse, String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            handler: Box::new(handler),
        }
    }
}

impl HttpTransport for FakeTransport {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        (self.handler)(request)
    }
}

fn response(body: Vec<u8>, headers: Vec<(String, String)>) -> HttpResponse {
    HttpResponse {
        status: 200,
        headers,
        body,
    }
}

fn asset(name: &str, url: &str, digest: Option<String>) -> GitHubReleaseAssetInfo {
    GitHubReleaseAssetInfo {
        name: name.to_string(),
        browser_download_url: url.to_string(),
        digest,
    }
}

fn release(tag: &str, prerelease: bool, assets: Vec<GitHubReleaseAssetInfo>) -> GitHubReleaseInfo {
    GitHubReleaseInfo {
        tag_name: tag.to_string(),
        name: tag.trim_start_matches('v').to_string(),
        html_url: format!("https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/{tag}"),
        body: None,
        draft: false,
        prerelease,
        published_at: None,
        assets,
    }
}

fn config(directory: &Path, channel: UpdateChannel, platform: AppPlatform) -> UpdateConfig {
    UpdateConfig {
        current_version: "1.0.0".to_string(),
        selected_channel: channel,
        platform,
        architecture: AppArchitecture::X64,
        updates_directory: directory.to_path_buf(),
        automatic_check_enabled: true,
    }
}

#[test]
fn selects_highest_stable_release_for_the_current_platform() {
    let releases = vec![
        release(
            "v1.2.0-beta.1",
            true,
            vec![asset(
                "WinOTP-1.2.0-beta.1-win-x64-setup.exe",
                "https://example.test/preview.exe",
                None,
            )],
        ),
        release(
            "v1.1.0",
            false,
            vec![asset(
                "WinOTP-1.1.0-win-x64-setup.exe",
                "https://example.test/stable.exe",
                None,
            )],
        ),
        release(
            "v1.3.0",
            false,
            vec![asset(
                "WinOTP-1.3.0-win-x64-setup.exe",
                "https://example.test/latest.exe",
                None,
            )],
        ),
    ];

    let update = UpdateService::select_available_release(
        &releases,
        "1.0.0+build",
        UpdateChannel::Stable,
        AppPlatform::Windows,
        AppArchitecture::X64,
    )
    .expect("the current version is valid")
    .expect("a compatible release is available");

    assert_eq!(update.display_version, "1.3.0");
    assert_eq!(update.installer_name, "WinOTP-1.3.0-win-x64-setup.exe");
}

#[test]
fn prerelease_channel_can_select_prerelease_and_uses_arm64_assets() {
    let releases = vec![release(
        "v1.2.0-beta.1",
        true,
        vec![asset(
            "WinOTP-1.2.0-beta.1-win-arm64-setup.exe",
            "https://example.test/preview.exe",
            None,
        )],
    )];

    let update = UpdateService::select_available_release(
        &releases,
        "1.0.0",
        UpdateChannel::PreRelease,
        AppPlatform::Windows,
        AppArchitecture::Arm64,
    )
    .expect("the current version is valid")
    .expect("a compatible prerelease is available");

    assert_eq!(update.display_version, "1.2.0-beta.1");
    assert!(update.is_pre_release);
}

#[test]
fn skips_releases_with_invalid_sha256_digests() {
    let releases = vec![release(
        "v1.2.0",
        false,
        vec![asset(
            "WinOTP-1.2.0-win-x64-setup.exe",
            "https://example.test/invalid.exe",
            Some("sha256:not-a-digest".to_string()),
        )],
    )];

    let update = UpdateService::select_available_release(
        &releases,
        "1.0.0",
        UpdateChannel::Stable,
        AppPlatform::Windows,
        AppArchitecture::X64,
    )
    .expect("the current version is valid");

    assert!(update.is_none());
}

#[test]
fn manual_checks_still_run_when_startup_checks_are_disabled() {
    let directory = tempdir().expect("temporary directory");
    let transport = FakeTransport::new(|request| {
        assert!(request.url.contains("per_page=100"));
        Ok(response(b"[]".to_vec(), Vec::new()))
    });
    let service = UpdateService::new(
        UpdateConfig {
            automatic_check_enabled: false,
            ..config(
                directory.path(),
                UpdateChannel::Stable,
                AppPlatform::Windows,
            )
        },
        Arc::new(transport),
        Arc::new(|_: &Path| true),
    );

    let checked = service.check_for_updates();

    assert_eq!(checked.status, UpdateAvailabilityStatus::UpToDate);
    assert!(!checked.is_automatic_check_enabled);
}

#[test]
fn does_not_trust_an_existing_installer_without_a_digest() {
    let directory = tempdir().expect("temporary directory");
    let installer_name = "WinOTP-1.1.0-win-x64-setup.exe";
    let update = UpdateService::select_available_release(
        &[release(
            "v1.1.0",
            false,
            vec![asset(
                installer_name,
                "https://example.test/installer.exe",
                None,
            )],
        )],
        "1.0.0",
        UpdateChannel::Stable,
        AppPlatform::Windows,
        AppArchitecture::X64,
    )
    .expect("the current version is valid")
    .expect("an update is available");
    let installer_path = directory.path().join(installer_name);
    fs::write(&installer_path, b"stale installer").expect("write stale installer");

    let requests = Arc::new(Mutex::new(0));
    let transport = FakeTransport::new({
        let requests = requests.clone();
        move |request| {
            assert!(request.url.ends_with("installer.exe"));
            *requests.lock().unwrap() += 1;
            Ok(response(b"fresh installer".to_vec(), Vec::new()))
        }
    });
    let service = UpdateService::new(
        config(
            directory.path(),
            UpdateChannel::Stable,
            AppPlatform::Windows,
        ),
        Arc::new(transport),
        Arc::new(|_: &Path| true),
    );

    let downloaded = service.download_installer(update);

    assert!(downloaded.success);
    assert_eq!(*requests.lock().unwrap(), 1);
    assert_eq!(fs::read(installer_path).unwrap(), b"fresh installer");
}

#[test]
fn missing_installer_resets_the_launch_state() {
    let directory = tempdir().expect("temporary directory");
    let update = UpdateService::select_available_release(
        &[release(
            "v1.1.0",
            false,
            vec![asset(
                "WinOTP-1.1.0-win-x64-setup.exe",
                "https://example.test/installer.exe",
                None,
            )],
        )],
        "1.0.0",
        UpdateChannel::Stable,
        AppPlatform::Windows,
        AppArchitecture::X64,
    )
    .expect("the current version is valid")
    .expect("an update is available");
    let service = UpdateService::new(
        config(
            directory.path(),
            UpdateChannel::Stable,
            AppPlatform::Windows,
        ),
        Arc::new(FakeTransport::new(|_| Ok(response(Vec::new(), Vec::new())))),
        Arc::new(|_: &Path| true),
    );
    let installer_path = directory.path().join(&update.installer_name);

    let result = service.launch_installer(update, installer_path.to_str().unwrap());

    assert!(!result.success);
    assert_eq!(
        service.current_state().status,
        UpdateAvailabilityStatus::UpdateAvailable
    );
    assert!(service.current_state().downloaded_installer_path.is_none());
}

#[test]
fn launch_rejects_installer_path_traversal() {
    let directory = tempdir().expect("temporary directory");
    let outside_path = directory.path().join("outside.exe");
    fs::write(&outside_path, b"not an installer").expect("write outside file");
    let mut update = UpdateService::select_available_release(
        &[release(
            "v1.1.0",
            false,
            vec![asset(
                "WinOTP-1.1.0-win-x64-setup.exe",
                "https://example.test/installer.exe",
                None,
            )],
        )],
        "1.0.0",
        UpdateChannel::Stable,
        AppPlatform::Windows,
        AppArchitecture::X64,
    )
    .expect("the current version is valid")
    .expect("an update is available");
    update.installer_name = "..\\outside.exe".to_string();
    let service = UpdateService::new(
        config(
            directory.path().join("Updates").as_path(),
            UpdateChannel::Stable,
            AppPlatform::Windows,
        ),
        Arc::new(FakeTransport::new(|_| Ok(response(Vec::new(), Vec::new())))),
        Arc::new(|_: &Path| false),
    );

    let result = service.launch_installer(update, outside_path.to_str().unwrap());

    assert!(!result.success);
    assert!(result
        .error_message
        .as_deref()
        .is_some_and(|message| message.contains("invalid installer name")));
    assert!(outside_path.is_file());
}

#[test]
fn check_paginates_and_download_verifies_the_release_digest() {
    let directory = tempdir().expect("temporary directory");
    let installer_bytes = b"trusted installer";
    let digest = hex::encode(sha2::Sha256::digest(installer_bytes));
    let first_page = serde_json::to_vec(&Vec::<GitHubReleaseInfo>::new()).unwrap();
    let second_page = serde_json::to_vec(&vec![release(
        "v1.1.0",
        false,
        vec![asset(
            "WinOTP-1.1.0-win-x64-setup.exe",
            "https://example.test/installer.exe",
            Some(format!("sha256:{digest}")),
        )],
    )])
    .unwrap();
    let requests = Arc::new(Mutex::new(Vec::<String>::new()));
    let transport = FakeTransport::new({
        let requests = requests.clone();
        move |request| {
            requests.lock().unwrap().push(request.url.clone());
            if request.url.contains("installer.exe") {
                Ok(response(installer_bytes.to_vec(), Vec::new()))
            } else if request.url.contains("page=2") {
                Ok(response(second_page.clone(), Vec::new()))
            } else {
                Ok(response(
                    first_page.clone(),
                    vec![(
                        "Link".to_string(),
                        "<https://api.github.com/repos/xBounceIT/WinOTP-Reborn/releases?page=2>; rel=\"next\"".to_string(),
                    )],
                ))
            }
        }
    });
    let service = UpdateService::new(
        config(
            directory.path(),
            UpdateChannel::Stable,
            AppPlatform::Windows,
        ),
        Arc::new(transport),
        Arc::new(|_: &Path| true),
    );

    let checked = service.check_for_updates();
    assert_eq!(checked.status, UpdateAvailabilityStatus::UpdateAvailable);
    let update = checked
        .available_update
        .expect("the paginated release is selected");
    let downloaded = service.download_installer(update);

    assert!(downloaded.success);
    assert!(downloaded.is_digest_verified);
    assert_eq!(
        service.current_state().status,
        UpdateAvailabilityStatus::LaunchReady
    );
    assert!(PathBuf::from(downloaded.file_path.unwrap()).is_file());
    assert_eq!(requests.lock().unwrap().len(), 3);
}
