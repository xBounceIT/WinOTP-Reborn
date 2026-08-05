//! Portable WinOTP domain logic.
//!
//! Electron owns cross-platform operating-system integration such as safe
//! storage, window management, login items, and screen capture. This crate
//! owns the data contracts and deterministic rules shared by every platform,
//! plus the small Windows API module needed for legacy native integrations.
//! The `winotp-core` binary exposes the same API over one-shot JSON requests
//! so Electron does not need a platform-specific native binding.

pub mod backup;
pub mod import;
pub mod models;
pub mod ordering;
pub mod otp;
pub mod platform;
pub mod screen_capture;
pub mod security;
pub mod settings;

pub use backup::{
    decrypt_payload, encrypt_payload, is_valid_backup_password, BackupEncryption, BackupEnvelope,
    BackupError, BackupPayload,
};
pub use import::{parse_legacy_account, parse_otp_uri, parse_winauth_line};
pub use models::{
    is_valid_base32, normalize_account, parse_stored_json, CredentialIssue, OtpAccount,
    OtpAlgorithm, SortOption,
};
pub use ordering::{
    apply_custom_order, get_drop_insertion_index, project_order, prune_custom_order_ids,
    sort_accounts, ItemBounds,
};
pub use otp::{decode_base32, generate_totp_code, generate_totp_code_at, remaining_seconds};
