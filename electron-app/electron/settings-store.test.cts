const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { SettingsStore, getDefaultSettings, getSettingsFilePath } = require("./settings-store.cjs");

function createDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winotp-settings-"));
}

test("gets new settings defaults from the Rust normalizer", () => {
  const settings = getDefaultSettings();
  assert.equal(settings.accountSortOption, "DateAddedDesc");
  assert.equal(settings.autoLock, "5");
  assert.equal(settings.updateOnStartup, true);
  assert.equal(settings.theme, "dark");
});

test("uses the Electron settings file and normalizes saved values", () => {
  const directoryPath = createDirectory();
  const filePath = path.join(directoryPath, "app-settings.json");

  try {
    const store = new SettingsStore(undefined, { filePath });
    assert.equal(store.getSettings().autoLock, "5");

    const result = store.saveSettings({
      pinProtection: true,
      accountSortOption: "UsageBased",
      accountCustomOrderIds: [" acct-2 ", "", "acct-2", "acct-1"],
      autoLock: "15",
      minimizeOnClose: true,
      minimizeToTray: true,
      updateChannel: "Pre-release",
      theme: "light",
      customBackupFolderPath: "  C:\\Backups  ",
    });

    assert.equal(result.success, true);
    assert.equal(result.settings.minimizeOnClose, false);
    assert.equal(result.settings.minimizeToTray, true);
    assert.equal(result.settings.accountSortOption, "UsageBased");
    assert.deepEqual(result.settings.accountCustomOrderIds, ["acct-2", "acct-1"]);
    assert.equal(result.settings.autoLock, "15");
    assert.equal(result.settings.customBackupFolderPath, "C:\\Backups");
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).version, 1);

    const reopened = new SettingsStore(undefined, { filePath });
    assert.deepEqual(reopened.getSettings(), result.settings);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("uses the shared WinOTP app-data directory for Electron settings", () => {
  const app = { getPath: () => path.join(os.tmpdir(), "winotp-user-data") };
  const appDataRoot = process.platform === "win32" ? process.env.LOCALAPPDATA : app.getPath();
  assert.equal(
    getSettingsFilePath(app),
    path.join(appDataRoot, "WinOTP_Reborn", "app-settings.json"),
  );
});

test("does not replace malformed stored settings with defaults", () => {
  const directoryPath = createDirectory();
  const filePath = path.join(directoryPath, "app-settings.json");

  try {
    fs.writeFileSync(filePath, "not-json", "utf8");
    assert.throws(() => new SettingsStore(undefined, { filePath }), /stored Electron settings/);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("recovers malformed stored settings with an explicit safe-default action", () => {
  const directoryPath = createDirectory();
  const filePath = path.join(directoryPath, "app-settings.json");

  try {
    fs.writeFileSync(filePath, "not-json", "utf8");
    const store = new SettingsStore(undefined, { filePath, recoverMalformed: true });
    assert.equal(store.recoveryRequired, true);
    assert.equal(store.getSettings().pinProtection, false);

    const result = store.recoverSettings();
    assert.equal(result.success, true);
    assert.equal(store.recoveryRequired, false);
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).version, 1);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});
