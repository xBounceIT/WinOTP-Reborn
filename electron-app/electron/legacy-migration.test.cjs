const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { mapLegacySettings, runLegacyMigration } = require("./legacy-migration.cjs");

function createDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winotp-legacy-migration-"));
}

test("preserves the native never-lock default when the timeout is absent", () => {
  assert.equal(mapLegacySettings({}).autoLock, "0");
});

test("maps native settings and migrates app-lock and backup credentials once", () => {
  const directoryPath = createDirectory();
  const legacySettingsPath = path.join(directoryPath, "settings.json");
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  let readerCalls = 0;
  let securityCredentials;
  let backupPassword;

  fs.writeFileSync(
    legacySettingsPath,
    JSON.stringify({
      ShowNextCodeWhenFiveSecondsRemain: true,
      AccountSortOption: "UsageBased",
      AccountCustomOrderIds: [" acct-2 ", "", "acct-2", "acct-1"],
      IsPinProtectionEnabled: true,
      IsPasswordProtectionEnabled: false,
      IsWindowsHelloEnabled: true,
      IsWindowsHelloRemotePinEnabled: true,
      AutoLockTimeoutMinutes: 10,
      IsAutomaticBackupEnabled: true,
      CustomBackupFolderPath: path.join(directoryPath, "custom-backups"),
      IsUpdateCheckEnabled: false,
      UpdateChannel: "PreRelease",
      MinimizeOnClose: true,
      MinimizeToTrayOnClose: true,
      ShowTotpInTrayMenu: true,
      AutoStartOnBoot: true,
    }),
  );

  const securityStore = {
    importLegacyCredentials: (credentials) => {
      securityCredentials = credentials;
      return { success: true, importedCount: Object.keys(credentials).length };
    },
  };
  const backupStore = {
    importLegacyPassword: (password) => {
      backupPassword = password;
      return { success: true, imported: true, importedCount: 1 };
    },
  };

  try {
    const first = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: (resources) => {
        readerCalls += 1;
        assert.deepEqual(resources, ["WinOTP_AppLock", "WinOTP_Backup"]);
        return {
          ok: true,
          entries: [
            { resource: "WinOTP_AppLock", id: "AppPin", payload: "1234" },
            { resource: "WinOTP_AppLock", id: "AppPassword", payload: "correct horse" },
            { resource: "WinOTP_AppLock", id: "WindowsHelloRemotePin", payload: "5678" },
            {
              resource: "WinOTP_AppLock",
              id: "WindowsHelloRemotePassword",
              payload: "remote password",
            },
            { resource: "WinOTP_Backup", id: "BackupPassword", payload: "backup-pass-1" },
          ],
        };
      },
      securityStore,
      backupStore,
    });

    assert.equal(first.settings.status, "completed");
    assert.equal(first.settings.importedCount, 1);
    assert.equal(first.appLock.status, "completed");
    assert.equal(first.appLock.importedCount, 4);
    assert.equal(first.backupPassword.status, "completed");
    assert.deepEqual(securityCredentials, {
      pin: "1234",
      password: "correct horse",
      remotePin: "5678",
      remotePassword: "remote password",
    });
    assert.equal(backupPassword, "backup-pass-1");

    const electronSettings = JSON.parse(
      fs.readFileSync(path.join(directoryPath, "app-settings.json"), "utf8"),
    ).settings;
    assert.deepEqual(electronSettings, {
      ...mapLegacySettings({
        ShowNextCodeWhenFiveSecondsRemain: true,
        AccountSortOption: "UsageBased",
        AccountCustomOrderIds: [" acct-2 ", "", "acct-2", "acct-1"],
        IsPinProtectionEnabled: true,
        IsWindowsHelloEnabled: true,
        IsWindowsHelloRemotePinEnabled: true,
        AutoLockTimeoutMinutes: 10,
        IsAutomaticBackupEnabled: true,
        CustomBackupFolderPath: path.join(directoryPath, "custom-backups"),
        IsUpdateCheckEnabled: false,
        UpdateChannel: "PreRelease",
        MinimizeOnClose: true,
        MinimizeToTrayOnClose: true,
        ShowTotpInTrayMenu: true,
        AutoStartOnBoot: true,
      }),
    });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directoryPath, "backup-settings.json"), "utf8")),
      {
        automaticEnabled: true,
        customFolderPath: path.join(directoryPath, "custom-backups"),
      },
    );

    const second = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => {
        throw new Error("The completed migration must not read legacy credentials again.");
      },
      securityStore,
      backupStore,
    });
    assert.equal(readerCalls, 1);
    assert.deepEqual(second, JSON.parse(fs.readFileSync(migrationFilePath, "utf8")));
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("keeps retryable credential migration failures out of the completed marker", () => {
  const directoryPath = createDirectory();
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  let calls = 0;

  try {
    const failed = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => {
        calls += 1;
        return { ok: false, error: "temporary Credential Manager failure" };
      },
    });
    assert.equal(failed.appLock.status, "failed");
    assert.equal(failed.backupPassword.status, "failed");

    const retried = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => {
        calls += 1;
        return { ok: true, entries: [] };
      },
    });
    assert.equal(calls, 2);
    assert.equal(retried.appLock.status, "completed");
    assert.equal(retried.backupPassword.status, "completed");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not complete credential migration for malformed reader results", () => {
  const directoryPath = createDirectory();
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");

  try {
    const malformed = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => ({ ok: true }),
    });
    assert.equal(malformed.appLock.status, "failed");
    assert.equal(malformed.backupPassword.status, "failed");

    fs.rmSync(migrationFilePath);
    const malformedEntry = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => ({ ok: true, entries: [{}] }),
    });
    assert.equal(malformedEntry.appLock.status, "failed");
    assert.equal(malformedEntry.backupPassword.status, "failed");

    fs.rmSync(migrationFilePath);
    const thrown = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => {
        throw new Error("temporary reader failure");
      },
    });
    assert.equal(thrown.appLock.status, "failed");
    assert.equal(thrown.backupPassword.status, "failed");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("retries credentials that were present but could not be read", () => {
  const directoryPath = createDirectory();
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  let calls = 0;
  let importedPassword;

  try {
    const first = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => {
        calls += 1;
        return {
          ok: true,
          entries: [
            { resource: "WinOTP_AppLock", id: "AppPin", issue: "retrieve-failed" },
            { resource: "WinOTP_Backup", id: "BackupPassword", issue: "retrieve-failed" },
          ],
        };
      },
      securityStore: {
        importLegacyCredentials: () => {
          throw new Error("The unreadable credential must not be imported.");
        },
      },
      backupStore: {
        importLegacyPassword: () => {
          throw new Error("The unreadable password must not be imported.");
        },
      },
    });

    assert.equal(first.appLock.status, "failed");
    assert.equal(first.backupPassword.status, "failed");

    const second = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => {
        calls += 1;
        return {
          ok: true,
          entries: [
            { resource: "WinOTP_AppLock", id: "AppPin", payload: "1234" },
            { resource: "WinOTP_Backup", id: "BackupPassword", payload: "backup-pass-1" },
          ],
        };
      },
      securityStore: {
        importLegacyCredentials: (credentials) => {
          assert.deepEqual(credentials, { pin: "1234" });
          return { success: true, importedCount: 1 };
        },
      },
      backupStore: {
        importLegacyPassword: (password) => {
          importedPassword = password;
          return { success: true, imported: true, importedCount: 1 };
        },
      },
    });

    assert.equal(calls, 2);
    assert.equal(second.appLock.status, "completed");
    assert.equal(second.backupPassword.status, "completed");
    assert.equal(importedPassword, "backup-pass-1");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not retry unreadable credentials already satisfied by Electron storage", () => {
  const directoryPath = createDirectory();
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  let securityImportCalled = false;
  let backupImportCalled = false;

  try {
    const result = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => ({
        ok: true,
        entries: [
          { resource: "WinOTP_AppLock", id: "AppPin", issue: "retrieve-failed" },
          { resource: "WinOTP_Backup", id: "BackupPassword", issue: "retrieve-failed" },
        ],
      }),
      securityStore: {
        getStatus: () => ({
          pinSet: true,
          passwordSet: false,
          remotePinSet: false,
          remotePasswordSet: false,
        }),
        importLegacyCredentials: () => {
          securityImportCalled = true;
          return { success: true };
        },
      },
      backupStore: {
        getStatus: () => ({ hasStoredPassword: true }),
        importLegacyPassword: () => {
          backupImportCalled = true;
          return { success: true };
        },
      },
    });

    assert.equal(result.appLock.status, "completed");
    assert.equal(result.backupPassword.status, "completed");
    assert.equal(securityImportCalled, false);
    assert.equal(backupImportCalled, false);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("repairs malformed Electron target settings while preserving valid targets", () => {
  const directoryPath = createDirectory();
  const legacySettingsPath = path.join(directoryPath, "settings.json");
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");

  fs.writeFileSync(
    legacySettingsPath,
    JSON.stringify({
      IsAutomaticBackupEnabled: true,
      CustomBackupFolderPath: path.join(directoryPath, "legacy-backups"),
      ShowNextCodeWhenFiveSecondsRemain: true,
    }),
  );
  fs.writeFileSync(
    path.join(directoryPath, "app-settings.json"),
    JSON.stringify({ version: 1, settings: [] }),
  );
  fs.writeFileSync(
    path.join(directoryPath, "backup-settings.json"),
    JSON.stringify({ automaticEnabled: "yes", customFolderPath: 42 }),
  );

  try {
    const first = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });

    assert.equal(first.settings.status, "completed");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directoryPath, "app-settings.json"), "utf8"))
        .settings.showNextCode,
      true,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directoryPath, "backup-settings.json"), "utf8")),
      {
        automaticEnabled: true,
        customFolderPath: path.join(directoryPath, "legacy-backups"),
      },
    );

    fs.writeFileSync(
      path.join(directoryPath, "app-settings.json"),
      JSON.stringify({
        version: 1,
        settings: { automaticBackup: false, customBackupFolderPath: "" },
      }),
    );
    fs.rmSync(path.join(directoryPath, "backup-settings.json"));
    fs.rmSync(migrationFilePath);

    runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });

    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directoryPath, "backup-settings.json"), "utf8")),
      { automaticEnabled: false, customFolderPath: "" },
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("keeps a native settings read failure retryable", () => {
  const directoryPath = createDirectory();
  const legacySettingsPath = path.join(directoryPath, "settings.json");
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");

  fs.mkdirSync(legacySettingsPath);

  try {
    const failed = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });
    assert.equal(failed.settings.status, "failed");

    fs.rmSync(legacySettingsPath, { recursive: true, force: true });
    fs.writeFileSync(legacySettingsPath, JSON.stringify({ ShowNextCodeWhenFiveSecondsRemain: true }));
    const retried = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });
    assert.equal(retried.settings.status, "completed");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("keeps malformed native settings retryable", () => {
  const directoryPath = createDirectory();
  const legacySettingsPath = path.join(directoryPath, "settings.json");
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  fs.writeFileSync(legacySettingsPath, "{not-json");

  try {
    const failed = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });
    assert.equal(failed.settings.status, "failed");

    fs.writeFileSync(legacySettingsPath, JSON.stringify({ ShowNextCodeWhenFiveSecondsRemain: true }));
    const retried = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });
    assert.equal(retried.settings.status, "completed");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("retries a migration part when its marker data is malformed", () => {
  const directoryPath = createDirectory();
  const legacySettingsPath = path.join(directoryPath, "settings.json");
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  fs.writeFileSync(legacySettingsPath, JSON.stringify({ ShowNextCodeWhenFiveSecondsRemain: true }));
  fs.writeFileSync(
    migrationFilePath,
    JSON.stringify({
      version: 1,
      settings: { status: "completed", importedCount: "corrupt", skippedCount: 0, issueCount: 0 },
      appLock: { status: "completed", importedCount: 0, skippedCount: 0, issueCount: 0 },
      backupPassword: { status: "completed", importedCount: 0, skippedCount: 0, issueCount: 0 },
    }),
  );

  try {
    const result = runLegacyMigration(undefined, {
      directoryPath,
      legacySettingsPath,
      migrationFilePath,
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    });

    assert.equal(result.settings.status, "completed");
    assert.equal(result.settings.importedCount, 1);
    assert.equal(fs.existsSync(path.join(directoryPath, "app-settings.json")), true);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("selects the valid keyed credential from duplicate legacy entries", () => {
  const directoryPath = createDirectory();
  const migrationFilePath = path.join(directoryPath, "legacy-migration.json");
  let appLockCredentials;
  let backupPassword;

  try {
    const result = runLegacyMigration(undefined, {
      directoryPath,
      migrationFilePath,
      legacySettingsPath: path.join(directoryPath, "missing-settings.json"),
      legacyCredentialReader: () => ({
        ok: true,
        entries: [
          { resource: "WinOTP_AppLock", id: "AppPin", payload: "12" },
          { resource: "WinOTP_AppLock", id: "AppPin", issue: "retrieve-failed" },
          { resource: "WinOTP_AppLock", id: "AppPin", payload: "1234" },
          { resource: "WinOTP_Backup", id: "Other", payload: "not-the-backup-password" },
          { resource: "WinOTP_Backup", id: "BackupPassword", payload: "backup-pass-1" },
        ],
      }),
      securityStore: {
        importLegacyCredentials: (credentials) => {
          appLockCredentials = credentials;
          return { success: true, importedCount: 1 };
        },
      },
      backupStore: {
        importLegacyPassword: (password) => {
          backupPassword = password;
          return { success: true, imported: true, importedCount: 1 };
        },
      },
    });

    assert.equal(result.appLock.status, "completed");
    assert.equal(result.backupPassword.status, "completed");
    assert.deepEqual(appLockCredentials, { pin: "1234" });
    assert.equal(backupPassword, "backup-pass-1");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});
