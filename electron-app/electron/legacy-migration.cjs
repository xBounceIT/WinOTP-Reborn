const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { getAppDataDirectory } = require("./account-store.cjs");
const {
  isLegacyCredentialEntry,
  readLegacyCredentials,
} = require("./legacy-credential-reader.cjs");
const { isValidPassword, readStoredBackupSettings } = require("./backup-store.cjs");
const {
  defaultSettings,
  normalizeSettings,
  normalizeSortOption,
  readStoredSettings,
} = require("./settings-store.cjs");
const { validateSecret } = require("./security-store.cjs");

const LEGACY_SETTINGS_FILE_NAME = "settings.json";
const APP_SETTINGS_FILE_NAME = "app-settings.json";
const BACKUP_SETTINGS_FILE_NAME = "backup-settings.json";
const MIGRATION_FILE_NAME = "legacy-migration.json";
const MIGRATION_FILE_VERSION = 1;

const LEGACY_APP_LOCK_RESOURCE = "WinOTP_AppLock";
const LEGACY_BACKUP_RESOURCE = "WinOTP_Backup";
const APP_LOCK_CREDENTIAL_KEYS = Object.freeze({
  AppPin: "pin",
  AppPassword: "password",
  WindowsHelloRemotePin: "remotePin",
  WindowsHelloRemotePassword: "remotePassword",
});

const defaultElectronSettings = defaultSettings;

const migrationPartDefaults = Object.freeze({
  status: "pending",
  importedCount: 0,
  skippedCount: 0,
  issueCount: 0,
});
const migrationPartStatuses = new Set(["pending", "completed", "failed"]);

function getLegacySettingsFilePath(app) {
  return path.join(getAppDataDirectory(app), LEGACY_SETTINGS_FILE_NAME);
}

function getMigrationFilePath(app) {
  return path.join(getAppDataDirectory(app), MIGRATION_FILE_NAME);
}

function readLegacySettings(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, settings: undefined };
    }

    return { exists: true, settings: undefined, readFailed: true };
  }

  try {
    const parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, settings: undefined, invalid: true };
    }

    return { exists: true, settings: parsed };
  } catch {
    return { exists: true, settings: undefined, invalid: true };
  }
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeAutoLock(value, fallback = "5") {
  const minutes =
    typeof value === "number" && Number.isInteger(value)
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return [0, 1, 2, 5, 10, 15, 30].includes(minutes) ? String(minutes) : fallback;
}

function normalizeUpdateChannel(value) {
  if (value === 1 || value === "1" || value === "PreRelease" || value === "Pre-release") {
    return "Pre-release";
  }

  return "Stable";
}

function mapLegacySettings(source) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const minimizeToTray = asBoolean(
    input.MinimizeToTrayOnClose,
    defaultElectronSettings.minimizeToTray,
  );

  return normalizeSettings({
    ...defaultElectronSettings,
    showNextCode: asBoolean(
      input.ShowNextCodeWhenFiveSecondsRemain,
      defaultElectronSettings.showNextCode,
    ),
    accountSortOption: normalizeSortOption(input.AccountSortOption),
    accountCustomOrderIds: input.AccountCustomOrderIds,
    pinProtection: asBoolean(input.IsPinProtectionEnabled, defaultElectronSettings.pinProtection),
    passwordProtection: asBoolean(
      input.IsPasswordProtectionEnabled,
      defaultElectronSettings.passwordProtection,
    ),
    windowsHello: asBoolean(input.IsWindowsHelloEnabled, defaultElectronSettings.windowsHello),
    remotePin: asBoolean(
      input.IsWindowsHelloRemotePinEnabled,
      defaultElectronSettings.remotePin,
    ),
    remotePassword: asBoolean(
      input.IsWindowsHelloRemotePasswordEnabled,
      defaultElectronSettings.remotePassword,
    ),
    autoLock: normalizeAutoLock(input.AutoLockTimeoutMinutes, "0"),
    autoStart: asBoolean(input.AutoStartOnBoot, defaultElectronSettings.autoStart),
    minimizeOnClose:
      asBoolean(input.MinimizeOnClose, defaultElectronSettings.minimizeOnClose) && !minimizeToTray,
    minimizeToTray,
    showTotpInTray: asBoolean(input.ShowTotpInTrayMenu, defaultElectronSettings.showTotpInTray),
    automaticBackup: asBoolean(
      input.IsAutomaticBackupEnabled,
      defaultElectronSettings.automaticBackup,
    ),
    customBackupFolderPath: asString(
      input.CustomBackupFolderPath,
      defaultElectronSettings.customBackupFolderPath,
    ).trim(),
    updateOnStartup: asBoolean(input.IsUpdateCheckEnabled, defaultElectronSettings.updateOnStartup),
    updateChannel: normalizeUpdateChannel(input.UpdateChannel),
  });
}

function mapLegacyBackupSettings(settings) {
  const customFolderPath = settings.customBackupFolderPath;
  return {
    automaticEnabled: settings.automaticBackup === true,
    customFolderPath:
      typeof customFolderPath === "string" && path.isAbsolute(customFolderPath)
        ? path.resolve(customFolderPath)
        : "",
  };
}

function createMigrationPart(source = {}) {
  const input =
    source && typeof source === "object" && !Array.isArray(source) ? source : undefined;
  if (
    !input ||
    !migrationPartStatuses.has(input.status) ||
    ![input.importedCount, input.skippedCount, input.issueCount].every(
      (value) => Number.isInteger(value) && value >= 0,
    )
  ) {
    return { ...migrationPartDefaults };
  }

  return {
    ...migrationPartDefaults,
    status: input.status,
    importedCount: input.importedCount,
    skippedCount: input.skippedCount,
    issueCount: input.issueCount,
    ...(typeof input.message === "string" ? { message: input.message } : {}),
  };
}

function readMigrationState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.version !== MIGRATION_FILE_VERSION) {
      return {
        version: MIGRATION_FILE_VERSION,
        settings: createMigrationPart(),
        appLock: createMigrationPart(),
        backupPassword: createMigrationPart(),
      };
    }

    return {
      version: MIGRATION_FILE_VERSION,
      settings: createMigrationPart(parsed.settings),
      appLock: createMigrationPart(parsed.appLock),
      backupPassword: createMigrationPart(parsed.backupPassword),
    };
  } catch {
    return {
      version: MIGRATION_FILE_VERSION,
      settings: createMigrationPart(),
      appLock: createMigrationPart(),
      backupPassword: createMigrationPart(),
    };
  }
}

function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write or rename failure.
    }
    throw error;
  }
}

function persistMigrationState(filePath, state) {
  try {
    writeJsonAtomically(filePath, state);
  } catch {
    // A missing marker only causes a safe, idempotent retry on the next launch.
  }
}

function migrateSettings({ directoryPath, state, legacySettingsPath, platform = process.platform }) {
  if (platform !== "win32") {
    state.settings = { ...migrationPartDefaults, status: "completed" };
    return;
  }

  if (state.settings.status === "completed") {
    return;
  }

  const legacy = readLegacySettings(legacySettingsPath);
  if (!legacy.exists) {
    state.settings = { ...migrationPartDefaults, status: "completed" };
    return;
  }

  if (legacy.readFailed) {
    state.settings = {
      ...migrationPartDefaults,
      status: "failed",
      issueCount: 1,
      message: "The native settings file could not be read.",
    };
    return;
  }

  if (!legacy.settings) {
    state.settings = {
      ...migrationPartDefaults,
      status: "failed",
      skippedCount: 1,
      issueCount: 1,
      message: "The native settings file could not be parsed.",
    };
    return;
  }

  const settings = mapLegacySettings(legacy.settings);
  const appSettingsPath = path.join(directoryPath, APP_SETTINGS_FILE_NAME);
  const backupSettingsPath = path.join(directoryPath, BACKUP_SETTINGS_FILE_NAME);

  try {
    const existingAppSettings = readStoredSettings(appSettingsPath);
    if (!existingAppSettings) {
      writeJsonAtomically(appSettingsPath, { version: 1, settings });
    }
    if (!readStoredBackupSettings(backupSettingsPath)) {
      writeJsonAtomically(
        backupSettingsPath,
        mapLegacyBackupSettings(existingAppSettings ?? settings),
      );
    }

    state.settings = {
      ...migrationPartDefaults,
      status: "completed",
      importedCount: 1,
    };
  } catch {
    state.settings = {
      ...migrationPartDefaults,
      status: "failed",
      issueCount: 1,
      message: "The native settings could not be copied into Electron storage.",
    };
  }
}

function findEntries(entries, resource) {
  return entries.filter((entry) => entry.resource === resource);
}

function summarizeStoreResult(result, importedFallback = 0) {
  return {
    importedCount: Number.isInteger(result?.importedCount)
      ? result.importedCount
      : importedFallback,
    skippedCount: Number.isInteger(result?.skippedCount) ? result.skippedCount : 0,
    issueCount: Number.isInteger(result?.issueCount) ? result.issueCount : 0,
  };
}

function getUsableSecurityCredentialKinds(securityStore) {
  if (!securityStore || typeof securityStore.getStatus !== "function") {
    return new Set();
  }

  try {
    const status = securityStore.getStatus();
    return new Set(
      Object.values(APP_LOCK_CREDENTIAL_KEYS).filter((kind) => status?.[`${kind}Set`] === true),
    );
  } catch {
    return new Set();
  }
}

function hasUsableBackupPassword(backupStore) {
  if (!backupStore || typeof backupStore.getStatus !== "function") {
    return false;
  }

  try {
    return backupStore.getStatus()?.hasStoredPassword === true;
  } catch {
    return false;
  }
}

function migrateCredentials({
  state,
  legacyCredentialReader,
  securityStore,
  backupStore,
  platform = process.platform,
}) {
  const needsAppLock = state.appLock.status !== "completed";
  const needsBackupPassword = state.backupPassword.status !== "completed";
  if (!needsAppLock && !needsBackupPassword) {
    return;
  }

  if (platform !== "win32") {
    const notApplicable = { ...migrationPartDefaults, status: "completed" };
    if (needsAppLock) {
      state.appLock = notApplicable;
    }
    if (needsBackupPassword) {
      state.backupPassword = notApplicable;
    }
    return;
  }

  const resources = [];
  if (needsAppLock) {
    resources.push(LEGACY_APP_LOCK_RESOURCE);
  }
  if (needsBackupPassword) {
    resources.push(LEGACY_BACKUP_RESOURCE);
  }

  let result;
  try {
    result = legacyCredentialReader(resources);
  } catch {
    result = undefined;
  }

  if (!result?.ok) {
    const failure = {
      ...migrationPartDefaults,
      status: "failed",
      issueCount: 1,
      message: result?.error ?? "Windows Credential Manager migration failed.",
    };
    if (needsAppLock) {
      state.appLock = failure;
    }
    if (needsBackupPassword) {
      state.backupPassword = failure;
    }
    return;
  }

  if (!Array.isArray(result.entries)) {
    const failure = {
      ...migrationPartDefaults,
      status: "failed",
      issueCount: 1,
      message: "Windows Credential Manager returned invalid migration data.",
    };
    if (needsAppLock) {
      state.appLock = failure;
    }
    if (needsBackupPassword) {
      state.backupPassword = failure;
    }
    return;
  }

  const entries = result.entries;
  if (!entries.every(isLegacyCredentialEntry)) {
    const failure = {
      ...migrationPartDefaults,
      status: "failed",
      issueCount: 1,
      message: "Windows Credential Manager returned invalid migration data.",
    };
    if (needsAppLock) {
      state.appLock = failure;
    }
    if (needsBackupPassword) {
      state.backupPassword = failure;
    }
    return;
  }

  if (needsAppLock) {
    const appLockEntries = findEntries(entries, LEGACY_APP_LOCK_RESOURCE);
    const credentials = {};
    let skippedCount = 0;
    let issueCount = 0;
    const retryableKinds = new Set();
    for (const entry of appLockEntries) {
      const kind = APP_LOCK_CREDENTIAL_KEYS[entry?.id];
      if (entry?.issue) {
        skippedCount += 1;
        issueCount += 1;
        if (kind) {
          retryableKinds.add(kind);
        }
        continue;
      }

      if (!kind || typeof entry?.payload !== "string") {
        skippedCount += 1;
        issueCount += 1;
        continue;
      }

      try {
        validateSecret(kind, entry.payload);
      } catch {
        skippedCount += 1;
        issueCount += 1;
        continue;
      }

      credentials[kind] ??= entry.payload;
    }

    for (const kind of Object.keys(credentials)) {
      retryableKinds.delete(kind);
    }
    if (retryableKinds.size > 0) {
      for (const kind of getUsableSecurityCredentialKinds(securityStore)) {
        retryableKinds.delete(kind);
      }
    }
    const retryableIssueCount = retryableKinds.size;

    if (Object.keys(credentials).length > 0) {
      if (!securityStore || typeof securityStore.importLegacyCredentials !== "function") {
        state.appLock = {
          ...migrationPartDefaults,
          status: "failed",
          issueCount: issueCount + 1,
          message: "Electron secure storage is unavailable for the native app-lock migration.",
        };
      } else {
        try {
          const imported = securityStore.importLegacyCredentials(credentials);
          if (!imported?.success) {
            state.appLock = {
              ...migrationPartDefaults,
              status: "failed",
              skippedCount,
              issueCount: issueCount + 1,
              message: imported?.message ?? "The native app-lock credentials could not be migrated.",
            };
          } else {
            state.appLock = {
              ...migrationPartDefaults,
              ...summarizeStoreResult(imported, Object.keys(credentials).length),
              status: retryableIssueCount > 0 ? "failed" : "completed",
              skippedCount: skippedCount + (imported.skippedCount ?? 0),
              issueCount: issueCount + (imported.issueCount ?? 0),
              ...(retryableIssueCount > 0
                ? { message: "One or more native app-lock credentials could not be read." }
                : {}),
            };
          }
        } catch {
          state.appLock = {
            ...migrationPartDefaults,
            status: "failed",
            skippedCount,
            issueCount: issueCount + 1,
            message: "The native app-lock credentials could not be migrated.",
          };
        }
      }
    } else {
      state.appLock = {
        ...migrationPartDefaults,
        status: retryableIssueCount > 0 ? "failed" : "completed",
        skippedCount,
        issueCount,
        ...(retryableIssueCount > 0
          ? { message: "One or more native app-lock credentials could not be read." }
          : {}),
      };
    }
  }

  if (needsBackupPassword) {
    const backupEntries = findEntries(entries, LEGACY_BACKUP_RESOURCE);
    let backupEntry;
    let issueCount = 0;
    let skippedCount = 0;
    let retryableIssueCount = 0;

    for (const entry of backupEntries) {
      if (entry?.id !== "BackupPassword") {
        skippedCount += 1;
        issueCount += 1;
        continue;
      }

      if (entry?.issue) {
        skippedCount += 1;
        issueCount += 1;
        retryableIssueCount += 1;
        continue;
      }

      if (typeof entry?.payload !== "string" || !isValidPassword(entry.payload)) {
        skippedCount += 1;
        issueCount += 1;
        continue;
      }

      if (backupEntry) {
        skippedCount += 1;
        continue;
      }

      backupEntry = entry;
    }

    if (backupEntry) {
      retryableIssueCount = 0;
    } else if (retryableIssueCount > 0 && hasUsableBackupPassword(backupStore)) {
      retryableIssueCount = 0;
    }

    if (!backupEntry) {
      state.backupPassword = {
        ...migrationPartDefaults,
        status: retryableIssueCount > 0 ? "failed" : "completed",
        skippedCount,
        issueCount,
        ...(retryableIssueCount > 0
          ? { message: "The native backup password could not be read." }
          : {}),
      };
    } else if (!backupStore || typeof backupStore.importLegacyPassword !== "function") {
      state.backupPassword = {
        ...migrationPartDefaults,
        status: "failed",
        skippedCount,
        issueCount: issueCount + 1,
        message: "Electron secure storage is unavailable for the native backup-password migration.",
      };
    } else {
      try {
        const imported = backupStore.importLegacyPassword(backupEntry.payload);
        if (imported?.success) {
          state.backupPassword = {
            ...migrationPartDefaults,
            ...summarizeStoreResult(imported, imported.imported ? 1 : 0),
            status: retryableIssueCount > 0 ? "failed" : "completed",
            skippedCount: skippedCount + (imported.skippedCount ?? 0),
            issueCount: issueCount + (imported.issueCount ?? 0),
            ...(retryableIssueCount > 0
              ? { message: "The native backup password could not be read." }
              : {}),
          };
        } else if (imported?.errorCode === "ValidationFailed") {
          state.backupPassword = {
            ...migrationPartDefaults,
            status: "completed",
            skippedCount: skippedCount + 1,
            issueCount: issueCount + 1,
            message: imported.message,
          };
        } else {
          state.backupPassword = {
            ...migrationPartDefaults,
            status: "failed",
            skippedCount,
            issueCount: issueCount + 1,
            message: imported?.message ?? "The native backup password could not be migrated.",
          };
        }
      } catch {
        state.backupPassword = {
          ...migrationPartDefaults,
          status: "failed",
          skippedCount,
          issueCount: issueCount + 1,
          message: "The native backup password could not be migrated.",
        };
      }
    }
  }
}

function runLegacyMigration(app, options = {}) {
  const directoryPath = options.directoryPath ?? getAppDataDirectory(app);
  const migrationFilePath = options.migrationFilePath ?? getMigrationFilePath(app);
  const state = readMigrationState(migrationFilePath);

  migrateSettings({
    directoryPath,
    state,
    legacySettingsPath: options.legacySettingsPath ?? path.join(directoryPath, LEGACY_SETTINGS_FILE_NAME),
    platform: options.platform,
  });
  migrateCredentials({
    state,
    legacyCredentialReader: options.legacyCredentialReader ?? readLegacyCredentials,
    securityStore: options.securityStore,
    backupStore: options.backupStore,
    platform: options.platform,
  });

  persistMigrationState(migrationFilePath, state);
  return state;
}

function migrateLegacySettingsForApp(app, options = {}) {
  const directoryPath = options.directoryPath ?? getAppDataDirectory(app);
  const migrationFilePath = options.migrationFilePath ?? getMigrationFilePath(app);
  const state = readMigrationState(migrationFilePath);
  migrateSettings({
    directoryPath,
    state,
    legacySettingsPath: options.legacySettingsPath ?? path.join(directoryPath, LEGACY_SETTINGS_FILE_NAME),
    platform: options.platform,
  });
  persistMigrationState(migrationFilePath, state);
  return state;
}

module.exports = {
  APP_LOCK_CREDENTIAL_KEYS,
  LEGACY_APP_LOCK_RESOURCE,
  LEGACY_BACKUP_RESOURCE,
  defaultElectronSettings,
  getLegacySettingsFilePath,
  getMigrationFilePath,
  mapLegacyBackupSettings,
  mapLegacySettings,
  migrateLegacySettingsForApp,
  readLegacySettings,
  readMigrationState,
  runLegacyMigration,
};
