const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { getAppDataDirectory } = require("./account-store.cjs");
const { runRustCore } = require("./rust-core.cjs");

const SETTINGS_FILE_NAME = "app-settings.json";
const SETTINGS_FILE_VERSION = 1;
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

function readStoredSettings(filePath, options: any = {}) {
  const strict = options.strict === true;
  let contents;

  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }

    if (strict) {
      throw new Error("The stored Electron settings could not be read.");
    }

    return undefined;
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    if (strict) {
      throw new Error("The stored Electron settings are invalid.");
    }

    return undefined;
  }

  if (
    !parsed ||
    parsed.version !== SETTINGS_FILE_VERSION ||
    !parsed.settings ||
    typeof parsed.settings !== "object" ||
    Array.isArray(parsed.settings)
  ) {
    if (strict) {
      throw new Error("The stored Electron settings are invalid.");
    }

    return undefined;
  }

  try {
    return normalizeSettings(parsed.settings);
  } catch (error) {
    if (strict) {
      throw error;
    }

    return undefined;
  }
}

function normalizeSortOption(value) {
  return normalizeSettings({ accountSortOption: value }).accountSortOption;
}

function normalizeSettings(source) {
  const rustSettings = runRustCore("normalize-settings", source);
  if (!rustSettings || typeof rustSettings !== "object" || Array.isArray(rustSettings)) {
    throw new Error("The WinOTP Rust core returned invalid settings data.");
  }
  return rustSettings;
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
  filePath: string;
  settings: any;

  constructor(app, options: any = {}) {
    this.filePath = options.filePath ?? getSettingsFilePath(app);
    this.settings =
      readStoredSettings(this.filePath, { strict: true }) ?? normalizeSettings(defaultSettings);
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
