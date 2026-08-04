const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { AccountStore, getWindowsPowerShellPath, normalizeAccount } = require("./account-store.cjs");
const { createAccountStoreLoader } = require("./account-store-loader.cjs");

test("retries account-store initialization after a failed attempt", () => {
  let attempts = 0;
  let errors = 0;
  const store = { close: () => {} };
  const loader = createAccountStoreLoader(
    () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary failure");
      }
      return store;
    },
    () => {
      errors += 1;
    },
  );

  assert.equal(loader.get(), undefined);
  assert.equal(loader.get(), store);
  assert.equal(loader.get(), store);
  assert.equal(attempts, 2);
  assert.equal(errors, 1);
  loader.close();
  assert.equal(loader.get(), store);
  assert.equal(attempts, 3);

  const closeErrors = [];
  const failingCloseLoader = createAccountStoreLoader(
    () => ({
      close: () => {
        throw new Error("close failure");
      },
    }),
    (error) => closeErrors.push(error),
  );
  failingCloseLoader.get();
  assert.doesNotThrow(() => failingCloseLoader.close());
  assert.equal(closeErrors.length, 1);
});

test("resolves migration PowerShell from the Windows system directory", () => {
  if (process.platform !== "win32") {
    return;
  }

  assert.match(
    getWindowsPowerShellPath(),
    /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
  );
});

test("uses the legacy credential id when the payload id is blank", () => {
  const normalized = normalizeAccount(
    { Id: "  ", Secret: "JBSWY3DPEHPK3PXP" },
    "credential-user",
  );

  assert.equal(normalized.ok, true);
  assert.equal(normalized.account.id, "credential-user");

  const nullId = normalizeAccount(
    { Id: null, Secret: "JBSWY3DPEHPK3PXP" },
    "credential-user",
  );
  assert.equal(nullId.ok, true);
  assert.equal(nullId.account.id, "credential-user");
});

test("closes the database when initialization fails", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));

  try {
    assert.throws(
      () =>
        new AccountStore(
          { getPath: () => directoryPath },
          {
            directoryPath,
            encryption: { isEncryptionAvailable: () => false },
            legacyCredentialReader: () => ({ ok: true, entries: [] }),
          },
        ),
      /Windows-backed secret encryption is unavailable/,
    );

    const reopened = createTestStore(directoryPath, () => ({ ok: true, entries: [] }));
    assert.equal(reopened.readAccounts().migration.status, "completed");
    reopened.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

function createTestEncryption() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) =>
      Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
    decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8"),
  };
}

function createTestStore(directoryPath, legacyCredentialReader, encryption = createTestEncryption()) {
  return new AccountStore(
    { getPath: () => directoryPath },
    { directoryPath, encryption, legacyCredentialReader },
  );
}

function makeLegacyPayload(overrides = {}) {
  return JSON.stringify({
    Id: "legacy-1",
    Issuer: "GitHub",
    AccountName: "dangelicodes",
    Secret: "JBSWY3DPEHPK3PXP",
    Algorithm: 0,
    Digits: 6,
    Period: 30,
    CreatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  });
}

test("migrates legacy accounts and persists account mutations", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  let migrationCalls = 0;
  const reader = () => {
    migrationCalls += 1;
    return {
      ok: true,
      entries: [{ id: "legacy-1", payload: makeLegacyPayload() }],
    };
  };

  try {
    const store = createTestStore(directoryPath, reader);
    const migrated = store.readAccounts();
    assert.equal(migrationCalls, 1);
    assert.equal(migrated.migration.status, "completed");
    assert.equal(migrated.migration.importedCount, 1);
    assert.equal(migrated.migration.justCompleted, true);
    assert.equal(migrated.accounts[0].secret, "JBSWY3DPEHPK3PXP");
    assert.equal(store.readAccounts().migration.justCompleted, true);
    assert.equal(store.acknowledgeMigrationNotification(), true);
    assert.equal(store.readAccounts().migration.justCompleted, undefined);

    const saveResult = store.saveAccount({
      id: "new-account",
      issuer: "AWS",
      accountName: "production",
      secret: "MFRGGZDFMZTWQ2LK",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    assert.equal(saveResult.success, true);

    const usageResult = store.recordUsage("new-account");
    assert.equal(usageResult.success, true);
    assert.equal(usageResult.usageCount, 1);
    assert.equal(
      store.saveAccount({
        ...saveResult.account,
        issuer: "AWS updated",
        usageCount: 0,
      }).success,
      true,
    );
    assert.equal(
      store.readAccounts().accounts.find((account) => account.id === "new-account")?.usageCount,
      1,
    );
    assert.equal(store.deleteAccount("legacy-1").success, true);
    assert.deepEqual(
      store.readAccounts().accounts.map((account) => account.id),
      ["new-account"],
    );
    store.close();

    const reopened = createTestStore(directoryPath, () => {
      throw new Error("Migration should not run again after the marker is written.");
    });
    assert.equal(reopened.readAccounts().accounts[0].usageCount, 1);
    reopened.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("records invalid legacy payloads without blocking future database use", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));

  try {
    const store = createTestStore(directoryPath, () => ({
      ok: true,
      entries: [
        { id: "bad-account", payload: makeLegacyPayload({ Secret: "not-base32" }) },
        { id: "unreadable-account", issue: "retrieve-failed" },
      ],
    }));
    const result = store.readAccounts();
    assert.equal(result.migration.status, "completed");
    assert.equal(result.migration.importedCount, 0);
    assert.equal(result.migration.skippedCount, 2);
    assert.equal(result.migration.justCompleted, true);
    assert.equal(result.accounts.length, 0);
    assert.equal(store.readAccounts().migration.justCompleted, true);
    store.acknowledgeMigrationNotification();
    assert.equal(store.readAccounts().migration.justCompleted, undefined);

    assert.equal(
      store.saveAccount({
        id: "manual-account",
        issuer: "Example",
        accountName: "user",
        secret: "JBSWY3DPEHPK3PXP",
      }).success,
      true,
    );
    assert.equal(store.readAccounts().accounts.length, 1);
    store.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not mark migration complete when encrypted storage fails", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  let migrationCalls = 0;
  const reader = () => {
    migrationCalls += 1;
    return {
      ok: true,
      entries: [{ id: "retry-account", payload: makeLegacyPayload({ Id: "retry-account" }) }],
    };
  };
  const failingEncryption = createTestEncryption();
  failingEncryption.encryptString = () => {
    throw new Error("encryption unavailable");
  };
  let failed;
  let retried;

  try {
    failed = createTestStore(directoryPath, reader, failingEncryption);
    assert.equal(failed.readAccounts().migration.status, "failed");
    failed.close();
    failed = undefined;

    retried = createTestStore(directoryPath, reader);
    const result = retried.readAccounts();
    assert.equal(migrationCalls, 2);
    assert.equal(result.migration.status, "completed");
    assert.equal(result.migration.importedCount, 1);
    assert.equal(result.accounts[0].id, "retry-account");
    retried.close();
    retried = undefined;
  } finally {
    retried?.close();
    failed?.close();
    fs.rmSync(directoryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
