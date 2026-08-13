use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{normalize_timestamp_value, SortOption};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateChannel {
    Stable,
    #[serde(rename = "Pre-release")]
    PreRelease,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub show_next_code: bool,
    pub account_sort_option: SortOption,
    pub account_custom_order_ids: Vec<String>,
    pub pin_protection: bool,
    pub password_protection: bool,
    pub windows_hello: bool,
    pub remote_pin: bool,
    pub remote_password: bool,
    pub auto_lock: String,
    pub auto_start: bool,
    pub minimize_on_close: bool,
    pub minimize_to_tray: bool,
    pub show_totp_in_tray: bool,
    pub web_bridge_enabled: bool,
    pub web_bridge_notice_dismissed: bool,
    pub automatic_backup: bool,
    pub custom_backup_folder_path: String,
    pub update_on_startup: bool,
    pub update_channel: UpdateChannel,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            show_next_code: false,
            account_sort_option: SortOption::DateAddedDesc,
            account_custom_order_ids: Vec::new(),
            pin_protection: false,
            password_protection: false,
            windows_hello: false,
            remote_pin: false,
            remote_password: false,
            auto_lock: "5".to_string(),
            auto_start: false,
            minimize_on_close: false,
            minimize_to_tray: false,
            show_totp_in_tray: false,
            web_bridge_enabled: false,
            web_bridge_notice_dismissed: false,
            automatic_backup: false,
            custom_backup_folder_path: String::new(),
            update_on_startup: true,
            update_channel: UpdateChannel::Stable,
            theme: "dark".to_string(),
        }
    }
}

fn bool_value(source: &Value, name: &str, fallback: bool) -> bool {
    crate::models::get_value(source, name)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn string_value(source: &Value, name: &str, fallback: &str) -> String {
    match crate::models::get_value(source, name) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        _ => fallback.to_string(),
    }
}

fn normalize_sort(value: Option<&Value>) -> SortOption {
    let numeric = match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(value)) if value.chars().all(|character| character.is_ascii_digit()) => {
            value.parse().ok()
        }
        _ => None,
    };
    if let Some(index) = numeric {
        return [
            SortOption::DateAddedDesc,
            SortOption::DateAddedAsc,
            SortOption::AlphabeticalAsc,
            SortOption::AlphabeticalDesc,
            SortOption::CustomOrder,
            SortOption::UsageBased,
        ]
        .get(index as usize)
        .copied()
        .unwrap_or_default();
    }
    match value.and_then(Value::as_str) {
        Some("DateAddedAsc") => SortOption::DateAddedAsc,
        Some("AlphabeticalAsc") => SortOption::AlphabeticalAsc,
        Some("AlphabeticalDesc") => SortOption::AlphabeticalDesc,
        Some("CustomOrder") => SortOption::CustomOrder,
        Some("UsageBased") => SortOption::UsageBased,
        _ => SortOption::DateAddedDesc,
    }
}

fn normalize_ids(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(values)) = value else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let Some(value) = value.as_str() else {
            continue;
        };
        let value = value.trim();
        if !value.is_empty() && seen.insert(value.to_string()) {
            result.push(value.to_string());
        }
    }
    result
}

pub fn normalize_settings(source: &Value) -> AppSettings {
    let defaults = AppSettings::default();
    let empty_object = Value::Object(Map::new());
    let source = if source.is_object() {
        source
    } else {
        &empty_object
    };
    let minimize_to_tray = bool_value(source, "minimizeToTray", defaults.minimize_to_tray);
    let update_channel = match string_value(source, "updateChannel", "Stable").as_str() {
        "1" | "PreRelease" | "Pre-release" => UpdateChannel::PreRelease,
        _ => UpdateChannel::Stable,
    };
    let theme = if string_value(source, "theme", "dark") == "light" {
        "light".to_string()
    } else {
        "dark".to_string()
    };
    let allowed_auto_lock = ["0", "1", "2", "5", "10", "15", "30"];
    let auto_lock_candidate = string_value(source, "autoLock", &defaults.auto_lock);
    let auto_lock = if allowed_auto_lock.contains(&auto_lock_candidate.as_str()) {
        auto_lock_candidate
    } else {
        defaults.auto_lock
    };
    AppSettings {
        show_next_code: bool_value(source, "showNextCode", defaults.show_next_code),
        account_sort_option: normalize_sort(
            crate::models::get_value(source, "accountSortOption")
                .or_else(|| crate::models::get_value(source, "sortOption")),
        ),
        account_custom_order_ids: normalize_ids(crate::models::get_value(
            source,
            "accountCustomOrderIds",
        )),
        pin_protection: bool_value(source, "pinProtection", defaults.pin_protection),
        password_protection: bool_value(source, "passwordProtection", defaults.password_protection),
        windows_hello: bool_value(source, "windowsHello", defaults.windows_hello),
        remote_pin: bool_value(source, "remotePin", defaults.remote_pin),
        remote_password: bool_value(source, "remotePassword", defaults.remote_password),
        auto_lock,
        auto_start: bool_value(source, "autoStart", defaults.auto_start),
        minimize_on_close: bool_value(source, "minimizeOnClose", defaults.minimize_on_close)
            && !minimize_to_tray,
        minimize_to_tray,
        show_totp_in_tray: bool_value(source, "showTotpInTray", defaults.show_totp_in_tray),
        web_bridge_enabled: bool_value(source, "webBridgeEnabled", defaults.web_bridge_enabled),
        web_bridge_notice_dismissed: bool_value(
            source,
            "webBridgeNoticeDismissed",
            defaults.web_bridge_notice_dismissed,
        ),
        automatic_backup: bool_value(source, "automaticBackup", defaults.automatic_backup),
        custom_backup_folder_path: string_value(
            source,
            "customBackupFolderPath",
            &defaults.custom_backup_folder_path,
        )
        .trim()
        .to_string(),
        update_on_startup: bool_value(source, "updateOnStartup", defaults.update_on_startup),
        update_channel,
        theme,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    pub count: u64,
    pub last_used_at: Option<String>,
}

pub fn record_usage(
    entries: &mut HashMap<String, UsageEntry>,
    account_id: &str,
    now: DateTime<Utc>,
) {
    if account_id.trim().is_empty() {
        return;
    }
    let entry = entries.entry(account_id.to_string()).or_default();
    entry.count = entry.count.saturating_add(1);
    entry.last_used_at = Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
}

pub fn prune_usage(entries: &mut HashMap<String, UsageEntry>, existing_ids: &[String]) {
    let existing = existing_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    entries.retain(|id, _| existing.contains(id.as_str()));
}

pub fn normalize_usage_entry(source: &Value) -> Option<UsageEntry> {
    let count = crate::models::get_value(source, "count")
        .or_else(|| crate::models::get_value(source, "Count"))
        .and_then(|value| value.as_u64())?;
    let last_used_at = crate::models::get_value(source, "lastUsedAt")
        .or_else(|| crate::models::get_value(source, "LastUsedAt"))
        .and_then(Value::as_str)
        .and_then(normalize_timestamp_value);
    Some(UsageEntry {
        count,
        last_used_at,
    })
}

pub fn app_data_directory(platform: &str, environment: &HashMap<String, String>) -> PathBuf {
    let platform = platform.trim().to_ascii_lowercase();
    let base = match platform.as_str() {
        "win32" | "windows" => environment
            .get("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| environment.get("APPDATA").map(PathBuf::from)),
        "darwin" | "macos" | "mac" => environment
            .get("HOME")
            .map(|home| PathBuf::from(home).join("Library/Application Support")),
        _ => environment
            .get("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                environment
                    .get("HOME")
                    .map(|home| PathBuf::from(home).join(".local/share"))
            }),
    };
    base.unwrap_or_else(|| PathBuf::from("."))
        .join("WinOTP_Reborn")
}

pub fn normalize_version_string(raw_version: &str) -> String {
    let mut normalized = raw_version.trim().to_string();
    if normalized.starts_with('v') || normalized.starts_with('V') {
        normalized.remove(0);
    }
    if let Some(index) = normalized.find('+') {
        normalized.truncate(index);
    }
    normalized
}

pub fn get_app_version(
    informational_version: Option<&str>,
    assembly_version: Option<&str>,
) -> String {
    informational_version
        .filter(|version| !version.trim().is_empty())
        .map(normalize_version_string)
        .or_else(|| {
            assembly_version
                .filter(|version| !version.trim().is_empty())
                .map(|version| {
                    normalize_version_string(version)
                        .split('.')
                        .take(3)
                        .collect::<Vec<_>>()
                        .join(".")
                })
        })
        .unwrap_or_else(|| "0.0.0".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_settings_to_cross_platform_renderer_shape() {
        let settings = normalize_settings(&serde_json::json!({
            "accountSortOption": 4,
            "accountCustomOrderIds": [" a ", "a", "", 4],
            "minimizeOnClose": true,
            "minimizeToTray": true,
            "updateChannel": "Pre-release",
            "theme": "light",
            "webBridgeEnabled": true,
            "webBridgeNoticeDismissed": true,
        }));
        assert_eq!(settings.account_sort_option, SortOption::CustomOrder);
        assert_eq!(settings.account_custom_order_ids, ["a"]);
        assert!(!settings.minimize_on_close);
        assert_eq!(settings.update_channel, UpdateChannel::PreRelease);
        assert!(settings.web_bridge_enabled);
        assert!(settings.web_bridge_notice_dismissed);

        let numeric_settings = normalize_settings(&serde_json::json!({
            "autoLock": 15,
            "updateChannel": 1,
        }));
        assert_eq!(numeric_settings.auto_lock, "15");
        assert_eq!(numeric_settings.update_channel, UpdateChannel::PreRelease);
    }

    #[test]
    fn normalizes_empty_input_to_backend_defaults() {
        assert_eq!(normalize_settings(&Value::Null), AppSettings::default());
    }

    #[test]
    fn normalizes_versions_like_the_native_helper() {
        assert_eq!(
            normalize_version_string("v1.2.3-beta.1+build"),
            "1.2.3-beta.1"
        );
        assert_eq!(get_app_version(None, Some("1.2.3.4")), "1.2.3");
        assert_eq!(get_app_version(None, Some("  ")), "0.0.0");
        assert_eq!(get_app_version(None, None), "0.0.0");
    }
}
