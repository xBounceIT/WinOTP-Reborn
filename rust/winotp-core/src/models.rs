use chrono::{DateTime, Datelike, Utc};
use serde::{de::Deserializer, Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_BASE32_SECRET_LENGTH: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum OtpAlgorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

impl<'de> Deserialize<'de> for OtpAlgorithm {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(Self::parse(&value))
    }
}

impl OtpAlgorithm {
    pub fn parse(value: &Value) -> Self {
        let normalized = match value {
            Value::Number(number) => number.to_string(),
            Value::String(value) => value.trim().to_ascii_uppercase().replace('-', ""),
            _ => String::new(),
        };

        match normalized.as_str() {
            "1" | "SHA256" => Self::Sha256,
            "2" | "SHA512" => Self::Sha512,
            _ => Self::Sha1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SortOption {
    #[default]
    DateAddedDesc,
    DateAddedAsc,
    AlphabeticalAsc,
    AlphabeticalDesc,
    CustomOrder,
    UsageBased,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtpAccount {
    pub id: String,
    pub issuer: String,
    pub account_name: String,
    pub secret: String,
    pub algorithm: OtpAlgorithm,
    pub digits: u8,
    pub period: u32,
    pub created_at: String,
    #[serde(default)]
    pub usage_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

impl Default for OtpAccount {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().simple().to_string(),
            issuer: String::new(),
            account_name: String::new(),
            secret: String::new(),
            algorithm: OtpAlgorithm::default(),
            digits: 6,
            period: 30,
            created_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            usage_count: 0,
            last_used_at: None,
        }
    }
}

impl OtpAccount {
    pub fn issuer_or_account_name(&self) -> &str {
        if self.issuer.trim().is_empty() {
            &self.account_name
        } else {
            &self.issuer
        }
    }

    pub fn has_issuer(&self) -> bool {
        !self.issuer.trim().is_empty()
    }

    pub fn secondary_label(&self) -> &str {
        if self.has_issuer() {
            &self.account_name
        } else {
            ""
        }
    }

    pub fn display_label(&self) -> String {
        match (self.issuer.trim(), self.account_name.trim()) {
            ("", account_name) => account_name.to_string(),
            (issuer, "") => issuer.to_string(),
            (issuer, account_name) => format!("{issuer} ({account_name})"),
        }
    }

    pub fn resource_key(&self) -> String {
        format!("WinOTP:{}", self.id)
    }
}

pub fn get_value<'a>(source: &'a Value, name: &str) -> Option<&'a Value> {
    let object = source.as_object()?;
    object
        .iter()
        .find_map(|(key, value)| key.eq_ignore_ascii_case(name).then_some(value))
}

pub fn get_string(source: &Value, name: &str) -> String {
    match get_value(source, name) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn parse_u64(source: &Value, name: &str) -> Option<u64> {
    match get_value(source, name) {
        Some(Value::Number(value)) => value.as_u64(),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

fn normalize_timestamp(value: &str, fallback_now: DateTime<Utc>) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback_now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    }

    let parsed = DateTime::parse_from_rfc3339(trimmed)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .ok();

    match parsed {
        Some(timestamp) if timestamp.year() >= 1970 => {
            timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        }
        _ => fallback_now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }
}

pub fn normalize_timestamp_value(value: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(value.trim())
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .ok()?;
    (parsed.year() >= 1970).then(|| parsed.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

pub fn normalize_account(source: &Value, fallback_id: Option<&str>) -> Result<OtpAccount, String> {
    let empty_object = Value::Object(Default::default());
    let source = if source.is_object() {
        source
    } else {
        &empty_object
    };

    let explicit_id = get_string(source, "id");
    let id = if explicit_id.trim().is_empty() {
        fallback_id.unwrap_or_default().trim().to_string()
    } else {
        explicit_id.trim().to_string()
    };
    let id = if id.is_empty() {
        Uuid::new_v4().simple().to_string()
    } else {
        id
    };

    let issuer = get_string(source, "issuer").trim().to_string();
    let account_name = get_string(source, "accountName").trim().to_string();
    let secret = get_string(source, "secret")
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();

    if !is_valid_base32(&secret) {
        return Err("Secret is missing or not valid Base32.".to_string());
    }

    let digits = if parse_u64(source, "digits") == Some(8) {
        8
    } else {
        6
    };
    let period = parse_u64(source, "period")
        .filter(|value| *value > 0 && *value <= u32::MAX as u64)
        .map(|value| value as u32)
        .unwrap_or(30);
    let now = Utc::now();
    let created_at = normalize_timestamp(&get_string(source, "createdAt"), now);
    let last_used_at = {
        let value = get_string(source, "lastUsedAt");
        normalize_timestamp_value(&value)
    };

    Ok(OtpAccount {
        id,
        issuer,
        account_name,
        secret,
        algorithm: get_value(source, "algorithm")
            .map(OtpAlgorithm::parse)
            .unwrap_or_default(),
        digits,
        period,
        created_at,
        usage_count: parse_u64(source, "usageCount")
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .unwrap_or(0),
        last_used_at,
    })
}

pub fn parse_stored_json(json: &str, credential_id: &str) -> Result<OtpAccount, CredentialIssue> {
    if json.trim().is_empty() {
        return Err(CredentialIssue::new(
            "invalid-data",
            credential_id,
            "Stored credential payload is empty.",
        ));
    }

    let value: Value = serde_json::from_str(json).map_err(|_| {
        CredentialIssue::new(
            "invalid-json",
            credential_id,
            "Stored credential payload is not valid JSON.",
        )
    })?;

    normalize_account(&value, Some(credential_id))
        .map_err(|message| CredentialIssue::new("invalid-data", credential_id, &message))
}

pub fn is_valid_base32(input: &str) -> bool {
    let trimmed = input.trim();
    let unpadded = trimmed.trim_end_matches('=');
    !unpadded.is_empty()
        && unpadded.len() <= MAX_BASE32_SECRET_LENGTH
        && !matches!(unpadded.len() % 8, 1 | 3 | 6)
        && trimmed.starts_with(unpadded)
        && unpadded.chars().all(|character| {
            character.is_ascii_uppercase() && !"0189".contains(character)
                || ('2'..='7').contains(&character)
        })
        && trimmed[unpadded.len()..]
            .chars()
            .all(|character| character == '=')
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialIssue {
    pub code: String,
    pub credential_id: String,
    pub message: String,
}

impl CredentialIssue {
    pub fn new(code: &str, credential_id: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            credential_id: if credential_id.trim().is_empty() {
                "(unknown)".to_string()
            } else {
                credential_id.to_string()
            },
            message: message.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_label_matches_native_contract() {
        let account = OtpAccount {
            issuer: "ACME Co".to_string(),
            account_name: "jdoe@example.com".to_string(),
            ..Default::default()
        };
        assert_eq!(account.issuer_or_account_name(), "ACME Co");
        assert_eq!(account.secondary_label(), "jdoe@example.com");
        assert_eq!(account.display_label(), "ACME Co (jdoe@example.com)");
    }

    #[test]
    fn normalizes_legacy_pascal_case_payload() {
        let payload = serde_json::json!({
            "Id": "legacy-id",
            "Issuer": " ACME ",
            "AccountName": " jdoe ",
            "Secret": " jbsw y3dp ehpk3pxp ",
            "Algorithm": 2,
            "Digits": 8,
            "Period": 45,
        });
        let account = normalize_account(&payload, None).unwrap();
        assert_eq!(account.id, "legacy-id");
        assert_eq!(account.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(account.algorithm, OtpAlgorithm::Sha512);
        assert_eq!(account.digits, 8);
        assert_eq!(account.period, 45);
    }

    #[test]
    fn validates_base32_padding_without_accepting_invalid_characters() {
        assert!(is_valid_base32("JBSWY3DPEHPK3PXP=="));
        assert!(!is_valid_base32("JBSWY3DPEHPK3PXP=bad"));
        assert!(!is_valid_base32("NOT-BASE32"));
        assert!(!is_valid_base32("A"));
        assert!(!is_valid_base32("ABC"));
        assert!(!is_valid_base32("ABCDEF"));
        assert!(!is_valid_base32(&"A".repeat(MAX_BASE32_SECRET_LENGTH + 1)));
    }

    #[test]
    fn deserializes_legacy_numeric_algorithm_values() {
        let account: OtpAccount = serde_json::from_value(serde_json::json!({
            "id": "legacy-account",
            "issuer": "ACME",
            "accountName": "jdoe@example.com",
            "secret": "JBSWY3DPEHPK3PXP",
            "algorithm": 2,
            "digits": 6,
            "period": 30,
            "createdAt": "2026-08-03T00:00:00.000Z"
        }))
        .unwrap();

        assert_eq!(account.algorithm, OtpAlgorithm::Sha512);
    }

    #[test]
    fn clamps_usage_counts_that_cannot_round_trip_through_json_numbers() {
        let account = normalize_account(
            &serde_json::json!({
                "id": "account-1",
                "secret": "JBSWY3DPEHPK3PXP",
                "usageCount": u64::MAX,
            }),
            None,
        )
        .unwrap();

        assert_eq!(account.usage_count, 0);
    }
}
