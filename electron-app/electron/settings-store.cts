const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { getAppDataDirectory } = require("./account-store.cjs");
const { tryRunRustCore } = require("./rust-core.cjs");

const SETTINGS_FILE_NAME = "app-settings.json";
const SETTINGS_FILE_VERSION = 1;
const AUTO_LOCK_VALUES = new Set(["0", "1", "2", "5", "10", "15", "30"]);
const SORT_OPTIONS = Object.freeze([
  "DateAddedDesc",
  "DateAddedAsc",
  "AlphabeticalAsc",
  "AlphabeticalDesc",
  "CustomOrder",
  "UsageBased",
]);

const defaultSettings = Object.freeze({
  showNextCode: false,
  accountSortOption: "DateAddedDesc",
  accountCustomOrderIds: [],
  pinProtection: false,
  passwordProtection: false,
  windowsHello: false,
  remotePin: false,
  remotePassword: false,
  autoLock: "5",
  autoStart: false,
  minimizeOnClose: false,
  minimizeToTray: false,
  showTotpInTray: false,
  automaticBackup: false,
  customBackupFolderPath: "",
  updateOnStartup: true,
  updateChannel: "Stable",
  theme: "dark",
});

function getSettingsFilePath(app) {
  return path.join(getAppDataDirectory(app), SETTINGS_FILE_NAME);
}

function readStoredSettings(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      !parsed ||
      parsed.version !== SETTINGS_FILE_VERSION ||
      !parsed.settings ||
      typeof parsed.settings !== "object" ||
      Array.isArray(parsed.settings)
    ) {
      return undefined;
    }

    return normalizeSettings(parsed.settings);
  } catch {
    return undefined;
  }
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function normalizeSortOption(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return SORT_OPTIONS[value] ?? defaultSettings.accountSortOption;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return SORT_OPTIONS[Number(value)] ?? defaultSettings.accountSortOption;
  }

  return SORT_OPTIONS.includes(value) ? value : defaultSettings.accountSortOption;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function normalizeSettings(source) {
  const rustSettings = tryRunRustCore("normalize-settings", source);
  if (rustSettings !== undefined) {
    if (!rustSettings || typeof rustSettings !== "object" || Array.isArray(rustSettings)) {
      throw new Error("The WinOTP Rust core returned invalid settings data.");
    }
    return rustSettings;
  }

  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const autoLock = asString(input.autoLock, defaultSettings.autoLock);
  const updateChannel = asString(input.updateChannel, defaultSettings.updateChannel);
  const theme = asString(input.theme, defaultSettings.theme);
  const minimizeToTray = asBoolean(input.minimizeToTray, defaultSettings.minimizeToTray);

  return {
    showNextCode: asBoolean(input.showNextCode, defaultSettings.showNextCode),
    accountSortOption: normalizeSortOption(input.accountSortOption ?? input.sortOption),
    accountCustomOrderIds: normalizeStringList(input.accountCustomOrderIds),
    pinProtection: asBoolean(input.pinProtection, defaultSettings.pinProtection),
    passwordProtection: asBoolean(input.passwordProtection, defaultSettings.passwordProtection),
    windowsHello: asBoolean(input.windowsHello, defaultSettings.windowsHello),
    remotePin: asBoolean(input.remotePin, defaultSettings.remotePin),
    remotePassword: asBoolean(input.remotePassword, defaultSettings.remotePassword),
    autoLock: AUTO_LOCK_VALUES.has(autoLock) ? autoLock : defaultSettings.autoLock,
    autoStart: asBoolean(input.autoStart, defaultSettings.autoStart),
    minimizeOnClose:
      asBoolean(input.minimizeOnClose, defaultSettings.minimizeOnClose) && !minimizeToTray,
    minimizeToTray,
    showTotpInTray: asBoolean(input.showTotpInTray, defaultSettings.showTotpInTray),
    automaticBackup: asBoolean(input.automaticBackup, defaultSettings.automaticBackup),
    customBackupFolderPath: asString(
      input.customBackupFolderPath,
      defaultSettings.customBackupFolderPath,
    ).trim(),
    updateOnStartup: asBoolean(input.updateOnStartup, defaultSettings.updateOnStartup),
    updateChannel: updateChannel === "Pre-release" ? "Pre-release" : "Stable",
    theme: theme === "light" ? "light" : "dark",
  };
}

function writeSettingsAtomically(filePath, settings) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: SETTINGS_FILE_VERSION, settings })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
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

class SettingsStore {
  constructor(app, options = {}) {
    this.filePath = options.filePath ?? getSettingsFilePath(app);
    this.settings = readStoredSettings(this.filePath) ?? normalizeSettings(defaultSettings);
  }

  getSettings() {
    return { ...this.settings };
  }

  saveSettings(source) {
    const nextSettings = normalizeSettings(source);
    writeSettingsAtomically(this.filePath, nextSettings);
    this.settings = nextSettings;
    return { success: true, settings: this.getSettings() };
  }
}

module.exports = {
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_VERSION,
  SettingsStore,
  defaultSettings,
  getSettingsFilePath,
  normalizeSortOption,
  normalizeSettings,
  readStoredSettings,
};
