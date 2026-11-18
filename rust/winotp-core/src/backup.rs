use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use getrandom::fill_uninit as random_fill_uninit;
use pbkdf2::pbkdf2_hmac_array;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::mem::MaybeUninit;

use crate::models::OtpAccount;

pub const BACKUP_FORMAT: &str = "winotp-backup";
pub const BACKUP_VERSION: u32 = 1;
pub const BACKUP_SCHEME: &str = "PBKDF2-SHA256-AES-256-GCM";
pub const PBKDF2_ITERATIONS: u32 = 150_000;
pub const KEY_SIZE_BYTES: usize = 32;
pub const SALT_SIZE_BYTES: usize = 16;
pub const NONCE_SIZE_BYTES: usize = 12;
pub const TAG_SIZE_BYTES: usize = 16;
pub const MINIMUM_PASSWORD_LENGTH: usize = 8;
pub const MAX_BACKUP_FILE_SIZE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEnvelope {
    pub format: String,
    pub version: u32,
    pub created_at_utc: String,
    pub account_count: usize,
    pub encryption: BackupEncryption,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEncryption {
    pub scheme: String,
    pub iterations: u32,
    pub salt: String,
    pub nonce: String,
    pub tag: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub source: String,
    pub exported_at_utc: String,
    pub accounts: Vec<OtpAccount>,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("Backup password must be at least {MINIMUM_PASSWORD_LENGTH} characters.")]
    InvalidPassword,
    #[error("The backup file format is not supported.")]
    UnsupportedFormat,
    #[error("The backup file is corrupted.")]
    Corrupt,
    #[error("Backup password is incorrect or the file is corrupted.")]
    DecryptionFailed,
    #[error("The backup file payload is invalid.")]
    InvalidPayload,
}

pub fn is_valid_backup_password(password: &str) -> bool {
    !password.trim().is_empty() && password.encode_utf16().count() >= MINIMUM_PASSWORD_LENGTH
}

fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_SIZE_BYTES] {
    pbkdf2_hmac_array::<Sha256, KEY_SIZE_BYTES>(password.as_bytes(), salt, PBKDF2_ITERATIONS)
}

fn random_bytes<const N: usize>() -> Result<[u8; N], BackupError> {
    let mut bytes = [const { MaybeUninit::uninit() }; N];
    let initialized = random_fill_uninit(&mut bytes).map_err(|_| BackupError::Corrupt)?;
    let initialized: &mut [u8; N] = initialized.try_into().map_err(|_| BackupError::Corrupt)?;
    Ok(*initialized)
}

pub fn encrypt_payload(
    accounts: Vec<OtpAccount>,
    password: &str,
    exported_at_utc: Option<String>,
) -> Result<BackupEnvelope, BackupError> {
    if !is_valid_backup_password(password) {
        return Err(BackupError::InvalidPassword);
    }
    let exported_at_utc = exported_at_utc
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let payload = BackupPayload {
        source: "WinOTP-Reborn".to_string(),
        exported_at_utc: exported_at_utc.clone(),
        accounts,
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|_| BackupError::InvalidPayload)?;
    let salt = random_bytes::<SALT_SIZE_BYTES>()?;
    let nonce = random_bytes::<NONCE_SIZE_BYTES>()?;
    let key_bytes = derive_key(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| BackupError::Corrupt)?;
    if encrypted.len() < TAG_SIZE_BYTES {
        return Err(BackupError::Corrupt);
    }
    let split = encrypted.len() - TAG_SIZE_BYTES;
    let ciphertext = &encrypted[..split];
    let tag = &encrypted[split..];
    Ok(BackupEnvelope {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        created_at_utc: exported_at_utc,
        account_count: payload.accounts.len(),
        encryption: BackupEncryption {
            scheme: BACKUP_SCHEME.to_string(),
            iterations: PBKDF2_ITERATIONS,
            salt: BASE64.encode(salt),
            nonce: BASE64.encode(nonce),
            tag: BASE64.encode(tag),
        },
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decode_base64(value: &str) -> Result<Vec<u8>, BackupError> {
    let decoded = BASE64.decode(value).map_err(|_| BackupError::Corrupt)?;
    if BASE64.encode(&decoded) != value {
        return Err(BackupError::Corrupt);
    }
    Ok(decoded)
}

fn decode_exact(value: &str, expected_length: usize) -> Result<Vec<u8>, BackupError> {
    let decoded = decode_base64(value)?;
    if decoded.len() != expected_length {
        return Err(BackupError::Corrupt);
    }
    Ok(decoded)
}

pub fn decrypt_payload(
    envelope: &BackupEnvelope,
    password: &str,
) -> Result<BackupPayload, BackupError> {
    if !is_valid_backup_password(password) {
        return Err(BackupError::InvalidPassword);
    }
    if envelope.format != BACKUP_FORMAT
        || envelope.version != BACKUP_VERSION
        || envelope.created_at_utc.trim().is_empty()
        || envelope.encryption.scheme != BACKUP_SCHEME
        || envelope.encryption.iterations != PBKDF2_ITERATIONS
        || envelope.ciphertext.is_empty()
    {
        return Err(BackupError::UnsupportedFormat);
    }

    let salt = decode_exact(&envelope.encryption.salt, SALT_SIZE_BYTES)?;
    let nonce = decode_exact(&envelope.encryption.nonce, NONCE_SIZE_BYTES)?;
    let tag = decode_exact(&envelope.encryption.tag, TAG_SIZE_BYTES)?;
    let ciphertext = decode_base64(&envelope.ciphertext)?;
    if ciphertext.is_empty() {
        return Err(BackupError::Corrupt);
    }

    let key_bytes = derive_key(password, &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let mut encrypted = ciphertext;
    encrypted.extend_from_slice(&tag);
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), encrypted.as_ref())
        .map_err(|_| BackupError::DecryptionFailed)?;
    let payload: BackupPayload =
        serde_json::from_slice(&plaintext).map_err(|_| BackupError::InvalidPayload)?;
    if payload.source.trim().is_empty() || payload.accounts.len() != envelope.account_count {
        return Err(BackupError::InvalidPayload);
    }
    Ok(payload)
}

pub fn serialize_envelope(envelope: &BackupEnvelope) -> Result<String, BackupError> {
    let serialized = serde_json::to_string(envelope).map_err(|_| BackupError::InvalidPayload)?;
    if serialized.len() > MAX_BACKUP_FILE_SIZE_BYTES {
        return Err(BackupError::InvalidPayload);
    }
    Ok(serialized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_test_password() -> String {
        BASE64.encode(random_bytes::<KEY_SIZE_BYTES>().unwrap())
    }

    #[test]
    fn opens_a_version_one_backup_created_outside_winotp() {
        // This fixed envelope was produced with Node's PBKDF2 and AES-GCM APIs.
        let envelope = serde_json::from_str(r#"
        {
          "format": "winotp-backup",
          "version": 1,
          "createdAtUtc": "2023-11-14T22:13:20.000Z",
          "accountCount": 1,
          "encryption": {
            "scheme": "PBKDF2-SHA256-AES-256-GCM",
            "iterations": 150000,
            "salt": "MDEyMzQ1Njc4OWFiY2RlZg==",
            "nonce": "MDEyMzQ1Njc4OWFi",
            "tag": "AoTu2Oi0k9m7iMSDfdgOCA=="
          },
          "ciphertext": "qHhuAfpeHHxq8/DS4gdHnnla9LBYCDhoXyliqcZ31QyhQneYHz09o+YX4jZR/N/ZJM+QAoWCKYJQxQfuqRSb+KYtFBvNiOrYYulPNDTdAc98C0vJLLwemJLwiT+iYyBUcia4uhKAOCvVi7GUgKO6ORtHSetqvDuPdAo9Ci/708JNwba1bq/tGuu4Um/9DIJxi1CFnwXq3nlAxfNGPuZw7PaC0941lYMg3Lj83FL2HhepkdC0tRmFgphDdUxavB8SmHYdayZRxZpI1aE2vgd9qMkXqJR/Qro380UEANfGHs4GFKxIQq8ozBJ/HKdIG8vuKixw0prix2UWWEBf+h++/kmgz0NWOk/GNJFucSaktgJB"
        }
        "#).unwrap();
        let payload = decrypt_payload(&envelope, "fixture password").unwrap();
        let [account] = payload.accounts.as_slice() else {
            panic!("Expected one account");
        };
        assert_eq!(account.id, "legacy-1");
        assert_eq!(account.issuer, "ACME");
        assert_eq!(account.account_name, "jdoe@example.com");
        assert_eq!(account.secret, "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn rejects_short_and_blank_backup_passwords() {
        let sample = random_test_password();
        assert!(!is_valid_backup_password(&sample[..7]));
        assert!(!is_valid_backup_password(&" ".repeat(8)));
        assert!(is_valid_backup_password(&sample[..8]));
    }

    #[test]
    fn rejects_wrong_password_and_unsupported_iterations() {
        let password = random_test_password();
        let wrong_password = random_test_password();
        let mut envelope = encrypt_payload(Vec::new(), &password, None).unwrap();
        assert!(matches!(
            decrypt_payload(&envelope, &wrong_password),
            Err(BackupError::DecryptionFailed)
        ));
        envelope.encryption.iterations += 1;
        assert!(matches!(
            decrypt_payload(&envelope, &password),
            Err(BackupError::UnsupportedFormat)
        ));
    }

    #[test]
    fn validates_envelope_metadata_and_canonical_base64_in_the_core() {
        let password = random_test_password();
        let mut envelope = encrypt_payload(Vec::new(), &password, None).unwrap();
        envelope.created_at_utc = "  ".to_string();
        assert!(matches!(
            decrypt_payload(&envelope, &password),
            Err(BackupError::UnsupportedFormat)
        ));

        let password = random_test_password();
        let mut envelope = encrypt_payload(Vec::new(), &password, None).unwrap();
        envelope.encryption.salt = "A".repeat(24);
        assert!(matches!(
            decrypt_payload(&envelope, &password),
            Err(BackupError::Corrupt)
        ));
    }
}
