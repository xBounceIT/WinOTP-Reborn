use std::collections::BTreeSet;

use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL},
    Engine,
};
use getrandom::fill as random_fill;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const PROTOCOL_VERSION: u64 = 1;
const INVALID_REQUEST_ID: &str = "invalid-request";
const ACCOUNT_ID_PREFIX: &str = "account-";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationMaterial {
    pub auth_token: String,
    pub endpoint_id: String,
}

pub fn create_authentication_material() -> Result<AuthenticationMaterial, String> {
    let mut random = [0_u8; 48];
    random_fill(&mut random)
        .map_err(|_| "Browser bridge authentication material is unavailable.".to_string())?;
    Ok(AuthenticationMaterial {
        auth_token: BASE64_URL.encode(&random[..32]),
        endpoint_id: hex::encode(&random[32..]),
    })
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    object.keys().map(String::as_str).collect::<BTreeSet<_>>()
        == expected.iter().copied().collect::<BTreeSet<_>>()
}

fn valid_protocol_id(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphanumeric())
        && value.len() <= 128
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
}

fn tokens_match(left: &str, right: &str) -> bool {
    left.len() == right.len() && bool::from(left.as_bytes().ct_eq(right.as_bytes()))
}

fn valid_auth_token(value: &str) -> bool {
    (43..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn authenticate_request(encoded_body: &str, expected_token: &str) -> Option<Value> {
    let body = BASE64.decode(encoded_body).ok()?;
    let value: Value = serde_json::from_slice(&body).ok()?;
    let object = value.as_object()?;
    let auth = object.get("auth")?.as_object()?;
    let provided_token = auth.get("token")?.as_str()?;
    if !exact_keys(auth, &["scheme", "token"])
        || auth.get("scheme").and_then(Value::as_str) != Some("ephemeral-token")
        || !valid_auth_token(expected_token)
        || !valid_auth_token(provided_token)
        || !tokens_match(provided_token, expected_token)
    {
        return None;
    }

    let fallback_request_id = object
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| valid_protocol_id(value))
        .unwrap_or(INVALID_REQUEST_ID);
    let invalid = |request_id: &str| json!({ "ok": false, "requestId": request_id });
    if !exact_keys(object, &["version", "requestId", "auth", "request"]) {
        return Some(invalid(fallback_request_id));
    }
    let Some(request) = object.get("request").and_then(Value::as_object) else {
        return Some(invalid(fallback_request_id));
    };
    let Some(request_id) = request
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| valid_protocol_id(value))
    else {
        return Some(invalid(INVALID_REQUEST_ID));
    };
    if request_id == INVALID_REQUEST_ID
        || object.get("requestId").and_then(Value::as_str) != Some(request_id)
        || request.get("method").and_then(Value::as_str).is_none()
    {
        return Some(invalid(request_id));
    }
    if object.get("version").and_then(Value::as_u64) != Some(PROTOCOL_VERSION)
        || request.get("version").and_then(Value::as_u64) != Some(PROTOCOL_VERSION)
    {
        return Some(json!({
            "ok": false,
            "requestId": request_id,
            "errorCode": "UNSUPPORTED_PROTOCOL",
        }));
    }

    let method = request.get("method").and_then(Value::as_str)?;
    if matches!(method, "getStatus" | "listAccounts") {
        return Some(
            if exact_keys(request, &["version", "requestId", "method"]) {
                json!({ "ok": true, "requestId": request_id, "method": method })
            } else {
                invalid(request_id)
            },
        );
    }
    if method == "getTotp" {
        let params = request.get("params").and_then(Value::as_object);
        let account_id = params
            .and_then(|value| value.get("accountId"))
            .and_then(Value::as_str);
        return Some(
            if exact_keys(request, &["version", "requestId", "method", "params"])
                && params.is_some_and(|value| exact_keys(value, &["accountId"]))
                && account_id.is_some_and(valid_protocol_id)
            {
                json!({
                    "ok": true,
                    "requestId": request_id,
                    "method": method,
                    "accountId": account_id,
                })
            } else {
                invalid(request_id)
            },
        );
    }
    if method == "importQr" {
        let params = request.get("params").and_then(Value::as_object);
        let text = params
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str);
        return Some(
            if exact_keys(request, &["version", "requestId", "method", "params"])
                && params.is_some_and(|value| exact_keys(value, &["text"]))
                && text.is_some_and(valid_qr_text)
            {
                let text = text.unwrap();
                json!({
                    "ok": true, "requestId": request_id, "method": method,
                    "text": text, "fingerprint": hex::encode(Sha256::digest(text.as_bytes())),
                })
            } else {
                invalid(request_id)
            },
        );
    }
    Some(invalid(request_id))
}

fn valid_qr_text(text: &str) -> bool {
    text.len() <= 8192
        && !text.bytes().any(|byte| byte.is_ascii_control())
        && ["otpauth://", "otpauth-migration://"].iter().any(|prefix| {
            text.get(..prefix.len())
                .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
        })
}

pub fn project_account_id(account_id: &str) -> Result<String, String> {
    let account_id = account_id.trim();
    if account_id.is_empty() {
        return Err("Browser bridge account id is empty.".to_string());
    }
    let digest = Sha256::digest(account_id.as_bytes());
    Ok(format!("{ACCOUNT_ID_PREFIX}{}", hex::encode(digest)))
}

pub fn project_account_ids(account_ids: &[String]) -> Result<Vec<String>, String> {
    account_ids
        .iter()
        .map(|account_id| project_account_id(account_id))
        .collect()
}

pub fn resolve_account_id(
    bridge_account_id: &str,
    account_ids: &[String],
) -> Result<Option<String>, String> {
    if bridge_account_id.len() != ACCOUNT_ID_PREFIX.len() + 64
        || !bridge_account_id.starts_with(ACCOUNT_ID_PREFIX)
        || !bridge_account_id[ACCOUNT_ID_PREFIX.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Ok(None);
    }
    for account_id in account_ids {
        let normalized = account_id.trim();
        if !normalized.is_empty() && project_account_id(normalized)? == bridge_account_id {
            return Ok(Some(normalized.to_string()));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qr_request(text: Value) -> Value {
        json!({
            "version": 1, "requestId": "scan-1",
            "auth": { "scheme": "ephemeral-token", "token": "a".repeat(43) },
            "request": { "version": 1, "requestId": "scan-1", "method": "importQr", "params": { "text": text } },
        })
    }

    fn authenticate(value: &Value) -> Value {
        authenticate_request(
            &BASE64.encode(serde_json::to_vec(value).unwrap()),
            &"a".repeat(43),
        )
        .unwrap()
    }

    #[test]
    fn qr_transport_is_closed_authenticated_and_byte_bounded() {
        for prefix in [
            "otpauth://",
            "OtPaUtH://",
            "otpauth-migration://",
            "OTPAUTH-MIGRATION://",
        ] {
            let text = format!("{prefix}{}", "a".repeat(8192 - prefix.len()));
            let value = qr_request(json!(text));
            let result = authenticate(&value);
            assert_eq!(result["ok"], true);
            assert_eq!(result["text"], text);
            assert_eq!(result["fingerprint"].as_str().unwrap().len(), 64);
            assert_eq!(result, authenticate(&value));
            let too_long = qr_request(json!(format!("{text}a")));
            assert_eq!(authenticate(&too_long)["ok"], false);
        }
        for text in [
            json!(null),
            json!(true),
            json!(42),
            json!([]),
            json!({}),
            json!(""),
            json!("https://example.test"),
            json!(" otpauth://test"),
            json!(format!("otpauth://{}", "é".repeat(4092))),
        ] {
            assert_eq!(authenticate(&qr_request(text))["ok"], false);
        }
        for byte in (0u8..=31).chain(std::iter::once(127)) {
            assert_eq!(
                authenticate(&qr_request(json!(format!(
                    "otpauth://a{}b",
                    char::from(byte)
                ))))["ok"],
                false
            );
        }
        let valid = qr_request(json!("otpauth://totp/A?secret=JBSWY3DPEHPK3PXP"));
        for (path, key) in [
            ("", "extra"),
            ("/request", "extra"),
            ("/request/params", "extra"),
        ] {
            let mut value = valid.clone();
            value.pointer_mut(path).unwrap()[key] = json!("never");
            let rejected = authenticate(&value);
            assert_eq!(rejected, json!({ "ok": false, "requestId": "scan-1" }));
        }
        for params in [Value::Null, json!("text"), json!([]), json!({})] {
            let mut value = valid.clone();
            value["request"]["params"] = params;
            assert_eq!(authenticate(&value)["ok"], false);
        }
        let mut value = valid.clone();
        value["request"]["requestId"] = json!("invalid id");
        assert_eq!(
            authenticate(&value),
            json!({ "ok": false, "requestId": "invalid-request" })
        );
        value = valid.clone();
        value["request"]["requestId"] = json!("other-id");
        assert_eq!(authenticate(&value)["ok"], false);
        value = valid.clone();
        value["request"]["version"] = json!(2);
        assert_eq!(authenticate(&value)["errorCode"], "UNSUPPORTED_PROTOCOL");
        let body = BASE64.encode(serde_json::to_vec(&valid).unwrap());
        assert!(authenticate_request(&body, &"b".repeat(43)).is_none());
    }

    #[test]
    fn generates_private_authentication_material() {
        let first = create_authentication_material().unwrap();
        let second = create_authentication_material().unwrap();
        assert_eq!(first.auth_token.len(), 43);
        assert!(first
            .auth_token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')));
        assert_eq!(first.endpoint_id.len(), 32);
        assert_ne!(first.auth_token, second.auth_token);
        assert_ne!(first.endpoint_id, second.endpoint_id);
    }

    #[test]
    fn authenticates_before_returning_a_closed_request() {
        let token = "a".repeat(43);
        let request = json!({
            "version": 1,
            "requestId": "request-1",
            "auth": { "scheme": "ephemeral-token", "token": token },
            "request": { "version": 1, "requestId": "request-1", "method": "getStatus" },
        });
        let body = BASE64.encode(serde_json::to_vec(&request).unwrap());
        assert_eq!(
            authenticate_request(&body, &"a".repeat(43)).unwrap(),
            json!({ "ok": true, "requestId": "request-1", "method": "getStatus" })
        );
        assert!(authenticate_request(&body, &"b".repeat(43)).is_none());
        assert!(authenticate_request(&body, "").is_none());

        let mut extra = request;
        extra["extra"] = Value::Bool(true);
        let extra_body = BASE64.encode(serde_json::to_vec(&extra).unwrap());
        assert_eq!(
            authenticate_request(&extra_body, &"a".repeat(43)).unwrap(),
            json!({ "ok": false, "requestId": "request-1" })
        );

        let invalid_request = json!({
            "version": 1,
            "requestId": "request-1",
            "auth": { "scheme": "ephemeral-token", "token": "a".repeat(43) },
            "request": "invalid",
        });
        let invalid_body = BASE64.encode(serde_json::to_vec(&invalid_request).unwrap());
        assert_eq!(
            authenticate_request(&invalid_body, &"a".repeat(43)).unwrap(),
            json!({ "ok": false, "requestId": "request-1" })
        );
    }

    #[test]
    fn projects_every_nonempty_backend_account_id_to_the_transport() {
        let source = " legacy account 🔐 ".repeat(20);
        let bridge_id = project_account_id(&source).unwrap();
        assert_eq!(bridge_id.len(), 72);
        assert!(valid_protocol_id(&bridge_id));
        assert_eq!(
            resolve_account_id(&bridge_id, std::slice::from_ref(&source)).unwrap(),
            Some(source.trim().to_string())
        );
        assert_eq!(
            resolve_account_id(&format!("{bridge_id}0"), &[source]).unwrap(),
            None
        );
    }
}
