use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const MAX_PASSWORD_LENGTH: usize = 128;
const CREDENTIAL_COMPARISON_KEY: &[u8] = b"WinOTP-Reborn credential comparison";
type CredentialHmac = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CredentialStatus {
    NotSet,
    Set,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WindowsHelloAvailability {
    Available,
    Unavailable,
    RemoteSession,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WindowsHelloVerificationStatus {
    Verified,
    Unavailable,
    RemoteSession,
    Failed,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectionTransitionKind {
    Pin,
    Password,
    WindowsHello,
    RemotePin,
    RemotePassword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppLockMode {
    None,
    Pin,
    Password,
    WindowsHello,
    WindowsHelloRemotePin,
    WindowsHelloRemotePassword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockResolution {
    pub mode: AppLockMode,
    pub is_pin_effective: bool,
    pub is_password_effective: bool,
    pub is_windows_hello_effective: bool,
    pub is_windows_hello_remote_pin_effective: bool,
    pub is_windows_hello_remote_password_effective: bool,
    pub has_pin_error: bool,
    pub has_password_error: bool,
    pub has_windows_hello_error: bool,
    pub has_windows_hello_remote_pin_error: bool,
    pub has_windows_hello_remote_password_error: bool,
    pub has_windows_hello_remote_session: bool,
    pub disable_unavailable_pin: bool,
    pub disable_unavailable_password: bool,
    pub disable_unavailable_windows_hello: bool,
    pub disable_unavailable_windows_hello_remote_pin: bool,
    pub disable_unavailable_windows_hello_remote_password: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppLockInputs {
    pub pin_enabled: bool,
    pub pin_status: CredentialStatus,
    pub password_enabled: bool,
    pub password_status: CredentialStatus,
    pub windows_hello_enabled: bool,
    pub windows_hello_availability: WindowsHelloAvailability,
    pub remote_pin_enabled: bool,
    pub remote_pin_status: CredentialStatus,
    pub remote_password_enabled: bool,
    pub remote_password_status: CredentialStatus,
}

impl AppLockResolution {
    pub fn has_unavailable_configured_protection(&self) -> bool {
        self.disable_unavailable_pin
            || self.disable_unavailable_password
            || self.disable_unavailable_windows_hello
            || self.disable_unavailable_windows_hello_remote_pin
            || self.disable_unavailable_windows_hello_remote_password
    }

    pub fn has_configured_protection_error(&self) -> bool {
        self.has_pin_error
            || self.has_password_error
            || self.has_windows_hello_error
            || self.has_windows_hello_remote_pin_error
            || self.has_windows_hello_remote_password_error
    }
}

pub fn resolve_app_lock(inputs: AppLockInputs) -> AppLockResolution {
    let AppLockInputs {
        pin_enabled,
        pin_status,
        password_enabled,
        password_status,
        windows_hello_enabled,
        windows_hello_availability,
        remote_pin_enabled,
        remote_pin_status,
        remote_password_enabled,
        remote_password_status,
    } = inputs;
    let is_pin_effective = pin_enabled && pin_status == CredentialStatus::Set;
    let is_password_effective = password_enabled && password_status == CredentialStatus::Set;
    let is_windows_hello_effective =
        windows_hello_enabled && windows_hello_availability == WindowsHelloAvailability::Available;
    let is_windows_hello_remote_pin_effective = windows_hello_enabled
        && remote_pin_enabled
        && windows_hello_availability == WindowsHelloAvailability::RemoteSession
        && remote_pin_status == CredentialStatus::Set;
    let is_windows_hello_remote_password_effective = windows_hello_enabled
        && remote_password_enabled
        && windows_hello_availability == WindowsHelloAvailability::RemoteSession
        && remote_password_status == CredentialStatus::Set;

    let has_pin_error = pin_enabled && pin_status == CredentialStatus::Error;
    let has_password_error = password_enabled && password_status == CredentialStatus::Error;
    let has_windows_hello_error =
        windows_hello_enabled && windows_hello_availability == WindowsHelloAvailability::Error;
    let has_windows_hello_remote_pin_error =
        remote_pin_enabled && remote_pin_status == CredentialStatus::Error;
    let has_windows_hello_remote_password_error =
        remote_password_enabled && remote_password_status == CredentialStatus::Error;
    let has_windows_hello_remote_session = windows_hello_enabled
        && windows_hello_availability == WindowsHelloAvailability::RemoteSession;

    let disable_unavailable_pin = pin_enabled && pin_status == CredentialStatus::NotSet;
    let disable_unavailable_password =
        password_enabled && password_status == CredentialStatus::NotSet;
    let disable_unavailable_windows_hello = windows_hello_enabled
        && windows_hello_availability == WindowsHelloAvailability::Unavailable;
    let disable_unavailable_windows_hello_remote_pin =
        remote_pin_enabled && remote_pin_status == CredentialStatus::NotSet;
    let disable_unavailable_windows_hello_remote_password =
        remote_password_enabled && remote_password_status == CredentialStatus::NotSet;

    let mode = if is_pin_effective {
        AppLockMode::Pin
    } else if is_password_effective {
        AppLockMode::Password
    } else if is_windows_hello_effective {
        AppLockMode::WindowsHello
    } else if is_windows_hello_remote_pin_effective {
        AppLockMode::WindowsHelloRemotePin
    } else if is_windows_hello_remote_password_effective {
        AppLockMode::WindowsHelloRemotePassword
    } else {
        AppLockMode::None
    };

    AppLockResolution {
        mode,
        is_pin_effective,
        is_password_effective,
        is_windows_hello_effective,
        is_windows_hello_remote_pin_effective,
        is_windows_hello_remote_password_effective,
        has_pin_error,
        has_password_error,
        has_windows_hello_error,
        has_windows_hello_remote_pin_error,
        has_windows_hello_remote_password_error,
        has_windows_hello_remote_session,
        disable_unavailable_pin,
        disable_unavailable_password,
        disable_unavailable_windows_hello,
        disable_unavailable_windows_hello_remote_pin,
        disable_unavailable_windows_hello_remote_password,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresentationTrigger {
    Startup,
    SettingsChange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationDecision {
    pub should_show_lock_screen: bool,
    pub should_ensure_initial_page: bool,
    pub should_start_monitoring: bool,
}

pub fn resolve_presentation(
    trigger: PresentationTrigger,
    resolution: AppLockResolution,
) -> PresentationDecision {
    let protected = resolution.mode != AppLockMode::None;
    match (trigger, protected) {
        (PresentationTrigger::Startup, true) => PresentationDecision {
            should_show_lock_screen: true,
            should_ensure_initial_page: false,
            should_start_monitoring: false,
        },
        (PresentationTrigger::Startup, false) => PresentationDecision {
            should_show_lock_screen: false,
            should_ensure_initial_page: true,
            should_start_monitoring: true,
        },
        (PresentationTrigger::SettingsChange, true) => PresentationDecision {
            should_show_lock_screen: false,
            should_ensure_initial_page: false,
            should_start_monitoring: true,
        },
        (PresentationTrigger::SettingsChange, false) => PresentationDecision {
            should_show_lock_screen: false,
            should_ensure_initial_page: true,
            should_start_monitoring: true,
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TemporaryBypassReason {
    ServiceError,
    RemoteSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionPresentationState {
    pub mode: AppLockMode,
    pub show_recovery_dialog: bool,
    pub temporary_bypass_reason: Option<TemporaryBypassReason>,
}

impl ProtectionPresentationState {
    pub fn has_remote_session_context(&self) -> bool {
        matches!(
            self.mode,
            AppLockMode::WindowsHelloRemotePin | AppLockMode::WindowsHelloRemotePassword
        ) || self.temporary_bypass_reason == Some(TemporaryBypassReason::RemoteSession)
    }
}

pub const CONSOLE_CONNECT_SESSION_CHANGE: u32 = 0x1;
pub const CONSOLE_DISCONNECT_SESSION_CHANGE: u32 = 0x2;
pub const REMOTE_CONNECT_SESSION_CHANGE: u32 = 0x3;
pub const REMOTE_DISCONNECT_SESSION_CHANGE: u32 = 0x4;

pub fn should_resolve_on_reconciliation(
    windows_hello_enabled: bool,
    previous_state: ProtectionPresentationState,
) -> bool {
    windows_hello_enabled || previous_state.has_remote_session_context()
}

pub fn should_refresh_before_credential_verification(
    current_lock_mode: AppLockMode,
    resolution: AppLockResolution,
) -> bool {
    matches!(
        current_lock_mode,
        AppLockMode::WindowsHelloRemotePin | AppLockMode::WindowsHelloRemotePassword
    ) && resolution.mode != current_lock_mode
}

pub fn should_present_resolved_protection_state(
    previous_state: ProtectionPresentationState,
    current_state: ProtectionPresentationState,
) -> bool {
    previous_state != current_state
}

pub fn should_require_immediate_lock_on_settings_change(
    previous_state: ProtectionPresentationState,
    current_state: ProtectionPresentationState,
) -> bool {
    previous_state.temporary_bypass_reason == Some(TemporaryBypassReason::RemoteSession)
        && matches!(
            current_state.mode,
            AppLockMode::WindowsHelloRemotePin | AppLockMode::WindowsHelloRemotePassword
        )
}

pub fn should_reconcile_on_session_change(code: u32) -> bool {
    matches!(
        code,
        CONSOLE_CONNECT_SESSION_CHANGE
            | CONSOLE_DISCONNECT_SESSION_CHANGE
            | REMOTE_CONNECT_SESSION_CHANGE
            | REMOTE_DISCONNECT_SESSION_CHANGE
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionViewState {
    pub resolution: AppLockResolution,
    pub pin_enabled: bool,
    pub password_enabled: bool,
    pub windows_hello_enabled: bool,
    pub remote_pin_enabled: bool,
    pub remote_password_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionTransitionState {
    pub pin_enabled: bool,
    pub password_enabled: bool,
    pub windows_hello_enabled: bool,
    pub remote_pin_enabled: bool,
    pub remote_password_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectionTransitionInputs {
    pub pin_enabled: bool,
    pub password_enabled: bool,
    pub windows_hello_enabled: bool,
    pub remote_pin_enabled: bool,
    pub remote_password_enabled: bool,
    pub kind: ProtectionTransitionKind,
    pub enabled: bool,
}

pub fn apply_protection_transition(
    inputs: ProtectionTransitionInputs,
) -> ProtectionTransitionState {
    let ProtectionTransitionInputs {
        mut pin_enabled,
        mut password_enabled,
        mut windows_hello_enabled,
        mut remote_pin_enabled,
        mut remote_password_enabled,
        kind,
        enabled,
    } = inputs;

    match kind {
        ProtectionTransitionKind::Pin => {
            pin_enabled = enabled;
            if enabled {
                password_enabled = false;
                windows_hello_enabled = false;
            }
        }
        ProtectionTransitionKind::Password => {
            password_enabled = enabled;
            if enabled {
                pin_enabled = false;
                windows_hello_enabled = false;
            }
        }
        ProtectionTransitionKind::WindowsHello => {
            windows_hello_enabled = enabled;
            if enabled {
                pin_enabled = false;
                password_enabled = false;
            } else {
                remote_pin_enabled = false;
                remote_password_enabled = false;
            }
        }
        ProtectionTransitionKind::RemotePin => {
            remote_pin_enabled = enabled;
            if enabled {
                remote_password_enabled = false;
            }
        }
        ProtectionTransitionKind::RemotePassword => {
            remote_password_enabled = enabled;
            if enabled {
                remote_pin_enabled = false;
            }
        }
    }

    ProtectionTransitionState {
        pin_enabled,
        password_enabled,
        windows_hello_enabled,
        remote_pin_enabled,
        remote_password_enabled,
    }
}

pub fn credential_kinds_to_clear(state: ProtectionTransitionState) -> Vec<String> {
    let mut kinds = Vec::new();
    if state.pin_enabled {
        kinds.push("password".to_string());
    } else if state.password_enabled {
        kinds.push("pin".to_string());
    } else {
        kinds.extend(["pin", "password"].into_iter().map(str::to_string));
    }

    if state.windows_hello_enabled {
        if state.remote_pin_enabled {
            kinds.push("remotePassword".to_string());
        } else if state.remote_password_enabled {
            kinds.push("remotePin".to_string());
        } else {
            kinds.extend(
                ["remotePin", "remotePassword"]
                    .into_iter()
                    .map(str::to_string),
            );
        }
    } else {
        kinds.extend(
            ["remotePin", "remotePassword"]
                .into_iter()
                .map(str::to_string),
        );
    }

    kinds
}

pub fn validate_credential(kind: &str, secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("A security credential is required.".to_string());
    }

    if matches!(kind, "pin" | "remotePin") {
        if !secret.chars().all(|character| character.is_ascii_digit())
            || !(4..=6).contains(&secret.chars().count())
        {
            return Err("PIN must contain 4-6 digits.".to_string());
        }
        return Ok(());
    }

    if !matches!(kind, "password" | "remotePassword") {
        return Err("Unsupported security credential.".to_string());
    }
    let length = secret.chars().count();
    if length < 4 {
        return Err("Password must be at least 4 characters.".to_string());
    }
    if length > MAX_PASSWORD_LENGTH {
        return Err(format!(
            "Password must be at most {MAX_PASSWORD_LENGTH} characters."
        ));
    }
    Ok(())
}

pub fn verify_credential(stored: &str, candidate: &str) -> bool {
    let mut stored_mac = CredentialHmac::new_from_slice(CREDENTIAL_COMPARISON_KEY)
        .expect("the credential comparison key is valid");
    stored_mac.update(stored.as_bytes());
    let expected = stored_mac.finalize().into_bytes();

    let mut candidate_mac = CredentialHmac::new_from_slice(CREDENTIAL_COMPARISON_KEY)
        .expect("the credential comparison key is valid");
    candidate_mac.update(candidate.as_bytes());
    candidate_mac.verify_slice(&expected).is_ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectionInputs {
    pub pin_enabled: bool,
    pub password_enabled: bool,
    pub windows_hello_enabled: bool,
    pub remote_pin_enabled: bool,
    pub remote_password_enabled: bool,
    pub pin_status: CredentialStatus,
    pub password_status: CredentialStatus,
    pub windows_hello_availability: WindowsHelloAvailability,
    pub remote_pin_status: CredentialStatus,
    pub remote_password_status: CredentialStatus,
}

pub fn reconcile_protection_view_state(inputs: ProtectionInputs) -> ProtectionViewState {
    let ProtectionInputs {
        mut pin_enabled,
        mut password_enabled,
        mut windows_hello_enabled,
        mut remote_pin_enabled,
        mut remote_password_enabled,
        pin_status,
        password_status,
        windows_hello_availability,
        remote_pin_status,
        remote_password_status,
    } = inputs;
    if !windows_hello_enabled {
        remote_pin_enabled = false;
        remote_password_enabled = false;
    }
    let mut resolution = resolve_app_lock(AppLockInputs {
        pin_enabled,
        pin_status,
        password_enabled,
        password_status,
        windows_hello_enabled,
        windows_hello_availability,
        remote_pin_enabled,
        remote_pin_status,
        remote_password_enabled,
        remote_password_status,
    });
    if resolution.has_unavailable_configured_protection() {
        if resolution.disable_unavailable_pin {
            pin_enabled = false;
        }
        if resolution.disable_unavailable_password {
            password_enabled = false;
        }
        if resolution.disable_unavailable_windows_hello {
            windows_hello_enabled = false;
            remote_pin_enabled = false;
            remote_password_enabled = false;
        } else if resolution.disable_unavailable_windows_hello_remote_pin {
            remote_pin_enabled = false;
        }
        if !resolution.disable_unavailable_windows_hello
            && resolution.disable_unavailable_windows_hello_remote_password
        {
            remote_password_enabled = false;
        }
        resolution = resolve_app_lock(AppLockInputs {
            pin_enabled,
            pin_status,
            password_enabled,
            password_status,
            windows_hello_enabled,
            windows_hello_availability,
            remote_pin_enabled,
            remote_pin_status,
            remote_password_enabled,
            remote_password_status,
        });
    }
    ProtectionViewState {
        resolution,
        pin_enabled,
        password_enabled,
        windows_hello_enabled,
        remote_pin_enabled,
        remote_password_enabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolution_prefers_pin_then_password_then_windows_hello() {
        let resolution = resolve_app_lock(AppLockInputs {
            pin_enabled: true,
            pin_status: CredentialStatus::Set,
            password_enabled: true,
            password_status: CredentialStatus::Set,
            windows_hello_enabled: true,
            windows_hello_availability: WindowsHelloAvailability::Available,
            remote_pin_enabled: false,
            remote_pin_status: CredentialStatus::NotSet,
            remote_password_enabled: false,
            remote_password_status: CredentialStatus::NotSet,
        });
        assert_eq!(resolution.mode, AppLockMode::Pin);
    }

    #[test]
    fn unavailable_methods_are_disabled_without_clearing_transient_errors() {
        let state = reconcile_protection_view_state(ProtectionInputs {
            pin_enabled: true,
            password_enabled: false,
            windows_hello_enabled: true,
            remote_pin_enabled: true,
            remote_password_enabled: true,
            pin_status: CredentialStatus::NotSet,
            password_status: CredentialStatus::NotSet,
            windows_hello_availability: WindowsHelloAvailability::Error,
            remote_pin_status: CredentialStatus::Set,
            remote_password_status: CredentialStatus::Set,
        });
        assert!(!state.pin_enabled);
        assert!(state.windows_hello_enabled);
        assert!(state.resolution.has_windows_hello_error);
    }

    #[test]
    fn protection_transitions_apply_mode_exclusivity_in_core() {
        let state = apply_protection_transition(ProtectionTransitionInputs {
            pin_enabled: false,
            password_enabled: true,
            windows_hello_enabled: true,
            remote_pin_enabled: true,
            remote_password_enabled: false,
            kind: ProtectionTransitionKind::Pin,
            enabled: true,
        });

        assert!(state.pin_enabled);
        assert!(!state.password_enabled);
        assert!(!state.windows_hello_enabled);
        assert!(state.remote_pin_enabled);
    }

    #[test]
    fn disabling_windows_hello_clears_remote_fallback_modes() {
        let state = apply_protection_transition(ProtectionTransitionInputs {
            pin_enabled: false,
            password_enabled: false,
            windows_hello_enabled: true,
            remote_pin_enabled: true,
            remote_password_enabled: true,
            kind: ProtectionTransitionKind::WindowsHello,
            enabled: false,
        });

        assert!(!state.windows_hello_enabled);
        assert!(!state.remote_pin_enabled);
        assert!(!state.remote_password_enabled);
    }

    #[test]
    fn identifies_credentials_inactive_for_the_protection_state() {
        assert_eq!(
            credential_kinds_to_clear(ProtectionTransitionState {
                pin_enabled: true,
                password_enabled: false,
                windows_hello_enabled: false,
                remote_pin_enabled: false,
                remote_password_enabled: false,
            }),
            ["password", "remotePin", "remotePassword"]
        );
        assert_eq!(
            credential_kinds_to_clear(ProtectionTransitionState {
                pin_enabled: false,
                password_enabled: false,
                windows_hello_enabled: true,
                remote_pin_enabled: true,
                remote_password_enabled: false,
            }),
            ["pin", "password", "remotePassword"]
        );
    }

    #[test]
    fn verifies_credentials_in_the_core() {
        assert!(verify_credential("1234", "1234"));
        assert!(!verify_credential("1234", "4321"));
        assert!(!verify_credential("1234", "12345"));
        assert!(verify_credential("pässword", "pässword"));
    }
}
