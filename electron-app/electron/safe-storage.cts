function isSecureStorageAvailable(encryption, platform = process.platform) {
  if (!encryption?.isEncryptionAvailable?.()) {
    return false;
  }

  try {
    return platform !== "linux" || encryption.getSelectedStorageBackend?.() !== "basic_text";
  } catch {
    return false;
  }
}

module.exports = { isSecureStorageAvailable };
