const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { safeStorage } = require("electron");
const { getWindowsPowerShellPath, readLegacyCredentials } = require("./legacy-credential-reader.cjs");

const APP_DIRECTORY_NAME = "WinOTP_Reborn";
const DATABASE_FILE_NAME = "accounts.db";
const MIGRATION_KEY = "credential-manager-v1";
const LEGACY_RESOURCE = "WinOTP";

const algorithmNames = ["SHA1", "SHA256", "SHA512"];

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

function normalizeAlgorithm(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return algorithmNames[value] ?? "SHA1";
  }

  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "");

  if (normalized === "0") {
    return "SHA1";
  }
  if (normalized === "1") {
    return "SHA256";
  }
  if (normalized === "2") {
    return "SHA512";
  }

  return algorithmNames.includes(normalized) ? normalized : "SHA1";
}

function normalizeCreatedAt(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1970) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeAccount(source, fallbackId) {
  const input = source && typeof source === "object" ? source : {};
  const explicitId = input.id ?? input.Id;
  const idValue =
    explicitId !== undefined && explicitId !== null && String(explicitId).trim()
      ? explicitId
      : fallbackId;
  const id = String(idValue ?? "").trim();
  const issuer = String(input.issuer ?? input.Issuer ?? "").trim();
  const accountName = String(input.accountName ?? input.AccountName ?? "").trim();
  const secret = String(input.secret ?? input.Secret ?? "")
    .trim()
    .replace(/\s/g, "")
    .toUpperCase();
  const unpaddedSecret = secret.replace(/=+$/, "");

  if (!id) {
    return { ok: false, error: "Account id is required." };
  }
  if (!unpaddedSecret || !/^[A-Z2-7]+$/.test(unpaddedSecret)) {
    return { ok: false, error: "Secret is missing or not valid Base32." };
  }

  const digitsValue = Number(input.digits ?? input.Digits ?? 6);
  const periodValue = Number(input.period ?? input.Period ?? 30);
  const usageValue = Number(input.usageCount ?? input.UsageCount ?? 0);

  return {
    ok: true,
    account: {
      id,
      issuer,
      accountName,
      secret,
      algorithm: normalizeAlgorithm(input.algorithm ?? input.Algorithm),
      digits: digitsValue === 8 ? 8 : 6,
      period: Number.isInteger(periodValue) && periodValue > 0 ? periodValue : 30,
      createdAt: normalizeCreatedAt(input.createdAt ?? input.CreatedAt),
      usageCount: Number.isFinite(usageValue) ? Math.max(0, Math.trunc(usageValue)) : 0,
    },
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

class AccountStore {
  constructor(app, options = {}) {
    this.encryption = options.encryption ?? safeStorage;
    this.legacyCredentialReader = options.legacyCredentialReader ?? readLegacyCredentials;
    this.directoryPath = options.directoryPath ?? getAppDataDirectory(app);
    this.databasePath = path.join(this.directoryPath, DATABASE_FILE_NAME);
    this.database = undefined;
    this.migrationNotificationPending = false;
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
        usage_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS accounts_created_at_idx ON accounts(created_at);
    `);

    this.ensureEncryptionAvailable();
    this.migrateLegacyCredentials();
  }

  ensureOpen() {
    if (!this.database) {
      throw new AccountStoreError("Account database is closed.");
    }
  }

  ensureEncryptionAvailable() {
    if (!this.encryption || !this.encryption.isEncryptionAvailable()) {
      throw new AccountStoreError("Windows-backed secret encryption is unavailable.");
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

  getMigrationStatus() {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(MIGRATION_KEY);
    return row ? safeJsonParse(row.value) ?? this.migration : this.migration;
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
    const marker = this.getMigrationStatus();
    if (marker.status === "completed") {
      this.migration = marker;
      return;
    }

    const migrationResult = this.legacyCredentialReader([LEGACY_RESOURCE]);
    if (!migrationResult.ok) {
      this.migration = {
        status: "failed",
        importedCount: 0,
        skippedCount: 0,
        issueCount: 1,
        message: migrationResult.error,
      };
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    let issueCount = 0;
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO accounts (
        id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      this.database.exec("BEGIN");
      for (const entry of migrationResult.entries) {
        if (entry?.issue) {
          skippedCount += 1;
          issueCount += 1;
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
        );
        if (Number(result.changes) > 0) {
          importedCount += 1;
        }
      }

      const completeResult = {
        status: "completed",
        importedCount,
        skippedCount,
        issueCount,
      };
      this.database
        .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
        .run(MIGRATION_KEY, JSON.stringify(completeResult));
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

  readAccounts() {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `SELECT id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count
         FROM accounts ORDER BY created_at DESC, id ASC`,
      )
      .all();
    const accounts = [];
    const issues = [];

    for (const row of rows) {
      try {
        const normalized = normalizeAccount(
          {
            id: row.id,
            issuer: row.issuer,
            accountName: row.account_name,
            secret: this.decryptSecret(row.secret_ciphertext),
            algorithm: row.algorithm,
            digits: row.digits,
            period: row.period,
            createdAt: row.created_at,
            usageCount: row.usage_count,
          },
          row.id,
        );
        if (!normalized.ok) {
          issues.push({
            code: "invalid-data",
            accountId: row.id,
            message: "A stored account was skipped because its data is invalid.",
          });
          continue;
        }
        accounts.push(normalized.account);
      } catch {
        issues.push({
          code: "decrypt-failed",
          accountId: row.id,
          message: "A stored account could not be decrypted.",
        });
      }
    }

    return {
      accounts,
      issues,
      migration: this.getMigrationNotification(),
      databasePath: this.databasePath,
    };
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
          id, issuer, account_name, secret_ciphertext, algorithm, digits, period, created_at, usage_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          issuer = excluded.issuer,
          account_name = excluded.account_name,
          secret_ciphertext = excluded.secret_ciphertext,
          algorithm = excluded.algorithm,
          digits = excluded.digits,
          period = excluded.period,
          created_at = excluded.created_at,
          usage_count = MAX(accounts.usage_count, excluded.usage_count)
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
      );

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

    return { success: true };
  }

  recordUsage(id) {
    this.ensureOpen();
    const accountId = String(id ?? "").trim();
    if (!accountId) {
      return { success: false, message: "Account id is required." };
    }

    const result = this.database
      .prepare("UPDATE accounts SET usage_count = usage_count + 1 WHERE id = ?")
      .run(accountId);
    if (Number(result.changes) === 0) {
      return { success: false, message: "Account was not found." };
    }

    const row = this.database
      .prepare("SELECT usage_count FROM accounts WHERE id = ?")
      .get(accountId);
    return { success: true, usageCount: Number(row.usage_count) };
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
  getAppDataDirectory,
  getWindowsPowerShellPath,
  normalizeAccount,
  readLegacyCredentials,
};
