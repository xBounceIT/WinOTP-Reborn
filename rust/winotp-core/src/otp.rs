use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use crate::models::{is_valid_base32, OtpAccount, OtpAlgorithm};

const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn decode_base32(value: &str) -> Result<Vec<u8>, String> {
    let normalized = value
        .trim()
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    if !is_valid_base32(&normalized) {
        return Err("Secret is not valid Base32.".to_string());
    }

    let unpadded = normalized.trim_end_matches('=');
    let mut output = Vec::with_capacity(unpadded.len() * 5 / 8);
    let mut buffer = 0u32;
    let mut bits = 0u8;

    for character in unpadded.bytes() {
        let value = BASE32_ALPHABET
            .iter()
            .position(|candidate| *candidate == character)
            .ok_or_else(|| "Secret is not valid Base32.".to_string())?;
        buffer = (buffer << 5) | value as u32;
        bits += 5;
        while bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
            if bits == 0 {
                buffer = 0;
            } else {
                buffer &= (1 << bits) - 1;
            }
        }
    }

    Ok(output)
}

fn hmac_digest(algorithm: OtpAlgorithm, secret: &[u8], counter: u64) -> Result<Vec<u8>, String> {
    let counter_bytes = counter.to_be_bytes();
    match algorithm {
        OtpAlgorithm::Sha1 => Hmac::<Sha1>::new_from_slice(secret)
            .map(|mut hmac| {
                hmac.update(&counter_bytes);
                hmac.finalize().into_bytes().to_vec()
            })
            .map_err(|_| "Unable to create HMAC digest.".to_string()),
        OtpAlgorithm::Sha256 => Hmac::<Sha256>::new_from_slice(secret)
            .map(|mut hmac| {
                hmac.update(&counter_bytes);
                hmac.finalize().into_bytes().to_vec()
            })
            .map_err(|_| "Unable to create HMAC digest.".to_string()),
        OtpAlgorithm::Sha512 => Hmac::<Sha512>::new_from_slice(secret)
            .map(|mut hmac| {
                hmac.update(&counter_bytes);
                hmac.finalize().into_bytes().to_vec()
            })
            .map_err(|_| "Unable to create HMAC digest.".to_string()),
    }
}

pub fn generate_totp_code_at(account: &OtpAccount, unix_seconds: i64) -> Result<String, String> {
    if account.period == 0 || unix_seconds < 0 || !matches!(account.digits, 6 | 8) {
        return Err("OTP account settings are invalid.".to_string());
    }

    let secret = decode_base32(&account.secret)?;
    if secret.is_empty() {
        return Err("Secret is empty.".to_string());
    }

    let counter = (unix_seconds as u64) / account.period as u64;
    let digest = hmac_digest(account.algorithm, &secret, counter)?;
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    if offset + 4 > digest.len() {
        return Err("OTP digest is too short.".to_string());
    }

    let binary = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    let divisor = 10u32.pow(account.digits as u32);
    Ok(format!(
        "{:0width$}",
        binary % divisor,
        width = account.digits as usize
    ))
}

pub fn generate_totp_code(account: &OtpAccount, unix_seconds: i64) -> String {
    generate_totp_code_at(account, unix_seconds)
        .unwrap_or_else(|_| "0".repeat(if account.digits == 8 { 8 } else { 6 }))
}

pub fn remaining_seconds(account: &OtpAccount, unix_seconds: i64) -> i64 {
    if account.period == 0 || unix_seconds < 0 {
        return 0;
    }

    let period = account.period as i64;
    let remainder = unix_seconds.rem_euclid(period);
    period - remainder
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::OtpAccount;

    fn rfc_account() -> OtpAccount {
        OtpAccount {
            secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".to_string(),
            algorithm: OtpAlgorithm::Sha1,
            digits: 8,
            period: 30,
            ..Default::default()
        }
    }

    #[test]
    fn rfc6238_sha1_vectors_match() {
        let account = rfc_account();
        let vectors = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ];

        for (timestamp, expected) in vectors {
            assert_eq!(
                generate_totp_code_at(&account, timestamp).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn invalid_secret_returns_zero_fallback() {
        let account = OtpAccount {
            secret: "NOT-BASE32".to_string(),
            ..Default::default()
        };
        assert_eq!(generate_totp_code(&account, 1_700_000_000), "000000");
    }

    #[test]
    fn invalid_digit_count_uses_the_six_digit_placeholder() {
        let account = OtpAccount {
            digits: 4,
            ..Default::default()
        };
        assert_eq!(generate_totp_code(&account, 1_700_000_000), "000000");
    }
}
