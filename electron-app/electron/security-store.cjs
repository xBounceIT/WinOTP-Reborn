const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECURITY_FILE_NAME = "security.json";
const SECURITY_FILE_VERSION = 1;
const MAX_PASSWORD_LENGTH = 128;
const credentialKinds = new Set(["pin", "password", "remotePin", "remotePassword"]);

function getDefaultEncryption() {
  return require("electron").safeStorage;
}

function getSecurityFilePath(app) {
  return path.join(app.getPath("userData"), SECURITY_FILE_NAME);
}

function emptyState() {
  return {
    version: SECURITY_FILE_VERSION,
    credentials: {},
  };
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.version !== SECURITY_FILE_VERSION || !parsed.credentials) {
      return emptyState();
    }

    const credentials = {};
    for (const kind of credentialKinds) {
      if (typeof parsed.credentials[kind] === "string" && parsed.credentials[kind].length > 0) {
        credentials[kind] = parsed.credentials[kind];
      }
    }

    return { version: SECURITY_FILE_VERSION, credentials };
  } catch {
    return emptyState();
  }
}

function validateKind(kind) {
  if (!credentialKinds.has(kind)) {
    throw new Error("Unsupported security credential.");
  }
}

function validateSecret(kind, secret) {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("A security credential is required.");
  }

  if (kind === "pin" || kind === "remotePin") {
    if (!/^\d{4,6}$/.test(secret)) {
      throw new Error("PIN must contain 4-6 digits.");
    }
    return;
  }

  if (secret.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }

  if (secret.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
}

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

class SecurityStore {
  constructor(app, options = {}) {
    this.encryption = options.encryption ?? getDefaultEncryption();
    this.filePath = options.filePath ?? getSecurityFilePath(app);
    this.state = readState(this.filePath);
  }

  getStatus() {
    this.ensureEncryptionAvailable();
    return {
      pinSet: this.hasUsableCredential("pin"),
      passwordSet: this.hasUsableCredential("password"),
      remotePinSet: this.hasUsableCredential("remotePin"),
      remotePasswordSet: this.hasUsableCredential("remotePassword"),
    };
  }

  importLegacyCredentials(credentials = {}) {
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return {
        success: true,
        importedCount: 0,
        skippedCount: 1,
        issueCount: 1,
      };
    }

    const entries = Object.entries(credentials);
    if (entries.length === 0) {
      return { success: true, importedCount: 0, skippedCount: 0, issueCount: 0 };
    }

    this.ensureEncryptionAvailable();
    const previousCredentials = { ...this.state.credentials };
    const nextCredentials = { ...previousCredentials };
    let importedCount = 0;
    let skippedCount = 0;
    let issueCount = 0;

    for (const [kind, secret] of entries) {
      try {
        validateKind(kind);
        validateSecret(kind, secret);
      } catch {
        skippedCount += 1;
        issueCount += 1;
        continue;
      }

      if (this.hasUsableCredential(kind)) {
        skippedCount += 1;
        continue;
      }

      nextCredentials[kind] = this.encryption.encryptString(secret).toString("base64");
      importedCount += 1;
    }

    if (importedCount === 0) {
      return { success: true, importedCount, skippedCount, issueCount };
    }

    this.state.credentials = nextCredentials;
    try {
      this.writeState();
    } catch (error) {
      this.state.credentials = previousCredentials;
      throw error;
    }

    return { success: true, importedCount, skippedCount, issueCount };
  }

  setCredential(kind, secret) {
    validateKind(kind);
    validateSecret(kind, secret);
    this.ensureEncryptionAvailable();

    const previousCiphertext = this.state.credentials[kind];
    this.state.credentials[kind] = this.encryption.encryptString(secret).toString("base64");
    try {
      this.writeState();
    } catch (error) {
      if (previousCiphertext) {
        this.state.credentials[kind] = previousCiphertext;
      } else {
        delete this.state.credentials[kind];
      }
      throw error;
    }
  }

  verifyCredential(kind, secret) {
    validateKind(kind);
    this.ensureEncryptionAvailable();
    if (typeof secret !== "string") {
      return { verified: false, credentialAvailable: false };
    }

    const storedSecret = this.decryptCredential(kind);
    if (storedSecret === undefined) {
      return { verified: false, credentialAvailable: false };
    }

    try {
      validateSecret(kind, secret);
    } catch {
      return { verified: false, credentialAvailable: true };
    }

    return {
      verified: secretsEqual(storedSecret, secret),
      credentialAvailable: true,
    };
  }

  removeCredential(kind) {
    validateKind(kind);
    if (!this.state.credentials[kind]) {
      return;
    }

    const previousCiphertext = this.state.credentials[kind];
    delete this.state.credentials[kind];
    try {
      this.writeState();
    } catch (error) {
      this.state.credentials[kind] = previousCiphertext;
      throw error;
    }
  }

  ensureEncryptionAvailable() {
    if (!this.encryption || typeof this.encryption.isEncryptionAvailable !== "function") {
      throw new Error("OS-backed security storage is unavailable.");
    }

    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("OS-backed security storage is unavailable.");
    }
  }

  hasUsableCredential(kind) {
    return this.decryptCredential(kind) !== undefined;
  }

  decryptCredential(kind) {
    const ciphertext = this.state.credentials[kind];
    if (!ciphertext) {
      return undefined;
    }

    try {
      const secret = this.encryption.decryptString(Buffer.from(ciphertext, "base64"));
      validateSecret(kind, secret);
      return secret;
    } catch {
      return undefined;
    }
  }

  writeState() {
    const directory = path.dirname(this.filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );

    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(this.state), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the original write or rename failure.
      }
      throw error;
    }
  }
}

module.exports = {
  SecurityStore,
  getSecurityFilePath,
  validateSecret,
};
