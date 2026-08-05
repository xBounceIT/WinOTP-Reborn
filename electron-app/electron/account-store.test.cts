const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");

const { AccountStore, normalizeAccount, normalizeAccounts } = require("./account-store.cjs");
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

test("uses the legacy credential id when the payload id is blank", () => {
  const normalized = normalizeAccount({ Id: "  ", Secret: "JBSWY3DPEHPK3PXP" }, "credential-user");

  assert.equal(normalized.ok, true);
  assert.equal(normalized.account.id, "credential-user");

  const nullId = normalizeAccount({ Id: null, Secret: "JBSWY3DPEHPK3PXP" }, "credential-user");
  assert.equal(nullId.ok, true);
  assert.equal(nullId.account.id, "credential-user");

  const unsafeUsageCount = normalizeAccount(
    { Id: "credential-user", Secret: "JBSWY3DPEHPK3PXP", UsageCount: Number.MAX_VALUE },
    "credential-user",
  );
  assert.equal(unsafeUsageCount.ok, true);
  assert.equal(unsafeUsageCount.account.usageCount, 0);
});

test("normalizes account batches through the Rust core contract", () => {
  const normalized = normalizeAccounts([
    {
      source: { secret: "JBSWY3DPEHPK3PXP", algorithm: 1 },
      fallbackId: "first-account",
    },
    {
      source: { id: "second-account", secret: "MFRGGZDFMZTWQ2LK", digits: 8 },
      fallbackId: "ignored-account",
    },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].ok, true);
  assert.equal(normalized[0].account.id, "first-account");
  assert.equal(normalized[0].account.algorithm, "SHA256");
  assert.equal(normalized[1].account.digits, 8);
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
      /OS-backed secret encryption is unavailable/,
    );

    const reopened = createTestStore(directoryPath, () => ({ ok: true, entries: [] }));
    assert.equal(reopened.readAccounts().migration.status, "completed");
    reopened.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("adds the usage timestamp column when opening an older account database", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  const databasePath = path.join(directoryPath, "accounts.db");
  const encryption = createTestEncryption();
  const legacyCiphertext = encryption.encryptString("JBSWY3DPEHPK3PXP").toString("base64");
  const legacyDatabase = new DatabaseSync(databasePath);

  legacyDatabase.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      issuer TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      secret_ciphertext TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'SHA1',
      digits INTEGER NOT NULL DEFAULT 6,
      period INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  legacyDatabase
    .prepare("INSERT INTO metadata (key, value) VALUES (?, ?)")
    .run(
      "credential-manager-v1",
      JSON.stringify({ status: "completed", importedCount: 1, skippedCount: 0, issueCount: 0 }),
    );
  legacyDatabase
    .prepare(
      "INSERT INTO accounts (id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "legacy-1",
      "GitHub",
      "dangelicodes",
      legacyCiphertext,
      "SHA1",
      6,
      30,
      "2026-08-03T00:00:00.000Z",
      3,
    );
  legacyDatabase.close();

  try {
    const store = new AccountStore(
      { getPath: () => directoryPath },
      {
        directoryPath,
        encryption,
        legacyCredentialReader: () => {
          throw new Error("The completed migration must not run again.");
        },
      },
    );
    const result = store.readAccounts();
    assert.equal(result.accounts[0].usageCount, 3);
    assert.equal(result.accounts[0].lastUsedAt, undefined);
    assert.equal(store.recordUsage("legacy-1").success, true);
    store.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

function createTestEncryption() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
    decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8"),
  };
}

function createTestStore(
  directoryPath,
  legacyCredentialReader,
  encryption = createTestEncryption(),
  options = {},
) {
  return new AccountStore(
    { getPath: () => directoryPath },
    { directoryPath, encryption, legacyCredentialReader, ...options },
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

test("migrates Windows usage statistics into the account database", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  const legacyLastUsedAt = "2020-01-02T03:04:05.000Z";
  fs.writeFileSync(
    path.join(directoryPath, "usage-stats.json"),
    JSON.stringify({
      Entries: {
        "legacy-1": { Count: 7, LastUsedAt: legacyLastUsedAt },
        stale: { Count: 99, LastUsedAt: legacyLastUsedAt },
      },
    }),
  );

  try {
    const store = createTestStore(directoryPath, () => ({
      ok: true,
      entries: [{ id: "legacy-1", payload: makeLegacyPayload({ UsageCount: 2 }) }],
    }));
    const account = store.readAccounts().accounts[0];
    assert.equal(account.usageCount, 7);
    assert.equal(account.lastUsedAt, legacyLastUsedAt);

    const usageResult = store.recordUsage("legacy-1");
    assert.equal(usageResult.success, true);
    assert.equal(usageResult.usageCount, 8);
    assert.ok(usageResult.lastUsedAt);
    assert.notEqual(usageResult.lastUsedAt, legacyLastUsedAt);
    store.close();

    const reopened = createTestStore(directoryPath, () => {
      throw new Error("Credential migration should not run again after the marker is written.");
    });
    const persisted = reopened.readAccounts().accounts[0];
    assert.equal(persisted.usageCount, 8);
    assert.equal(persisted.lastUsedAt, usageResult.lastUsedAt);
    reopened.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("keeps malformed Windows usage statistics retryable", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  const usageStatsPath = path.join(directoryPath, "usage-stats.json");
  fs.writeFileSync(
    usageStatsPath,
    JSON.stringify({ Entries: { "legacy-1": { Count: "not-a-count" } } }),
  );

  try {
    const failed = createTestStore(directoryPath, () => ({
      ok: true,
      entries: [{ id: "legacy-1", payload: makeLegacyPayload() }],
    }));
    const failedResult = failed.readAccounts();
    assert.equal(failedResult.migration.status, "failed");
    assert.match(failedResult.migration.message, /usage statistics/i);
    failed.close();

    fs.writeFileSync(
      usageStatsPath,
      `\uFEFF${JSON.stringify({ Entries: { "legacy-1": { Count: 4, LastUsedAt: "2020-01-02T03:04:05Z" } } })}`,
    );
    const retried = createTestStore(directoryPath, () => {
      throw new Error("Credential migration should already be complete.");
    });
    const retriedResult = retried.readAccounts();
    assert.equal(retriedResult.migration.status, "completed");
    assert.equal(retriedResult.accounts[0].usageCount, 4);
    retried.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("rejects oversized Windows usage statistics without parsing them", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  const usageStatsPath = path.join(directoryPath, "usage-stats.json");
  const descriptor = fs.openSync(usageStatsPath, "w");
  fs.ftruncateSync(descriptor, 32 * 1024 * 1024 + 1);
  fs.closeSync(descriptor);

  try {
    const store = createTestStore(directoryPath, () => ({ ok: true, entries: [] }));
    const result = store.readAccounts();
    assert.equal(result.migration.status, "failed");
    assert.match(result.migration.message, /too large/i);
    store.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not run Windows migrations on non-Windows platforms", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));
  let migrationCalls = 0;
  fs.writeFileSync(path.join(directoryPath, "usage-stats.json"), "not-json");

  try {
    const store = createTestStore(
      directoryPath,
      () => {
        migrationCalls += 1;
        throw new Error("Windows Credential Manager should not be queried.");
      },
      createTestEncryption(),
      { platform: "linux" },
    );
    const result = store.readAccounts();
    assert.equal(migrationCalls, 0);
    assert.equal(result.migration.status, "completed");
    assert.equal(result.migration.importedCount, 0);
    assert.equal(result.migration.justCompleted, undefined);
    assert.deepEqual(result.accounts, []);
    store.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not hide a Windows migration failure behind a non-Windows marker", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));

  try {
    const nonWindowsStore = createTestStore(
      directoryPath,
      () => {
        throw new Error("The non-Windows migration must not query Windows credentials.");
      },
      createTestEncryption(),
      { platform: "linux" },
    );
    nonWindowsStore.close();

    const failedWindowsStore = createTestStore(directoryPath, () => ({
      ok: false,
      error: "temporary Windows migration failure",
    }));
    assert.equal(failedWindowsStore.readAccounts().migration.status, "failed");
    failedWindowsStore.close();

    const retriedWindowsStore = createTestStore(directoryPath, () => ({ ok: true, entries: [] }));
    assert.equal(retriedWindowsStore.readAccounts().migration.status, "completed");
    retriedWindowsStore.close();
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("turns a thrown credential reader into a retryable migration failure", () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-account-store-"));

  try {
    const failed = createTestStore(directoryPath, () => {
      throw new Error("Credential Manager is temporarily unavailable.");
    });
    const failedResult = failed.readAccounts();
    assert.equal(failedResult.migration.status, "failed");
    assert.match(failedResult.migration.message, /Credential Manager migration failed/i);
    failed.close();

    const retried = createTestStore(directoryPath, () => ({ ok: true, entries: [] }));
    assert.equal(retried.readAccounts().migration.status, "completed");
    retried.close();
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
