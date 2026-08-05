const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { getAppDataDirectory } = require("./account-store.cjs");
const { tryRunRustCore } = require("./rust-core.cjs");

const BACKUP_EXTENSION = ".wotpbackup";
const AUTOMATIC_BACKUP_PREFIX = "auto-";
const BACKUP_HISTORY_LIMIT = 20;
const MAX_BACKUP_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const RUST_CORE_MAX_BUFFER_BYTES = MAX_BACKUP_FILE_SIZE_BYTES * 2;
const MAX_BACKUP_ACCOUNT_COUNT = 1_000;
const MINIMUM_PASSWORD_LENGTH = 8;
const KEY_SIZE_BYTES = 32;
const SALT_SIZE_BYTES = 16;
const NONCE_SIZE_BYTES = 12;
const TAG_SIZE_BYTES = 16;
const PBKDF2_ITERATIONS = 150000;
const BACKUP_SCHEME = "PBKDF2-SHA256-AES-256-GCM";
const PASSWORD_FILE_NAME = ".backup-password";
const SETTINGS_FILE_NAME = "backup-settings.json";
const DEFAULT_BACKUP_FOLDER_NAME = "Backups";

class BackupFormatError extends Error {}

function failure(errorCode, message, extra = {}) {
  return {
    success: false,
    errorCode,
    message,
    ...extra,
  };
}

function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.trim().length > 0 &&
    password.length >= MINIMUM_PASSWORD_LENGTH
  );
}

function normalizeCustomFolderPath(value) {
  const folderPath = typeof value === "string" ? value.trim() : "";
  if (!folderPath) {
    return "";
  }

  if (!path.isAbsolute(folderPath)) {
    return folderPath;
  }

  try {
    return path.resolve(folderPath);
  } catch {
    return folderPath;
  }
}

function defaultBackupSettings() {
  return {
    automaticEnabled: false,
    customFolderPath: "",
  };
}

function readStoredBackupSettings(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    if (typeof parsed.automaticEnabled !== "boolean") {
      return undefined;
    }

    const customFolderPath = normalizeCustomFolderPath(parsed.customFolderPath);
    return {
      automaticEnabled: parsed.automaticEnabled,
      customFolderPath:
        customFolderPath && path.isAbsolute(customFolderPath) ? customFolderPath : "",
    };
  } catch {
    return undefined;
  }
}

function getUniquePath(basePath) {
  if (!fs.existsSync(basePath)) {
    return basePath;
  }

  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const fileName = path.basename(basePath, extension);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(directory, `${fileName}-${index}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(directory, `${fileName}-${crypto.randomUUID()}${extension}`);
}

function writeFileAtomically(filePath, data, options = {}) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );

  try {
    fs.writeFileSync(temporaryPath, data, { ...options, flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The destination may already have been replaced successfully.
    }
  }
}

function encodeDateForFileName(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function decodeBase64(value, expectedLength, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new BackupFormatError(`${label} is not valid Base64.`);
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new BackupFormatError(`${label} has an invalid length.`);
  }
  return decoded;
}

function encryptPayload(payload, password) {
  const rustEnvelope = tryRunRustCore(
    "backup-encrypt",
    {
      accounts: payload.accounts,
      password,
      exportedAtUtc: payload.exportedAtUtc,
    },
    { maxBuffer: RUST_CORE_MAX_BUFFER_BYTES },
  );
  if (rustEnvelope !== undefined) {
    if (!rustEnvelope || typeof rustEnvelope !== "object" || Array.isArray(rustEnvelope)) {
      throw new Error("The WinOTP Rust core returned invalid backup data.");
    }
    return rustEnvelope;
  }

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const salt = crypto.randomBytes(SALT_SIZE_BYTES);
  const nonce = crypto.randomBytes(NONCE_SIZE_BYTES);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_SIZE_BYTES, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    format: "winotp-backup",
    version: 1,
    createdAtUtc: payload.exportedAtUtc,
    accountCount: payload.accounts.length,
    encryption: {
      scheme: BACKUP_SCHEME,
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
    },
    ciphertext: ciphertext.toString("base64"),
  };
}

function decodeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new BackupFormatError("The backup file format is not supported.");
  }

  if (
    envelope.format !== "winotp-backup" ||
    envelope.version !== 1 ||
    typeof envelope.createdAtUtc !== "string" ||
    !Number.isSafeInteger(envelope.accountCount) ||
    envelope.accountCount < 0 ||
    !envelope.encryption ||
    envelope.encryption.scheme !== BACKUP_SCHEME ||
    envelope.encryption.iterations !== PBKDF2_ITERATIONS ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length === 0
  ) {
    throw new BackupFormatError("The backup file format is not supported.");
  }

  return {
    salt: decodeBase64(envelope.encryption.salt, SALT_SIZE_BYTES, "Backup salt"),
    nonce: decodeBase64(envelope.encryption.nonce, NONCE_SIZE_BYTES, "Backup nonce"),
    tag: decodeBase64(envelope.encryption.tag, TAG_SIZE_BYTES, "Backup authentication tag"),
    ciphertext: decodeBase64(envelope.ciphertext, undefined, "Backup ciphertext"),
  };
}

function decryptPayload(envelope, password) {
  const decoded = decodeEnvelope(envelope);
  const rustPayload = tryRunRustCore(
    "backup-decrypt",
    { envelope, password },
    { maxBuffer: RUST_CORE_MAX_BUFFER_BYTES },
  );
  if (rustPayload !== undefined) {
    if (!rustPayload || typeof rustPayload !== "object" || Array.isArray(rustPayload)) {
      throw new Error("The WinOTP Rust core returned invalid backup payload data.");
    }
    return rustPayload;
  }

  const key = crypto.pbkdf2Sync(
    password,
    decoded.salt,
    PBKDF2_ITERATIONS,
    KEY_SIZE_BYTES,
    "sha256",
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, decoded.nonce);
  decipher.setAuthTag(decoded.tag);
  const plaintext = Buffer.concat([decipher.update(decoded.ciphertext), decipher.final()]);
  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new BackupFormatError("The backup file payload is not valid JSON.");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.source !== "string" ||
    payload.source.trim().length === 0 ||
    typeof payload.exportedAtUtc !== "string" ||
    !Array.isArray(payload.accounts) ||
    payload.accounts.length !== envelope.accountCount
  ) {
    throw new BackupFormatError("The backup file payload is invalid.");
  }
  if (payload.accounts.length > MAX_BACKUP_ACCOUNT_COUNT) {
    throw new BackupFormatError("The backup contains too many accounts.");
  }

  return payload;
}

class BackupStore {
  constructor(app, accountStoreProvider, options = {}) {
    this.accountStoreProvider = accountStoreProvider;
    this.encryption = options.encryption;
    this.directoryPath = options.directoryPath ?? getAppDataDirectory(app);
    this.defaultBackupFolderPath = path.join(this.directoryPath, DEFAULT_BACKUP_FOLDER_NAME);
    this.passwordPath = path.join(this.directoryPath, PASSWORD_FILE_NAME);
    this.settingsPath = path.join(this.directoryPath, SETTINGS_FILE_NAME);
    this.automaticBackupQueue = Promise.resolve();
    this.configurationQueue = Promise.resolve();
    this.automaticReconciliationDeferred = options.skipAutomaticReconciliation === true;
    this.settings = this.readSettings();
    if (!this.automaticReconciliationDeferred) {
      this.reconcileAutomaticSettings();
    }
  }

  enqueueConfiguration(operation) {
    const next = this.configurationQueue.then(operation, operation);
    this.configurationQueue = next.catch(() => undefined);
    return next;
  }

  readSettings() {
    return readStoredBackupSettings(this.settingsPath) ?? defaultBackupSettings();
  }

  persistSettings() {
    fs.mkdirSync(this.directoryPath, { recursive: true });
    writeFileAtomically(this.settingsPath, `${JSON.stringify(this.settings)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  reconcileAutomaticSettings() {
    this.automaticReconciliationDeferred = false;
    const storedPassword = this.getStoredPassword();
    if (!this.settings.automaticEnabled || storedPassword) {
      return storedPassword;
    }

    this.settings = {
      ...this.settings,
      automaticEnabled: false,
    };
    try {
      this.persistSettings();
    } catch {
      // Keep the in-memory state safe even if the durable repair cannot be written.
    }
    return undefined;
  }

  getEffectiveBackupFolderPath() {
    return this.settings.customFolderPath || this.defaultBackupFolderPath;
  }

  getStatus() {
    const storedPassword = this.automaticReconciliationDeferred
      ? this.getStoredPassword()
      : this.reconcileAutomaticSettings();
    return {
      automaticEnabled: this.settings.automaticEnabled,
      customFolderPath: this.settings.customFolderPath,
      defaultFolderPath: this.defaultBackupFolderPath,
      effectiveFolderPath: this.getEffectiveBackupFolderPath(),
      hasStoredPassword: Boolean(storedPassword),
    };
  }

  configure(settings = {}) {
    return this.enqueueConfiguration(() => this.configureCore(settings));
  }

  configureCore(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return failure("ValidationFailed", "Backup settings are invalid.");
    }

    const previous = this.settings;
    const customFolderPath =
      settings.customFolderPath === undefined
        ? previous.customFolderPath
        : normalizeCustomFolderPath(settings.customFolderPath);
    if (customFolderPath && !path.isAbsolute(customFolderPath)) {
      return failure("ValidationFailed", "Backup folder path must be an absolute path.");
    }

    this.settings = {
      automaticEnabled: settings.automaticEnabled === true,
      customFolderPath,
    };

    if (this.settings.automaticEnabled) {
      if (!this.getStoredPassword()) {
        this.settings = previous;
        return failure(
          "PasswordUnavailable",
          "Automatic backup cannot be enabled without a stored backup password.",
        );
      }

      const folderValidation = this.validateBackupFolder(this.getEffectiveBackupFolderPath());
      if (!folderValidation.success) {
        this.settings = previous;
        return folderValidation;
      }
    }

    try {
      this.persistSettings();
      return { success: true, ...this.getStatus() };
    } catch {
      this.settings = previous;
      return failure("FileAccessFailed", "Unable to save backup settings.");
    }
  }

  getStoredPassword() {
    if (!this.encryption || typeof this.encryption.isEncryptionAvailable !== "function") {
      return undefined;
    }

    try {
      if (!this.encryption.isEncryptionAvailable() || !fs.existsSync(this.passwordPath)) {
        return undefined;
      }

      const password = this.encryption.decryptString(fs.readFileSync(this.passwordPath));
      return isValidPassword(password) ? password : undefined;
    } catch {
      return undefined;
    }
  }

  importLegacyPassword(password) {
    if (this.getStoredPassword()) {
      return {
        success: true,
        imported: false,
        importedCount: 0,
        skippedCount: 1,
        issueCount: 0,
      };
    }

    const result = this.setStoredPassword(password);
    if (!result.success) {
      return result;
    }

    return {
      ...result,
      imported: true,
      importedCount: 1,
      skippedCount: 0,
      issueCount: 0,
    };
  }

  setStoredPassword(password) {
    if (!isValidPassword(password)) {
      return failure(
        "ValidationFailed",
        `Backup password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
      );
    }

    try {
      if (!this.encryption?.isEncryptionAvailable?.()) {
        return failure("VaultAccessFailed", "OS-backed password encryption is unavailable.");
      }

      const encrypted = this.encryption.encryptString(password);
      if (!Buffer.isBuffer(encrypted)) {
        return failure("VaultAccessFailed", "Failed to encrypt the backup password.");
      }

      fs.mkdirSync(this.directoryPath, { recursive: true });
      writeFileAtomically(this.passwordPath, encrypted, { mode: 0o600 });
      return { success: true };
    } catch {
      return failure("VaultAccessFailed", "Failed to store the backup password.");
    }
  }

  clearStoredPassword() {
    try {
      fs.rmSync(this.passwordPath, { force: true });
      return { success: true };
    } catch {
      return failure("VaultAccessFailed", "Failed to clear the backup password.");
    }
  }

  validateBackupFolder(folderPath) {
    const trimmedPath = typeof folderPath === "string" ? folderPath.trim() : "";
    if (!trimmedPath) {
      return failure("ValidationFailed", "Backup folder path is required.");
    }
    if (!path.isAbsolute(trimmedPath)) {
      return failure("ValidationFailed", "Backup folder path must be an absolute path.");
    }

    let normalizedPath;
    try {
      normalizedPath = path.resolve(trimmedPath);
    } catch {
      return failure("ValidationFailed", "The selected backup folder path is invalid.");
    }

    try {
      if (fs.existsSync(normalizedPath) && !fs.statSync(normalizedPath).isDirectory()) {
        return failure(
          "FileAccessFailed",
          "The selected backup folder points to a file, not a folder.",
        );
      }

      fs.mkdirSync(normalizedPath, { recursive: true });
      const probePath = path.join(normalizedPath, `.winotp-probe-${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(probePath, "probe", { flag: "wx" });
      fs.rmSync(probePath, { force: true });
      return { success: true, resolvedPath: normalizedPath };
    } catch {
      return failure("FileAccessFailed", "WinOTP could not write to the selected backup folder.");
    }
  }

  async enableAutomatic(password, customFolderPath) {
    return this.enqueueConfiguration(() => this.enableAutomaticCore(password, customFolderPath));
  }

  async enableAutomaticCore(password, customFolderPath) {
    if (!isValidPassword(password)) {
      return failure(
        "ValidationFailed",
        `Backup password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
      );
    }

    const nextCustomFolderPath =
      customFolderPath === undefined
        ? this.settings.customFolderPath
        : normalizeCustomFolderPath(customFolderPath);
    const folderValidation = this.validateBackupFolder(
      nextCustomFolderPath || this.defaultBackupFolderPath,
    );
    if (!folderValidation.success) {
      return folderValidation;
    }

    const previousSettings = this.settings;
    const previousPassword = this.getStoredPassword();
    const passwordResult = this.setStoredPassword(password);
    if (!passwordResult.success) {
      return passwordResult;
    }

    this.settings = {
      automaticEnabled: true,
      customFolderPath: nextCustomFolderPath,
    };

    try {
      this.persistSettings();
      const backupResult = await this.createAutomaticBackup();
      if (!backupResult.success) {
        this.restoreAutomaticSettings(previousSettings, previousPassword);
        return backupResult;
      }

      return {
        success: true,
        message: "Automatic backup is enabled.",
        ...this.getStatus(),
        filePath: backupResult.filePath,
        accountCount: backupResult.accountCount,
      };
    } catch {
      this.restoreAutomaticSettings(previousSettings, previousPassword);
      return failure("UnexpectedError", "Unable to enable automatic backup.");
    }
  }

  restoreAutomaticSettings(previousSettings, previousPassword) {
    this.settings = previousSettings;
    try {
      this.persistSettings();
    } catch {
      // The operation already failed; the next startup will recover from the persisted state.
    }

    if (previousPassword) {
      this.setStoredPassword(previousPassword);
    } else {
      this.clearStoredPassword();
    }
  }

  disableAutomatic() {
    return this.enqueueConfiguration(() => this.disableAutomaticCore());
  }

  disableAutomaticCore() {
    const previousSettings = this.settings;
    const previousPassword = this.getStoredPassword();
    const passwordResult = this.clearStoredPassword();
    if (!passwordResult.success) {
      return passwordResult;
    }

    this.settings = {
      ...this.settings,
      automaticEnabled: false,
    };
    try {
      this.persistSettings();
      return { success: true, message: "Automatic backup has been disabled.", ...this.getStatus() };
    } catch {
      this.settings = previousSettings;
      try {
        this.persistSettings();
      } catch {
        // Preserve the original failure for the renderer.
      }
      if (previousPassword) {
        this.setStoredPassword(previousPassword);
      }
      return failure("FileAccessFailed", "Unable to save backup settings.");
    }
  }

  async setCustomFolderPath(customFolderPath) {
    return this.enqueueConfiguration(() => this.setCustomFolderPathCore(customFolderPath));
  }

  async setCustomFolderPathCore(customFolderPath) {
    const nextCustomFolderPath = normalizeCustomFolderPath(customFolderPath);
    const folderValidation = this.validateBackupFolder(
      nextCustomFolderPath || this.defaultBackupFolderPath,
    );
    if (!folderValidation.success) {
      return folderValidation;
    }

    const previousSettings = this.settings;
    this.settings = {
      ...this.settings,
      customFolderPath: nextCustomFolderPath,
    };

    try {
      this.persistSettings();
      if (this.settings.automaticEnabled) {
        const backupResult = await this.createAutomaticBackup();
        if (!backupResult.success) {
          this.settings = previousSettings;
          this.persistSettings();
          return backupResult;
        }
      }

      return {
        success: true,
        message: nextCustomFolderPath
          ? "Automatic backup folder updated."
          : "Automatic backup folder reset to default.",
        ...this.getStatus(),
      };
    } catch {
      this.settings = previousSettings;
      try {
        this.persistSettings();
      } catch {
        // Preserve the original failure for the renderer.
      }
      return failure("FileAccessFailed", "Unable to save the backup folder setting.");
    }
  }

  async createAutomaticBackup() {
    if (!this.settings.automaticEnabled) {
      return { success: true, skipped: true };
    }

    const operation = this.automaticBackupQueue.then(
      () => this.createAutomaticBackupCore(),
      () => this.createAutomaticBackupCore(),
    );
    this.automaticBackupQueue = operation.catch(() => undefined);
    return operation;
  }

  createAutomaticBackupCore() {
    if (!this.settings.automaticEnabled) {
      return { success: true, skipped: true };
    }

    const password = this.getStoredPassword();
    if (!password) {
      return failure(
        "PasswordUnavailable",
        "Automatic backup is enabled, but no stored backup password is available.",
      );
    }

    const folderValidation = this.validateBackupFolder(this.getEffectiveBackupFolderPath());
    if (!folderValidation.success) {
      return folderValidation;
    }

    const timestamp = new Date();
    const fileName = `${AUTOMATIC_BACKUP_PREFIX}${encodeDateForFileName(timestamp)}${BACKUP_EXTENSION}`;
    const destinationPath = getUniquePath(path.join(folderValidation.resolvedPath, fileName));
    const result = this.exportBackup(destinationPath, password);
    if (result.success) {
      this.pruneAutomaticBackups(folderValidation.resolvedPath);
    }
    return result;
  }

  pruneAutomaticBackups(folderPath) {
    try {
      const automaticFiles = fs
        .readdirSync(folderPath)
        .filter(
          (fileName) =>
            fileName.startsWith(AUTOMATIC_BACKUP_PREFIX) && fileName.endsWith(BACKUP_EXTENSION),
        )
        .map((fileName) => {
          const filePath = path.join(folderPath, fileName);
          return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.modifiedAt - left.modifiedAt);

      for (const entry of automaticFiles.slice(BACKUP_HISTORY_LIMIT)) {
        try {
          fs.rmSync(entry.filePath, { force: true });
        } catch {
          // Pruning is best-effort and should not make a successful backup fail.
        }
      }
    } catch {
      // Pruning is best-effort and should not make a successful backup fail.
    }
  }

  exportBackup(destinationFilePath, passwordOverride) {
    const targetPath = typeof destinationFilePath === "string" ? destinationFilePath.trim() : "";
    if (!targetPath) {
      return failure("ValidationFailed", "Backup file path is required.");
    }

    let normalizedTargetPath;
    try {
      normalizedTargetPath = path.resolve(targetPath);
    } catch {
      return failure("ValidationFailed", "The selected backup file path is invalid.");
    }

    const pathComparisonKey = (value) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    const reservedPaths = [
      this.passwordPath,
      this.settingsPath,
      path.join(this.directoryPath, "settings.json"),
      path.join(this.directoryPath, "app-settings.json"),
      path.join(this.directoryPath, "legacy-migration.json"),
      path.join(this.directoryPath, "accounts.db"),
      path.join(this.directoryPath, "accounts.db-wal"),
      path.join(this.directoryPath, "accounts.db-shm"),
    ].map((value) => pathComparisonKey(path.resolve(value)));
    if (reservedPaths.includes(pathComparisonKey(normalizedTargetPath))) {
      return failure("ValidationFailed", "The selected backup file path is reserved by WinOTP.");
    }

    if (
      passwordOverride !== undefined &&
      passwordOverride !== null &&
      typeof passwordOverride !== "string"
    ) {
      return failure("ValidationFailed", "Backup password must be a string.");
    }

    const hasPasswordOverride =
      typeof passwordOverride === "string" && passwordOverride.trim().length > 0;
    if (hasPasswordOverride && !isValidPassword(passwordOverride)) {
      return failure(
        "ValidationFailed",
        `Backup password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
      );
    }

    const password = hasPasswordOverride ? passwordOverride : this.getStoredPassword();
    if (!isValidPassword(password)) {
      return failure("PasswordUnavailable", "A backup password is required to export a backup.");
    }

    const store = this.accountStoreProvider();
    if (!store) {
      return failure("VaultAccessFailed", "The local account database is unavailable.");
    }

    let loadResult;
    try {
      loadResult = store.readAccounts();
    } catch {
      return failure("VaultAccessFailed", "Unable to read accounts for the backup.");
    }

    if (loadResult.issues?.length > 0) {
      return failure(
        "IncompleteData",
        "Backup could not be created because one or more saved accounts could not be read.",
      );
    }

    if (
      loadResult.migration?.status === "failed" ||
      Number(loadResult.migration?.issueCount ?? 0) > 0
    ) {
      return failure(
        "IncompleteData",
        "Backup could not be created because account migration is incomplete.",
      );
    }

    const payload = {
      source: "WinOTP-Reborn",
      exportedAtUtc: new Date().toISOString(),
      accounts: loadResult.accounts ?? [],
    };
    if (payload.accounts.length > MAX_BACKUP_ACCOUNT_COUNT) {
      return failure(
        "ValidationFailed",
        `The backup cannot contain more than ${MAX_BACKUP_ACCOUNT_COUNT.toLocaleString("en-US")} accounts.`,
      );
    }
    let serializedEnvelope;
    try {
      const envelope = encryptPayload(payload, password);
      serializedEnvelope = `${JSON.stringify(envelope)}\n`;
    } catch {
      return failure("UnexpectedError", "Unable to encrypt the backup file.");
    }

    if (Buffer.byteLength(serializedEnvelope, "utf8") > MAX_BACKUP_FILE_SIZE_BYTES) {
      return failure("ValidationFailed", "The backup contains too much data to export.");
    }

    try {
      const directory = path.dirname(targetPath);
      fs.mkdirSync(directory, { recursive: true });
      writeFileAtomically(targetPath, serializedEnvelope, {
        encoding: "utf8",
        mode: 0o600,
      });
      return {
        success: true,
        filePath: targetPath,
        accountCount: payload.accounts.length,
        message: "Backup created.",
      };
    } catch {
      return failure("FileAccessFailed", "Failed to write the backup file.");
    }
  }

  importBackup(sourceFilePath, password) {
    const targetPath = typeof sourceFilePath === "string" ? sourceFilePath.trim() : "";
    if (!targetPath) {
      return failure("ValidationFailed", "Backup file path is required.");
    }
    if (!isValidPassword(password)) {
      return failure(
        "ValidationFailed",
        `Backup password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
      );
    }

    let fileStats;
    try {
      fileStats = fs.statSync(targetPath);
    } catch {
      return failure("FileAccessFailed", "Failed to read the backup file.");
    }

    if (!fileStats.isFile()) {
      return failure("FileAccessFailed", "The selected backup path is not a file.");
    }
    if (fileStats.size > MAX_BACKUP_FILE_SIZE_BYTES) {
      return failure("InvalidFormat", "The backup file is too large to import.");
    }

    let serializedBackup;
    try {
      serializedBackup = fs.readFileSync(targetPath);
    } catch {
      return failure("FileAccessFailed", "Failed to read the backup file.");
    }
    if (serializedBackup.length > MAX_BACKUP_FILE_SIZE_BYTES) {
      return failure("InvalidFormat", "The backup file is too large to import.");
    }

    let envelope;
    try {
      envelope = JSON.parse(serializedBackup.toString("utf8"));
    } catch {
      return failure("InvalidFormat", "The backup file is not valid.");
    }

    let payload;
    try {
      payload = decryptPayload(envelope, password);
    } catch (error) {
      if (error instanceof BackupFormatError) {
        return failure("InvalidFormat", "The backup file is corrupted or not supported.");
      }
      return failure("DecryptionFailed", "Backup password is incorrect or the file is corrupted.");
    }

    if (payload.accounts.length > MAX_BACKUP_ACCOUNT_COUNT) {
      return failure(
        "InvalidFormat",
        `The backup cannot contain more than ${MAX_BACKUP_ACCOUNT_COUNT.toLocaleString("en-US")} accounts.`,
      );
    }

    const store = this.accountStoreProvider();
    if (!store) {
      return failure("VaultAccessFailed", "The local account database is unavailable.");
    }

    let existingIds;
    try {
      existingIds = new Set(store.readAccounts().accounts.map((account) => account.id));
    } catch {
      return failure("VaultAccessFailed", "Unable to read existing accounts.");
    }

    let importedCount = 0;
    let replacedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    for (const source of payload.accounts) {
      try {
        const saveResult = store.saveAccount(source);
        if (!saveResult.success) {
          skippedCount += 1;
          continue;
        }

        const persistedId = saveResult.account.id;
        if (existingIds.has(persistedId)) {
          replacedCount += 1;
        } else {
          existingIds.add(persistedId);
        }
        importedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return {
      success: true,
      importedCount,
      replacedCount,
      skippedCount,
      failedCount,
      message: "Import completed.",
    };
  }
}

module.exports = {
  AUTOMATIC_BACKUP_PREFIX,
  BACKUP_EXTENSION,
  BACKUP_HISTORY_LIMIT,
  BackupStore,
  BackupFormatError,
  MAX_BACKUP_FILE_SIZE_BYTES,
  MAX_BACKUP_ACCOUNT_COUNT,
  MINIMUM_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  RUST_CORE_MAX_BUFFER_BYTES,
  decodeEnvelope,
  decryptPayload,
  encryptPayload,
  getUniquePath,
  isValidPassword,
  readStoredBackupSettings,
};
