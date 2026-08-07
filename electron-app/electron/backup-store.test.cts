const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { AccountStore } = require("./account-store.cjs");
const {
  BackupStore,
  MAX_BACKUP_ACCOUNT_COUNT,
  MAX_BACKUP_FILE_SIZE_BYTES,
  decryptPayload,
  encryptPayload,
} = require("./backup-store.cjs");

function createTestEncryption() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
    decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8"),
  };
}

function createAccountStore(initialAccounts = []) {
  const accounts = new Map(initialAccounts.map((account) => [account.id, { ...account }]));
  return {
    readAccounts() {
      return { accounts: [...accounts.values()].map((account) => ({ ...account })), issues: [] };
    },
    saveNormalizedAccount(source) {
      if (
        !source ||
        typeof source !== "object" ||
        !source.id ||
        !/^[A-Z2-7]+$/.test(source.secret ?? "")
      ) {
        return { success: false, message: "Invalid account." };
      }

      const account = {
        usageCount: 0,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        ...source,
      };
      accounts.set(account.id, account);
      return { success: true, account: { ...account } };
    },
    saveAccount(source) {
      return this.saveNormalizedAccount({
        usageCount: 0,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        ...source,
      });
    },
  };
}

function createBackupStore(directoryPath, accountStore, encryption = createTestEncryption()) {
  return new BackupStore({ getPath: () => directoryPath }, () => accountStore, {
    directoryPath,
    encryption,
  });
}

function createDeferredBackupStore(
  directoryPath,
  accountStore,
  encryption = createTestEncryption(),
) {
  return new BackupStore({ getPath: () => directoryPath }, () => accountStore, {
    directoryPath,
    encryption,
    skipAutomaticReconciliation: true,
  });
}

function createRealAccountStore(directoryPath) {
  return new AccountStore(
    { getPath: () => directoryPath },
    {
      directoryPath,
      encryption: createTestEncryption(),
      legacyCredentialReader: () => ({ ok: true, entries: [] }),
    },
  );
}

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winotp-backup-store-"));
}

const account = {
  id: "acct-1",
  issuer: "ACME",
  accountName: "jdoe@example.com",
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA256",
  digits: 8,
  period: 45,
  createdAt: "2026-08-03T00:00:00.000Z",
  usageCount: 3,
};

test("exports and imports encrypted backup files", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "round-trip.wotpbackup");
  const sourceStore = createBackupStore(directoryPath, createAccountStore([account]));
  const destinationAccountStore = createAccountStore();
  const destinationStore = createBackupStore(directoryPath, destinationAccountStore);

  try {
    const exportResult = sourceStore.exportBackup(exportPath, "backup-pass-1");
    const envelope = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    const importResult = destinationStore.importBackup(exportPath, "backup-pass-1");
    const imported = destinationAccountStore.readAccounts().accounts;

    assert.equal(exportResult.success, true);
    assert.equal(envelope.format, "winotp-backup");
    assert.equal(envelope.version, 1);
    assert.equal(typeof envelope.encryption.iterations, "number");
    assert.equal(envelope.ciphertext.includes(account.secret), false);
    assert.equal(importResult.success, true);
    assert.equal(importResult.importedCount, 1);
    assert.deepEqual(imported[0], account);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("uses the stored password when the export override is blank", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "stored-password.wotpbackup");
  const sourceStore = createBackupStore(directoryPath, createAccountStore([account]));

  try {
    assert.equal(sourceStore.setStoredPassword("backup-pass-1").success, true);
    const result = sourceStore.exportBackup(exportPath, "   ");

    assert.equal(result.success, true);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("imports a native backup password into the Electron password file", () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore());

  try {
    assert.deepEqual(store.importLegacyPassword("legacy-pass-1"), {
      success: true,
      imported: true,
      importedCount: 1,
      skippedCount: 0,
      issueCount: 0,
    });
    assert.equal(store.getStoredPassword(), "legacy-pass-1");
    assert.deepEqual(store.importLegacyPassword("another-pass"), {
      success: true,
      imported: false,
      importedCount: 0,
      skippedCount: 1,
      issueCount: 0,
    });
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("replaces an unusable existing backup password during migration", () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore());

  try {
    fs.writeFileSync(
      path.join(directoryPath, ".backup-password"),
      Buffer.from(Buffer.from("short", "utf8").toString("base64"), "utf8"),
    );

    assert.deepEqual(store.importLegacyPassword("legacy-pass-1"), {
      success: true,
      imported: true,
      importedCount: 1,
      skippedCount: 0,
      issueCount: 0,
    });
    assert.equal(store.getStoredPassword(), "legacy-pass-1");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("round-trips accounts through the Electron SQLite account store", () => {
  const directoryPath = createTemporaryDirectory();
  const sourceDirectoryPath = path.join(directoryPath, "source");
  const destinationDirectoryPath = path.join(directoryPath, "destination");
  const exportPath = path.join(directoryPath, "sqlite-round-trip.wotpbackup");
  let sourceAccountStore;
  let destinationAccountStore;

  try {
    sourceAccountStore = createRealAccountStore(sourceDirectoryPath);
    destinationAccountStore = createRealAccountStore(destinationDirectoryPath);
    assert.equal(sourceAccountStore.saveAccount(account).success, true);

    const sourceBackupStore = createBackupStore(sourceDirectoryPath, sourceAccountStore);
    const destinationBackupStore = createBackupStore(
      destinationDirectoryPath,
      destinationAccountStore,
    );

    assert.equal(sourceBackupStore.exportBackup(exportPath, "backup-pass-1").success, true);
    assert.equal(destinationBackupStore.importBackup(exportPath, "backup-pass-1").success, true);
    assert.deepEqual(destinationAccountStore.readAccounts().accounts, [account]);
  } finally {
    sourceAccountStore?.close();
    destinationAccountStore?.close();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("rejects a wrong backup password without writing accounts", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "wrong-password.wotpbackup");
  const sourceStore = createBackupStore(directoryPath, createAccountStore([account]));
  const destinationAccountStore = createAccountStore();
  const destinationStore = createBackupStore(directoryPath, destinationAccountStore);

  try {
    assert.equal(sourceStore.exportBackup(exportPath, "backup-pass-1").success, true);
    const result = destinationStore.importBackup(exportPath, "backup-pass-2");
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DecryptionFailed");
    assert.deepEqual(destinationAccountStore.readAccounts().accounts, []);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("rejects unsupported backup metadata as an invalid format", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "unsupported-version.wotpbackup");
  const sourceStore = createBackupStore(directoryPath, createAccountStore([account]));
  const destinationAccountStore = createAccountStore();
  const destinationStore = createBackupStore(directoryPath, destinationAccountStore);

  try {
    assert.equal(sourceStore.exportBackup(exportPath, "backup-pass-1").success, true);
    const envelope = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    envelope.version = 2;
    fs.writeFileSync(exportPath, JSON.stringify(envelope));

    const result = destinationStore.importBackup(exportPath, "backup-pass-1");

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "InvalidFormat");
    assert.deepEqual(destinationAccountStore.readAccounts().accounts, []);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("reports an unreadable backup path as a file-access failure", () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore());

  try {
    const result = store.importBackup(
      path.join(directoryPath, "missing.wotpbackup"),
      "backup-pass-1",
    );

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "FileAccessFailed");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("refuses to export when account migration left incomplete data", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "incomplete.wotpbackup");
  const accountStore = {
    readAccounts: () => ({
      accounts: [account],
      issues: [],
      migration: { status: "completed", issueCount: 1 },
    }),
  };
  const store = createBackupStore(directoryPath, accountStore);

  try {
    const result = store.exportBackup(exportPath, "backup-pass-1");

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "IncompleteData");
    assert.equal(fs.existsSync(exportPath), false);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("exports accounts when only legacy usage-stat migration fails", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "usage-migration-failed.wotpbackup");
  fs.writeFileSync(path.join(directoryPath, "usage-stats.json"), "not-json");
  const accountStore = createRealAccountStore(directoryPath);
  const store = createBackupStore(directoryPath, accountStore);

  try {
    assert.equal(accountStore.saveAccount(account).success, true);
    const result = store.exportBackup(exportPath, "backup-pass-1");

    assert.equal(result.success, true);
    assert.equal(result.accountCount, 1);
  } finally {
    accountStore.close();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not overwrite Electron account, settings, or backup state files", () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore([account]));

  try {
    for (const fileName of [
      "backup-settings.json",
      "settings.json",
      "app-settings.json",
      "legacy-migration.json",
      "accounts.db",
    ]) {
      const result = store.exportBackup(path.join(directoryPath, fileName), "backup-pass-1");

      assert.equal(result.success, false);
      assert.equal(result.errorCode, "ValidationFailed");
      assert.equal(fs.existsSync(path.join(directoryPath, fileName)), false);
    }
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not enable automatic backups without a stored password", async () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore());

  try {
    const result = await store.configure({
      automaticEnabled: true,
      customFolderPath: path.join(directoryPath, "automatic"),
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "PasswordUnavailable");
    assert.equal(store.getStatus().automaticEnabled, false);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("repairs persisted automatic settings when the password is missing", () => {
  const directoryPath = createTemporaryDirectory();

  try {
    fs.writeFileSync(
      path.join(directoryPath, "backup-settings.json"),
      JSON.stringify({ automaticEnabled: true, customFolderPath: "" }),
    );

    const reopenedStore = createBackupStore(directoryPath, createAccountStore());
    assert.equal(reopenedStore.getStatus().automaticEnabled, false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directoryPath, "backup-settings.json"), "utf8"))
        .automaticEnabled,
      false,
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not treat an undecryptable stored password as missing", () => {
  const directoryPath = createTemporaryDirectory();
  const settingsPath = path.join(directoryPath, "backup-settings.json");
  const passwordPath = path.join(directoryPath, ".backup-password");
  const encryption = {
    ...createTestEncryption(),
    decryptString: () => {
      throw new Error("corrupted password");
    },
  };

  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ automaticEnabled: true, customFolderPath: "" }),
    );
    fs.writeFileSync(passwordPath, "corrupted");
    const store = createDeferredBackupStore(directoryPath, createAccountStore(), encryption);

    assert.throws(() => store.getStatus(), /stored backup password is unavailable/i);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, "utf8")).automaticEnabled, true);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not replace malformed stored backup settings with defaults", () => {
  const directoryPath = createTemporaryDirectory();

  try {
    fs.writeFileSync(path.join(directoryPath, "backup-settings.json"), "{not-json");

    assert.throws(
      () => createBackupStore(directoryPath, createAccountStore()),
      /stored backup settings are invalid/i,
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("can defer automatic-backup repair while a legacy password migration is retryable", () => {
  const directoryPath = createTemporaryDirectory();
  fs.writeFileSync(
    path.join(directoryPath, "backup-settings.json"),
    JSON.stringify({ automaticEnabled: true, customFolderPath: "" }),
  );
  const store = createDeferredBackupStore(directoryPath, createAccountStore());

  try {
    assert.equal(store.getStatus().automaticEnabled, true);
    store.reconcileAutomaticSettings();
    assert.equal(store.getStatus().automaticEnabled, false);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("rejects oversized backup files before parsing them", () => {
  const directoryPath = createTemporaryDirectory();
  const sourcePath = path.join(directoryPath, "oversized.wotpbackup");
  const store = createBackupStore(directoryPath, createAccountStore());

  try {
    fs.writeFileSync(sourcePath, "{}");
    fs.truncateSync(sourcePath, MAX_BACKUP_FILE_SIZE_BYTES + 1);

    const result = store.importBackup(sourcePath, "backup-pass-1");

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "InvalidFormat");
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("rejects authenticated backups with too many accounts before saving", () => {
  const directoryPath = createTemporaryDirectory();
  const exportPath = path.join(directoryPath, "too-many-accounts.wotpbackup");
  const destinationAccountStore = createAccountStore();
  const destinationStore = createBackupStore(directoryPath, destinationAccountStore);
  const accounts = Array.from({ length: MAX_BACKUP_ACCOUNT_COUNT + 1 }, (_, index) => ({
    ...account,
    id: `account-${index}`,
  }));

  try {
    const envelope = encryptPayload(
      { accounts, exportedAtUtc: "2026-08-03T00:00:00.000Z" },
      "backup-pass-1",
    );
    fs.writeFileSync(exportPath, `${JSON.stringify(envelope)}\n`);

    const result = destinationStore.importBackup(exportPath, "backup-pass-1");

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "InvalidFormat");
    assert.deepEqual(destinationAccountStore.readAccounts().accounts, []);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("serializes concurrent automatic backups and keeps the backup folder writable", async () => {
  const directoryPath = createTemporaryDirectory();
  const automaticFolder = path.join(directoryPath, "automatic");
  const store = createBackupStore(directoryPath, createAccountStore([account]));

  try {
    assert.equal(store.setStoredPassword("backup-pass-1").success, true);
    assert.equal(
      (await store.configure({ automaticEnabled: true, customFolderPath: automaticFolder }))
        .success,
      true,
    );
    const results = await Promise.all([
      store.createAutomaticBackup(),
      store.createAutomaticBackup(),
    ]);

    assert.ok(results.every((result) => result.success));
    assert.equal(
      fs.readdirSync(automaticFolder).filter((file) => file.endsWith(".wotpbackup")).length,
      2,
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("serializes concurrent automatic configuration changes", async () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore([account]));

  try {
    const results = await Promise.all([
      store.enableAutomatic("backup-pass-1"),
      store.enableAutomatic("backup-pass-2"),
    ]);
    const automaticFiles = fs
      .readdirSync(path.join(directoryPath, "Backups"))
      .filter((fileName) => fileName.endsWith(".wotpbackup"));

    assert.ok(results.every((result) => result.success));
    assert.equal(store.getStatus().hasStoredPassword, true);
    assert.equal(automaticFiles.length, 2);
    assert.equal(
      automaticFiles.filter((fileName) => {
        const envelope = JSON.parse(
          fs.readFileSync(path.join(directoryPath, "Backups", fileName), "utf8"),
        );
        try {
          decryptPayload(envelope, "backup-pass-1");
          return true;
        } catch {
          return false;
        }
      }).length,
      1,
    );
    assert.equal(
      automaticFiles.filter((fileName) => {
        const envelope = JSON.parse(
          fs.readFileSync(path.join(directoryPath, "Backups", fileName), "utf8"),
        );
        try {
          decryptPayload(envelope, "backup-pass-2");
          return true;
        } catch {
          return false;
        }
      }).length,
      1,
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("validates automatic backup folders", () => {
  const directoryPath = createTemporaryDirectory();
  const store = createBackupStore(directoryPath, createAccountStore());
  const filePath = path.join(directoryPath, "not-a-folder");

  try {
    fs.writeFileSync(filePath, "content");
    assert.equal(store.validateBackupFolder("relative-folder").errorCode, "ValidationFailed");
    assert.equal(
      store.validateBackupFolder(filePath).message,
      "The selected backup folder points to a file, not a folder.",
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});
