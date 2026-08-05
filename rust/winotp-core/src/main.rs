use std::io::{self, Read};

use serde_json::{json, Value};

use winotp_core::{
    backup, import, models, ordering, otp, platform, screen_capture, security, settings,
};

fn error_response(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

fn dispatch(request: Value) -> Value {
    match dispatch_inner(request) {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => error_response(error),
    }
}

fn dispatch_inner(request: Value) -> Result<Value, String> {
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let empty_input = Value::Null;
    let input = request.get("input").unwrap_or(&empty_input);

    let result = match operation {
        "normalize-account" => {
            let fallback_id = input.get("fallbackId").and_then(Value::as_str);
            models::normalize_account(input.get("source").unwrap_or(&Value::Null), fallback_id)
                .map(|account| serde_json::to_value(account).unwrap())
        }
        "normalize-accounts" => {
            let entries = input
                .get("accounts")
                .and_then(Value::as_array)
                .ok_or_else(|| "Account normalization input is invalid.".to_string())?;
            let results = entries
                .iter()
                .map(|entry| {
                    let source = entry.get("source").unwrap_or(&Value::Null);
                    let fallback_id = entry.get("fallbackId").and_then(Value::as_str);
                    match models::normalize_account(source, fallback_id) {
                        Ok(account) => json!({
                            "ok": true,
                            "account": serde_json::to_value(account).unwrap(),
                        }),
                        Err(error) => json!({
                            "ok": false,
                            "error": error,
                        }),
                    }
                })
                .collect::<Vec<_>>();
            Ok(Value::Array(results))
        }
        "parse-stored-json" => {
            let json_value = input
                .get("json")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let credential_id = input
                .get("credentialId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            models::parse_stored_json(json_value, credential_id)
                .map(|account| serde_json::to_value(account).unwrap())
                .map_err(|issue| issue.message)
        }
        "parse-otp-uri" => {
            import::parse_otp_uri(input.get("uri").and_then(Value::as_str).unwrap_or_default())
                .map(|account| serde_json::to_value(account).unwrap())
                .ok_or_else(|| "The OTP URI is invalid or unsupported.".to_string())
        }
        "parse-winauth-line" => {
            import::parse_winauth_line(input.get("line").and_then(Value::as_str))
                .map(|account| serde_json::to_value(account).unwrap())
        }
        "parse-legacy-account" => import::parse_legacy_account(
            input
                .get("entryId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            input.get("source").unwrap_or(&Value::Null),
        )
        .map(|account| serde_json::to_value(account).unwrap()),
        "parse-legacy-json" => import::parse_legacy_json(
            input
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )
        .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string())),
        "parse-winauth-text" => {
            import::parse_winauth_text(input.get("content").and_then(Value::as_str))
                .and_then(|result| serde_json::to_value(result).map_err(|error| error.to_string()))
        }
        "totp-code" => {
            let account =
                models::normalize_account(input.get("account").unwrap_or(&Value::Null), None)?;
            let timestamp = input
                .get("unixSeconds")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp());
            let code = otp::generate_totp_code_at(&account, timestamp)?;
            Ok(json!({
                "code": code,
                "remainingSeconds": otp::remaining_seconds(&account, timestamp),
            }))
        }
        "totp-codes" => {
            let accounts = input
                .get("accounts")
                .and_then(Value::as_array)
                .ok_or_else(|| "TOTP input is invalid.".to_string())?;
            let timestamp = input
                .get("unixSeconds")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp());
            let results = accounts
                .iter()
                .map(|value| {
                    let account = models::normalize_account(value, None);
                    match account {
                        Ok(account) => match otp::generate_totp_code_at(&account, timestamp) {
                            Ok(code) => json!({
                                "ok": true,
                                "code": code,
                                "remainingSeconds": otp::remaining_seconds(&account, timestamp),
                            }),
                            Err(error) => json!({
                                "ok": false,
                                "error": error,
                            }),
                        },
                        Err(error) => json!({
                            "ok": false,
                            "error": error.to_string(),
                        }),
                    }
                })
                .collect::<Vec<_>>();
            Ok(Value::Array(results))
        }
        "totp-previews" => {
            let accounts = input
                .get("accounts")
                .and_then(Value::as_array)
                .ok_or_else(|| "TOTP input is invalid.".to_string())?;
            let timestamp = input
                .get("unixSeconds")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| chrono::Utc::now().timestamp());
            let results = accounts
                .iter()
                .map(|value| {
                    let account = models::normalize_account(value, None);
                    match account {
                        Ok(account) => {
                            let remaining = otp::remaining_seconds(&account, timestamp);
                            let current = otp::generate_totp_code_at(&account, timestamp);
                            let next = otp::generate_totp_code_at(
                                &account,
                                timestamp.saturating_add(remaining),
                            );
                            match (current, next) {
                                (Ok(code), Ok(next_code)) => json!({
                                    "ok": true,
                                    "code": code,
                                    "nextCode": next_code,
                                    "remainingSeconds": remaining,
                                }),
                                (Err(error), _) | (_, Err(error)) => json!({
                                    "ok": false,
                                    "error": error,
                                    "remainingSeconds": remaining,
                                }),
                            }
                        }
                        Err(error) => json!({
                            "ok": false,
                            "error": error,
                        }),
                    }
                })
                .collect::<Vec<_>>();
            Ok(Value::Array(results))
        }
        "windows-hello-availability" => {
            platform::windows_hello_availability().map(|status| json!({ "status": status }))
        }
        "windows-hello-verify" => {
            let window_handle = parse_window_handle(input.get("windowHandle"))?;
            platform::windows_hello_verify(window_handle).map(|status| json!({ "status": status }))
        }
        "session-notification-register" => {
            let window_handle = parse_window_handle(input.get("windowHandle"))?;
            platform::register_session_notification(window_handle).map(|()| {
                json!({
                    "status": "registered"
                })
            })
        }
        "session-notification-unregister" => {
            let window_handle = parse_window_handle(input.get("windowHandle"))?;
            platform::unregister_session_notification(window_handle).map(|()| {
                json!({
                    "status": "unregistered"
                })
            })
        }
        "read-legacy-credentials" => {
            let resources = input
                .get("resources")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec!["WinOTP".to_string()]);
            serde_json::to_value(platform::read_legacy_credentials(&resources)?)
                .map_err(|error| error.to_string())
        }
        "backup-encrypt" => {
            let accounts = serde_json::from_value::<Vec<models::OtpAccount>>(
                input.get("accounts").cloned().unwrap_or_else(|| json!([])),
            )
            .map_err(|error| error.to_string())?;
            let password = input
                .get("password")
                .and_then(Value::as_str)
                .unwrap_or_default();
            backup::encrypt_payload(
                accounts,
                password,
                input
                    .get("exportedAtUtc")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            )
            .and_then(|envelope| {
                serde_json::to_value(envelope).map_err(|_| backup::BackupError::InvalidPayload)
            })
            .map_err(|error| error.to_string())
        }
        "backup-decrypt" => {
            let envelope = serde_json::from_value::<backup::BackupEnvelope>(
                input.get("envelope").cloned().unwrap_or(Value::Null),
            )
            .map_err(|error| error.to_string())?;
            let password = input
                .get("password")
                .and_then(Value::as_str)
                .unwrap_or_default();
            backup::decrypt_payload(&envelope, password)
                .and_then(|payload| {
                    serde_json::to_value(payload).map_err(|_| backup::BackupError::InvalidPayload)
                })
                .map_err(|error| error.to_string())
        }
        "normalize-settings" => serde_json::to_value(settings::normalize_settings(input))
            .map_err(|error| error.to_string()),
        "sort-accounts" => {
            let accounts = serde_json::from_value::<Vec<models::OtpAccount>>(
                input.get("accounts").cloned().unwrap_or_else(|| json!([])),
            )
            .map_err(|error| error.to_string())?;
            let sort_option = parse_sort_option(input.get("sortOption"));
            let custom_order_ids = parse_string_vec(input.get("customOrderIds"));
            serde_json::to_value(ordering::sort_accounts(
                &accounts,
                sort_option,
                &custom_order_ids,
            ))
            .map_err(|error| error.to_string())
        }
        "prune-custom-order-ids" => {
            let accounts = serde_json::from_value::<Vec<models::OtpAccount>>(
                input.get("accounts").cloned().unwrap_or_else(|| json!([])),
            )
            .map_err(|error| error.to_string())?;
            let order_ids = parse_string_vec(input.get("orderIds"));
            Ok(json!(ordering::prune_custom_order_ids(
                &order_ids, &accounts
            )))
        }
        "validate-security-credential" => {
            let kind = input
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let secret = input
                .get("secret")
                .and_then(Value::as_str)
                .unwrap_or_default();
            security::validate_credential(kind, secret).map(|()| json!({}))
        }
        "order-drop-index" => {
            let bounds = serde_json::from_value::<Vec<ordering::ItemBounds>>(
                input.get("bounds").cloned().unwrap_or_else(|| json!([])),
            )
            .map_err(|error| error.to_string())?;
            let x = input.get("x").and_then(Value::as_f64).unwrap_or(0.0);
            let y = input.get("y").and_then(Value::as_f64).unwrap_or(0.0);
            Ok(json!(ordering::get_drop_insertion_index(&bounds, x, y)))
        }
        "order-project" => {
            let order_ids = parse_string_vec(input.get("orderIds"));
            let dragged_id = input
                .get("draggedId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let insertion_index = input
                .get("insertionIndex")
                .and_then(Value::as_i64)
                .unwrap_or(0) as i32;
            Ok(json!(ordering::project_order(
                &order_ids,
                dragged_id,
                insertion_index,
            )))
        }
        "resolve-app-lock" => {
            let resolution = security::resolve_app_lock(security::AppLockInputs {
                pin_enabled: input
                    .get("pinEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                pin_status: parse_credential_status(input.get("pinStatus")),
                password_enabled: input
                    .get("passwordEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                password_status: parse_credential_status(input.get("passwordStatus")),
                windows_hello_enabled: input
                    .get("windowsHelloEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                windows_hello_availability: parse_hello_availability(
                    input.get("windowsHelloAvailability"),
                ),
                remote_pin_enabled: input
                    .get("remotePinEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                remote_pin_status: parse_credential_status(input.get("remotePinStatus")),
                remote_password_enabled: input
                    .get("remotePasswordEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                remote_password_status: parse_credential_status(input.get("remotePasswordStatus")),
            });
            serde_json::to_value(resolution).map_err(|error| error.to_string())
        }
        "reconcile-protection" => {
            let state = security::reconcile_protection_view_state(security::ProtectionInputs {
                pin_enabled: input
                    .get("pinEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                password_enabled: input
                    .get("passwordEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                windows_hello_enabled: input
                    .get("windowsHelloEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                remote_pin_enabled: input
                    .get("remotePinEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                remote_password_enabled: input
                    .get("remotePasswordEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                pin_status: parse_credential_status(input.get("pinStatus")),
                password_status: parse_credential_status(input.get("passwordStatus")),
                windows_hello_availability: parse_hello_availability(
                    input.get("windowsHelloAvailability"),
                ),
                remote_pin_status: parse_credential_status(input.get("remotePinStatus")),
                remote_password_status: parse_credential_status(input.get("remotePasswordStatus")),
            });
            serde_json::to_value(state).map_err(|error| error.to_string())
        }
        "format-import-summary" => Ok(json!({
            "message": import::import_summary(
                input.get("successCount").and_then(Value::as_u64).unwrap_or(0),
                input.get("failCount").and_then(Value::as_u64).unwrap_or(0),
                input.get("skippedCount").and_then(Value::as_u64).unwrap_or(0),
                input.get("skippedLabel").and_then(Value::as_str),
                input.get("replacedCount").and_then(Value::as_u64).unwrap_or(0),
                input.get("additionalMessage").and_then(Value::as_str),
            )
        })),
        "screen-capture-map" => {
            let rect = screen_capture::map_to_pixel_rect(
                screen_capture::CaptureSelection {
                    x: input
                        .get("selectionX")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    y: input
                        .get("selectionY")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    width: input
                        .get("selectionWidth")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    height: input
                        .get("selectionHeight")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                },
                screen_capture::CaptureCanvas {
                    width: input
                        .get("canvasWidth")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    height: input
                        .get("canvasHeight")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                },
                screen_capture::CaptureImage {
                    width: input.get("imageWidth").and_then(Value::as_i64).unwrap_or(0) as i32,
                    height: input
                        .get("imageHeight")
                        .and_then(Value::as_i64)
                        .unwrap_or(0) as i32,
                },
            )
            .ok_or_else(|| "The screen selection is invalid.".to_string())?;
            serde_json::to_value(rect).map_err(|error| error.to_string())
        }
        "screen-capture-expand" => {
            let rect = serde_json::from_value::<screen_capture::PixelRect>(
                input.get("rect").cloned().unwrap_or(Value::Null),
            )
            .map_err(|error| error.to_string())?;
            serde_json::to_value(screen_capture::expand(
                rect,
                input.get("imageWidth").and_then(Value::as_i64).unwrap_or(0) as i32,
                input
                    .get("imageHeight")
                    .and_then(Value::as_i64)
                    .unwrap_or(0) as i32,
                input.get("padding").and_then(Value::as_i64).unwrap_or(0) as i32,
            ))
            .map_err(|error| error.to_string())
        }
        "screen-capture-padding" => {
            let rect = serde_json::from_value::<screen_capture::PixelRect>(
                input.get("rect").cloned().unwrap_or(Value::Null),
            )
            .map_err(|error| error.to_string())?;
            Ok(json!(screen_capture::quiet_zone_padding(rect)))
        }
        "version" => Ok(json!({
            "version": settings::get_app_version(
                input.get("informationalVersion").and_then(Value::as_str),
                input.get("assemblyVersion").and_then(Value::as_str),
            )
        })),
        _ => Err(format!("Unsupported WinOTP core operation: {operation}")),
    };

    result
}

fn parse_credential_status(value: Option<&Value>) -> security::CredentialStatus {
    match value.and_then(Value::as_str).unwrap_or_default() {
        "Set" | "set" => security::CredentialStatus::Set,
        "Error" | "error" => security::CredentialStatus::Error,
        _ => security::CredentialStatus::NotSet,
    }
}

fn parse_string_vec(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_sort_option(value: Option<&Value>) -> models::SortOption {
    match value {
        Some(Value::Number(number)) => match number.as_u64() {
            Some(1) => models::SortOption::DateAddedAsc,
            Some(2) => models::SortOption::AlphabeticalAsc,
            Some(3) => models::SortOption::AlphabeticalDesc,
            Some(4) => models::SortOption::CustomOrder,
            Some(5) => models::SortOption::UsageBased,
            _ => models::SortOption::DateAddedDesc,
        },
        Some(Value::String(value)) => match value.trim() {
            "DateAddedAsc" => models::SortOption::DateAddedAsc,
            "AlphabeticalAsc" => models::SortOption::AlphabeticalAsc,
            "AlphabeticalDesc" => models::SortOption::AlphabeticalDesc,
            "CustomOrder" => models::SortOption::CustomOrder,
            "UsageBased" => models::SortOption::UsageBased,
            "1" => models::SortOption::DateAddedAsc,
            "2" => models::SortOption::AlphabeticalAsc,
            "3" => models::SortOption::AlphabeticalDesc,
            "4" => models::SortOption::CustomOrder,
            "5" => models::SortOption::UsageBased,
            _ => models::SortOption::DateAddedDesc,
        },
        _ => models::SortOption::DateAddedDesc,
    }
}

fn parse_window_handle(value: Option<&Value>) -> Result<u64, String> {
    match value {
        Some(Value::String(value)) => value
            .trim()
            .parse::<u64>()
            .map_err(|_| "The application window handle is invalid.".to_string()),
        Some(Value::Number(value)) => value
            .as_u64()
            .ok_or_else(|| "The application window handle is invalid.".to_string()),
        _ => Err("The application window handle is required.".to_string()),
    }
}

fn parse_hello_availability(value: Option<&Value>) -> security::WindowsHelloAvailability {
    match value.and_then(Value::as_str).unwrap_or_default() {
        "Available" | "available" => security::WindowsHelloAvailability::Available,
        "RemoteSession" | "remote-session" => security::WindowsHelloAvailability::RemoteSession,
        "Error" | "error" => security::WindowsHelloAvailability::Error,
        _ => security::WindowsHelloAvailability::Unavailable,
    }
}

fn main() {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        println!(
            "{}",
            error_response("Unable to read the WinOTP core request.")
        );
        return;
    }
    let response = match serde_json::from_str::<Value>(&input) {
        Ok(request) => dispatch(request),
        Err(error) => error_response(format!("Invalid WinOTP core request: {error}")),
    };
    println!("{response}");
}
