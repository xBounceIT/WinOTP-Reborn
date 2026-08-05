use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use url::Url;
use uuid::Uuid;

use crate::models::{
    get_string, is_valid_base32, normalize_timestamp_value, OtpAccount, OtpAlgorithm,
};

fn decode_component(value: &str) -> Option<String> {
    percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
}

fn parse_query(query: Option<&str>) -> Option<Vec<(String, String)>> {
    let mut values = Vec::new();
    for pair in query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        values.push((decode_component(key)?, decode_component(value)?));
    }
    Some(values)
}

fn query_value(query: &[(String, String)], name: &str) -> Option<String> {
    query
        .iter()
        .rev()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

fn parse_positive_i64(value: Option<String>) -> Option<i64> {
    let value = value?;
    let value = value.trim().strip_prefix('+').unwrap_or(value.trim());
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|value| *value > 0)
}

pub fn parse_otp_uri(uri: &str) -> Option<OtpAccount> {
    let parsed = Url::parse(uri.trim()).ok()?;
    if !parsed.scheme().eq_ignore_ascii_case("otpauth")
        || !parsed.host_str()?.eq_ignore_ascii_case("totp")
    {
        return None;
    }

    let query = parse_query(parsed.query())?;
    let secret = query_value(&query, "secret")?
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    if !is_valid_base32(&secret) {
        return None;
    }

    let label = decode_component(parsed.path().trim_start_matches('/'))?;
    let (label_issuer, account_name) = match label.split_once(':') {
        Some((issuer, account_name)) => {
            (issuer.trim().to_string(), account_name.trim().to_string())
        }
        None => (String::new(), label.trim().to_string()),
    };
    let issuer = query_value(&query, "issuer")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(label_issuer)
        .trim()
        .to_string();
    if issuer.is_empty() && account_name.is_empty() {
        return None;
    }

    let digits = parse_positive_i64(query_value(&query, "digits"))
        .filter(|digits| *digits == 8)
        .map(|_| 8)
        .unwrap_or(6);
    let period = parse_positive_i64(query_value(&query, "period"))
        .filter(|period| *period <= u32::MAX as i64)
        .map(|period| period as u32)
        .unwrap_or(30);
    let algorithm = match query_value(&query, "algorithm")
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase()
        .as_str()
    {
        "SHA256" => OtpAlgorithm::Sha256,
        "SHA512" => OtpAlgorithm::Sha512,
        _ => OtpAlgorithm::Sha1,
    };

    Some(OtpAccount {
        id: Uuid::new_v4().simple().to_string(),
        issuer,
        account_name,
        secret,
        algorithm,
        digits,
        period,
        ..Default::default()
    })
}

pub fn parse_winauth_line(raw_line: Option<&str>) -> Result<OtpAccount, String> {
    let line = raw_line.unwrap_or_default().trim();
    if line.is_empty() {
        return Err("Line is empty.".to_string());
    }
    if !line.to_ascii_lowercase().starts_with("otpauth://") {
        return Err("Line is not an otpauth URI.".to_string());
    }

    let normalized = line.replace('+', "%20");
    let mut account =
        parse_otp_uri(&normalized).ok_or_else(|| "Line is invalid or unsupported.".to_string())?;
    let icon_query = Url::parse(&normalized)
        .ok()
        .and_then(|uri| parse_query(uri.query()));
    if account.issuer.trim().is_empty()
        && !account.account_name.trim().is_empty()
        && icon_query
            .as_deref()
            .and_then(|query| query_value(query, "icon"))
            .is_some_and(|icon| icon.eq_ignore_ascii_case("WinAuth"))
    {
        account.issuer = account.account_name.clone();
        account.account_name.clear();
    }
    Ok(account)
}

pub fn parse_legacy_account(entry_id: &str, source: &Value) -> Result<OtpAccount, String> {
    if source.is_null() {
        return Err(format!("Entry {entry_id} is null."));
    }

    let secret = get_string(source, "secret");
    if secret.trim().is_empty() {
        return Err(format!("Entry {entry_id} has an empty secret."));
    }

    let created = get_string(source, "created");
    let created_at = normalize_timestamp_value(&created)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    Ok(OtpAccount {
        id: Uuid::new_v4().simple().to_string(),
        issuer: get_string(source, "issuer"),
        account_name: get_string(source, "name"),
        secret,
        algorithm: OtpAlgorithm::Sha1,
        digits: 6,
        period: 30,
        created_at,
        usage_count: 0,
        last_used_at: None,
    })
}

pub fn import_summary(
    success_count: u64,
    fail_count: u64,
    skipped_count: u64,
    skipped_label: Option<&str>,
    replaced_count: u64,
    additional_message: Option<&str>,
) -> String {
    let mut message =
        format!("Import completed:\n• {success_count} account(s) imported successfully");
    if replaced_count > 0 {
        message.push_str(&format!(
            "\n• {replaced_count} existing account(s) replaced"
        ));
    }
    if fail_count > 0 {
        message.push_str(&format!("\n• {fail_count} account(s) failed to import"));
    }
    if skipped_count > 0 {
        let label = skipped_label
            .filter(|label| !label.is_empty())
            .map(|label| format!(" ({label})"))
            .unwrap_or_default();
        message.push_str(&format!("\n• {skipped_count} account(s) skipped{label}"));
    }
    if let Some(additional_message) = additional_message.filter(|message| !message.is_empty()) {
        message.push_str("\n\n");
        message.push_str(additional_message);
    }
    message
}

pub fn legacy_account_to_value(entry_id: &str, source: &Value) -> Result<Value, String> {
    Ok(serde_json::to_value(parse_legacy_account(entry_id, source)?).unwrap_or_else(|_| json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_otp_uri_without_treating_plus_as_space() {
        let account = parse_otp_uri("otpauth://totp/My+Service?secret=JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(account.account_name, "My+Service");
    }

    #[test]
    fn maps_winauth_issuer_only_lines() {
        let account = parse_winauth_line(Some(
            "otpauth://totp/Service?secret=JBSWY3DPEHPK3PXP&icon=WinAuth",
        ))
        .unwrap();
        assert_eq!(account.issuer, "Service");
        assert!(account.account_name.is_empty());
    }

    #[test]
    fn summary_has_stable_section_order() {
        assert_eq!(
            import_summary(1, 2, 3, Some("invalid"), 4, Some("Done.")),
            "Import completed:\n• 1 account(s) imported successfully\n• 4 existing account(s) replaced\n• 2 account(s) failed to import\n• 3 account(s) skipped (invalid)\n\nDone."
        );
    }
}
