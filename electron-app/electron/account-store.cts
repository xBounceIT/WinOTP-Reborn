const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { safeStorage } = require("electron");
const { isSecureStorageAvailable } = require("./safe-storage.cjs");
const { readLegacyCredentials } = require("./legacy-credential-reader.cjs");
const { runRustCore } = require("./rust-core.cjs");

const APP_DIRECTORY_NAME = "WinOTP_Reborn";
const DATABASE_FILE_NAME = "accounts.db";
const MIGRATION_KEY = "credential-manager-v1";
const USAGE_MIGRATION_KEY = "usage-stats-v1";
const USAGE_STATS_FILE_NAME = "usage-stats.json";
const MAX_USAGE_STATS_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const LEGACY_RESOURCE = "WinOTP";
const ACCOUNT_NORMALIZATION_BATCH_SIZE = 256;
const ACCOUNT_NORMALIZATION_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

class AccountStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccountStoreError";
  }
}

function getAppDataDirectory(app, { environment = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    if (localAppData) {
      return path.join(localAppData, APP_DIRECTORY_NAME);
    }
  }

  return path.join(app.getPath("userData"), APP_DIRECTORY_NAME);
}

function normalizeLastUsedAt(value) {
  if (value === undefined || value === null || !String(value).trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1970) {
    return undefined;
  }

  return parsed.toISOString();
}

function latestLastUsedAt(current, next) {
  const currentValue = normalizeLastUsedAt(current);
  const nextValue = normalizeLastUsedAt(next);
  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return currentValue >= nextValue ? currentValue : nextValue;
}

function normalizeAccount(source, fallbackId) {
  try {
    const rustAccount = runRustCore("normalize-account", {
      source,
      fallbackId,
    });
    if (!rustAccount || typeof rustAccount !== "object" || Array.isArray(rustAccount)) {
      throw new Error("The WinOTP Rust core returned invalid account data.");
    }
    return { ok: true, account: rustAccount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account normalization failed.";
    if (message === "Secret is missing or not valid Base32.") {
      return { ok: false, error: message };
    }
    throw error;
  }
}

function normalizeAccounts(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const normalized = [];
  for (let offset = 0; offset < entries.length; offset += ACCOUNT_NORMALIZATION_BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + ACCOUNT_NORMALIZATION_BATCH_SIZE);
    const rustResults = runRustCore(
      "normalize-accounts",
      {
        accounts: chunk.map(({ source, fallbackId }) => ({ source, fallbackId })),
      },
      { maxBuffer: ACCOUNT_NORMALIZATION_MAX_BUFFER_BYTES },
    );

    if (!Array.isArray(rustResults) || rustResults.length !== chunk.length) {
      throw new Error("The WinOTP Rust core returned invalid account normalization data.");
    }

    normalized.push(
      ...rustResults.map((result) => {
        if (result?.ok === true && result.account) {
          return { ok: true, account: result.account };
        }
        if (result?.ok === false) {
          return { ok: false, error: String(result.error ?? "Account data is invalid.") };
        }
        throw new Error("The WinOTP Rust core returned an invalid account result.");
      }),
    );
  }

  return normalized;
}

function sanitizeAccount(account) {
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return account;
  }

  return { ...account, secret: "" };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function withoutMigrationPlatform(status) {
  const { platform: _platform, ...migration } = status;
  return migration;
}

class AccountStore {
  encryption: any;
  legacyCredentialReader: any;
  platform: NodeJS.Platform;
  directoryPath: string;
  databasePath: string;
  database: any;
  migrationNotificationPending: boolean;
  migration: any;
  previewAccountsCache: any;

  constructor(app, options: any = {}) {
    this.encryption = options.encryption ?? safeStorage;
    this.legacyCredentialReader = options.legacyCredentialReader ?? readLegacyCredentials;
    this.platform = options.platform ?? process.platform;
    this.directoryPath =
      options.directoryPath ?? getAppDataDirectory(app, { platform: this.platform });
    this.databasePath = path.join(this.directoryPath, DATABASE_FILE_NAME);
    this.database = undefined;
    this.migrationNotificationPending = false;
    this.previewAccountsCache = undefined;
    this.migration = {
      status: "pending",
      importedCount: 0,
      skippedCount: 0,
      issueCount: 0,
    };

    try {
      this.initialize();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  initialize() {
    fs.mkdirSync(this.directoryPath, { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY NOT NULL,
        issuer TEXT NOT NULL DEFAULT '',
        account_name TEXT NOT NULL DEFAULT '',
        secret_ciphertext TEXT NOT NULL,
        algorithm TEXT NOT NULL DEFAULT 'SHA1',
        digits INTEGER NOT NULL DEFAULT 6,
        period INTEGER NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS accounts_created_at_idx ON accounts(created_at);
    `);

    this.ensureAccountSchema();
    this.ensureEncryptionAvailable();
    this.migrateLegacyCredentials();
    this.migrateLegacyUsageStats();
  }

  ensureOpen() {
    if (!this.database) {
      throw new AccountStoreError("Account database is closed.");
    }
  }

  ensureEncryptionAvailable() {
    if (!isSecureStorageAvailable(this.encryption)) {
      throw new AccountStoreError("OS-backed secret encryption is unavailable.");
    }
  }

  ensureAccountSchema() {
    this.ensureOpen();
    const columns = this.database.prepare("PRAGMA table_info(accounts)").all();
    if (!columns.some((column) => column.name === "last_used_at")) {
      this.database.exec("ALTER TABLE accounts ADD COLUMN last_used_at TEXT");
    }
  }

  encryptSecret(secret) {
    this.ensureEncryptionAvailable();
    return this.encryption.encryptString(secret).toString("base64");
  }

  decryptSecret(ciphertext) {
    this.ensureEncryptionAvailable();
    return this.encryption.decryptString(Buffer.from(ciphertext, "base64"));
  }

  getMetadataStatus(key, fallback) {
    this.ensureOpen();
    const row = this.database.prepare("SELECT value FROM metadata WHERE key = ?").get(key);
    return row ? (safeJsonParse(row.value) ?? fallback) : fallback;
  }

  setMetadataStatus(key, value) {
    this.ensureOpen();
    this.database
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(key, JSON.stringify(value));
  }

  getStoredMigrationStatus() {
    return this.getMetadataStatus(MIGRATION_KEY, this.migration);
  }

  getMigrationStatus() {
    if (this.migration.status === "failed") {
      return withoutMigrationPlatform(this.migration);
    }

    return withoutMigrationPlatform(this.getStoredMigrationStatus());
  }

  failMigration(message) {
    this.migration = {
      ...this.migration,
      status: "failed",
      issueCount: Math.max(1, Number(this.migration.issueCount) || 0),
      message,
    };
    this.migrationNotificationPending = false;
  }

  getMigrationNotification() {
    const migration = this.getMigrationStatus();
    if (!this.migrationNotificationPending) {
      return migration;
    }

    return { ...migration, justCompleted: true };
  }

  acknowledgeMigrationNotification() {
    this.ensureOpen();
    this.migrationNotificationPending = false;
    return true;
  }

  migrateLegacyCredentials() {
    const marker = this.getStoredMigrationStatus();
    const markerAppliesToPlatform =
      marker.platform === undefined ||
      (this.platform === "win32"
        ? marker.platform === "win32"
        : marker.platform === "not-applicable");
    if (marker.status === "completed" && markerAppliesToPlatform) {
      this.migration = withoutMigrationPlatform(marker);
      return;
    }

    if (this.platform !== "win32") {
      const notApplicableResult = {
        status: "completed",
        importedCount: 0,
        skippedCount: 0,
        issueCount: 0,
        platform: "not-applicable",
      };
      try {
        this.setMetadataStatus(MIGRATION_KEY, notApplicableResult);
      } catch {
        // A read-only profile can still use the account database; retry the marker later.
      }
      this.migration = withoutMigrationPlatform(notApplicableResult);
      return;
    }

    let migrationResult;
    try {
      migrationResult = this.legacyCredentialReader([LEGACY_RESOURCE]);
    } catch {
      migrationResult = undefined;
    }
    if (!migrationResult?.ok) {
      this.migration = {
        status: "failed",
        importedCount: 0,
        skippedCount: 0,
        issueCount: 1,
        message: migrationResult?.error ?? "Windows Credential Manager migration failed.",
      };
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    let issueCount = 0;
    let retrievalFailedCount = 0;
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO accounts (
        id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      this.database.exec("BEGIN");
      for (const entry of migrationResult.entries) {
        if (entry?.issue) {
          skippedCount += 1;
          issueCount += 1;
          if (entry.issue === "retrieve-failed") {
            retrievalFailedCount += 1;
          }
          continue;
        }

        const normalizedPayload = safeJsonParse(String(entry?.payload ?? ""));
        const normalized = normalizeAccount(normalizedPayload, entry?.id);
        if (!normalized.ok) {
          skippedCount += 1;
          issueCount += 1;
          continue;
        }

        const ciphertext = this.encryptSecret(normalized.account.secret);
        const result = insert.run(
          normalized.account.id,
          normalized.account.issuer,
          normalized.account.accountName,
          ciphertext,
          normalized.account.algorithm,
          normalized.account.digits,
          normalized.account.period,
          normalized.account.createdAt,
          normalized.account.usageCount,
          normalized.account.lastUsedAt ?? null,
        );
        if (Number(result.changes) > 0) {
          importedCount += 1;
        }
      }

      if (retrievalFailedCount > 0) {
        // A transient Credential Manager retrieval failure must not mark the
        // migration complete: it would permanently hide that account. Keep the
        // marker pending so a later startup retries, while already imported
        // accounts remain idempotent through INSERT OR IGNORE.
        const pendingResult = {
          status: "pending",
          importedCount,
          skippedCount,
          issueCount,
        };
        try {
          this.setMetadataStatus(MIGRATION_KEY, { ...pendingResult, platform: "win32" });
        } catch {
          // A read-only profile can still use the account database; retry the marker later.
        }
        this.database.exec("COMMIT");
        this.migration = pendingResult;
        return;
      }

      const completeResult = {
        status: "completed",
        importedCount,
        skippedCount,
        issueCount,
      };
      this.setMetadataStatus(MIGRATION_KEY, { ...completeResult, platform: "win32" });
      this.database.exec("COMMIT");
      this.migration = completeResult;
      this.migrationNotificationPending = true;
    } catch {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
      this.migration = {
        status: "failed",
        importedCount,
        skippedCount,
        issueCount: issueCount + 1,
        message: "The account database could not complete migration.",
      };
    }
  }

  migrateLegacyUsageStats() {
    if (this.platform !== "win32") {
      return;
    }

    const marker = this.getMetadataStatus(USAGE_MIGRATION_KEY, {
      status: "pending",
      importedCount: 0,
      skippedCount: 0,
      issueCount: 0,
    });
    if (marker.status === "completed") {
      return;
    }

    if (this.getMigrationStatus().status !== "completed") {
      return;
    }

    const usageStatsPath = path.join(this.directoryPath, USAGE_STATS_FILE_NAME);
    if (!fs.existsSync(usageStatsPath)) {
      try {
        this.setMetadataStatus(USAGE_MIGRATION_KEY, {
          status: "completed",
          importedCount: 0,
          skippedCount: 0,
          issueCount: 0,
          platform: "win32",
        });
      } catch {
        // A read-only profile can still use the account database; retry the marker later.
      }
      return;
    }

    const markUsageMigrationFailed = (message) => {
      try {
        this.setMetadataStatus(USAGE_MIGRATION_KEY, {
          status: "failed",
          importedCount: 0,
          skippedCount: 0,
          issueCount: 1,
          platform: "win32",
          message,
        });
      } catch {
        // Keep account access available even if the migration marker cannot be written.
      }
    };

    let contents;
    try {
      if (fs.statSync(usageStatsPath).size > MAX_USAGE_STATS_FILE_SIZE_BYTES) {
        markUsageMigrationFailed("The legacy usage statistics file is too large.");
        return;
      }
      contents = fs.readFileSync(usageStatsPath, "utf8");
    } catch {
      markUsageMigrationFailed("The legacy usage statistics file could not be read.");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(contents.replace(/^\uFEFF/, ""));
    } catch {
      markUsageMigrationFailed("The legacy usage statistics file could not be parsed.");
      return;
    }

    const entries =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed.Entries ?? parsed.entries)
        : undefined;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      markUsageMigrationFailed("The legacy usage statistics file has an invalid format.");
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    let issueCount = 0;
    const select = this.database.prepare(
      "SELECT usage_count, last_used_at FROM accounts WHERE id = ?",
    );
    const update = this.database.prepare(
      "UPDATE accounts SET usage_count = ?, last_used_at = ? WHERE id = ?",
    );

    try {
      this.database.exec("BEGIN");
      for (const [rawId, rawEntryValue] of Object.entries(entries)) {
        const rawEntry = rawEntryValue as Record<string, unknown>;
        const accountId = String(rawId).trim();
        if (!accountId || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
          skippedCount += 1;
          issueCount += 1;
          continue;
        }

        const usageCount = Number(rawEntry.Count ?? rawEntry.count);
        if (!Number.isSafeInteger(usageCount) || usageCount < 0) {
          skippedCount += 1;
          issueCount += 1;
          continue;
        }

        let lastUsedAt;
        const rawLastUsedAt = rawEntry.LastUsedAt ?? rawEntry.lastUsedAt;
        if (rawLastUsedAt !== undefined && rawLastUsedAt !== null && String(rawLastUsedAt).trim()) {
          lastUsedAt = normalizeLastUsedAt(rawLastUsedAt);
          if (!lastUsedAt) {
            issueCount += 1;
          }
        }

        const row = select.get(accountId);
        if (!row) {
          skippedCount += 1;
          continue;
        }

        const existingUsageCount = Number(row.usage_count);
        const nextUsageCount = Number.isFinite(existingUsageCount)
          ? Math.max(existingUsageCount, usageCount)
          : usageCount;
        const nextLastUsedAt = latestLastUsedAt(row.last_used_at, lastUsedAt);
        if (
          nextUsageCount !== existingUsageCount ||
          nextLastUsedAt !== normalizeLastUsedAt(row.last_used_at)
        ) {
          update.run(nextUsageCount, nextLastUsedAt ?? null, accountId);
        }
        importedCount += 1;
      }

      const usageMigrationResult = {
        status: issueCount > 0 ? "failed" : "completed",
        importedCount,
        skippedCount,
        issueCount,
        platform: "win32",
        ...(issueCount > 0
          ? { message: "Some legacy usage statistics could not be migrated." }
          : {}),
      };
      this.setMetadataStatus(USAGE_MIGRATION_KEY, usageMigrationResult);
      this.database.exec("COMMIT");
    } catch {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
      try {
        this.setMetadataStatus(USAGE_MIGRATION_KEY, {
          status: "failed",
          importedCount,
          skippedCount,
          issueCount: issueCount + 1,
          platform: "win32",
          message: "The legacy usage statistics could not be migrated.",
        });
      } catch {
        // Keep account access available even if the migration marker cannot be written.
      }
    }
  }

  readAccounts({ includeSecrets = true } = {}) {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `SELECT id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count, last_used_at
         FROM accounts ORDER BY created_at DESC, id ASC`,
      )
      .all();
    const accounts = [];
    const issues = [];
    const records = [];
    const candidates = [];

    for (const row of rows) {
      try {
        const source = {
          id: row.id,
          issuer: row.issuer,
          accountName: row.account_name,
          secret: this.decryptSecret(row.secret_ciphertext),
          algorithm: row.algorithm,
          digits: row.digits,
          period: row.period,
          createdAt: row.created_at,
          usageCount: row.usage_count,
          lastUsedAt: row.last_used_at,
        };
        const candidate = { source, fallbackId: row.id };
        records.push({ row, candidate });
        candidates.push(candidate);
      } catch (error) {
        console.error("Failed to decrypt a stored WinOTP account.", {
          accountId: row.id,
          error: error instanceof Error ? error.stack : error,
        });
        records.push({ row, candidate: undefined });
      }
    }

    const normalizedResults = normalizeAccounts(candidates);
    if (normalizedResults.length !== candidates.length) {
      throw new Error("The WinOTP Rust core returned incomplete account data.");
    }
    let candidateIndex = 0;
    for (const record of records) {
      if (!record.candidate) {
        issues.push({
          code: "decrypt-failed",
          accountId: record.row.id,
          message: "A stored account could not be decrypted.",
        });
        continue;
      }

      const normalized = normalizedResults[candidateIndex];
      candidateIndex += 1;
      if (!normalized.ok) {
        issues.push({
          code: "invalid-data",
          accountId: record.row.id,
          message: "A stored account was skipped because its data is invalid.",
        });
        continue;
      }
      accounts.push(includeSecrets ? normalized.account : sanitizeAccount(normalized.account));
    }

    return {
      accounts,
      issues,
      migration: this.getMigrationNotification(),
      databasePath: this.databasePath,
    };
  }

  getAccount(id) {
    const accountId = typeof id === "string" ? id.trim() : "";
    if (!accountId) {
      return undefined;
    }

    return this.readAccounts().accounts.find((account) => account.id === accountId);
  }

  getPreviewAccounts() {
    this.ensureOpen();
    if (!this.previewAccountsCache) {
      // TOTP previews request the full vault every second; cache the
      // normalized records and invalidate on mutations instead of decrypting
      // and revalidating every account on each tick.
      this.previewAccountsCache = this.readAccounts().accounts;
    }
    return this.previewAccountsCache;
  }

  saveAccount(source) {
    this.ensureOpen();
    const normalized = normalizeAccount(source, source?.id);
    if (!normalized.ok) {
      return { success: false, message: normalized.error };
    }

    const account = normalized.account;
    const ciphertext = this.encryptSecret(account.secret);
    this.database
      .prepare(`
        INSERT INTO accounts (
          id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          issuer = excluded.issuer,
          account_name = excluded.account_name,
          secret_ciphertext = excluded.secret_ciphertext,
          algorithm = excluded.algorithm,
          digits = excluded.digits,
          period = excluded.period,
          created_at = excluded.created_at,
          usage_count = MAX(accounts.usage_count, excluded.usage_count),
          last_used_at = CASE
            WHEN excluded.last_used_at IS NULL THEN accounts.last_used_at
            WHEN accounts.last_used_at IS NULL OR accounts.last_used_at < excluded.last_used_at THEN excluded.last_used_at
            ELSE accounts.last_used_at
          END
      `)
      .run(
        account.id,
        account.issuer,
        account.accountName,
        ciphertext,
        account.algorithm,
        account.digits,
        account.period,
        account.createdAt,
        account.usageCount,
        account.lastUsedAt ?? null,
      );
    this.previewAccountsCache = undefined;

    return { success: true, account };
  }

  deleteAccount(id) {
    this.ensureOpen();
    const accountId = String(id ?? "").trim();
    if (!accountId) {
      return { success: false, message: "Account id is required." };
    }

    const result = this.database.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
    if (Number(result.changes) === 0) {
      return { success: false, message: "Account was not found." };
    }
    this.previewAccountsCache = undefined;

    return { success: true };
  }

  recordUsage(id) {
    this.ensureOpen();
    const accountId = String(id ?? "").trim();
    if (!accountId) {
      return { success: false, message: "Account id is required." };
    }

    const lastUsedAt = new Date().toISOString();
    const result = this.database
      .prepare("UPDATE accounts SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?")
      .run(lastUsedAt, accountId);
    if (Number(result.changes) === 0) {
      return { success: false, message: "Account was not found." };
    }

    const row = this.database
      .prepare("SELECT usage_count, last_used_at FROM accounts WHERE id = ?")
      .get(accountId);
    return {
      success: true,
      usageCount: Number(row.usage_count),
      lastUsedAt: normalizeLastUsedAt(row.last_used_at),
    };
  }

  close() {
    const database = this.database;
    this.database = undefined;
    try {
      database?.close();
    } catch {
      // Cleanup should not mask the original operation or shutdown error.
    }
  }
}

module.exports = {
  AccountStore,
  ACCOUNT_NORMALIZATION_BATCH_SIZE,
  getAppDataDirectory,
  normalizeAccount,
  normalizeAccounts,
  sanitizeAccount,
  readLegacyCredentials,
};
