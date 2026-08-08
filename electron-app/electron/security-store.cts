const fs = require("node:fs");
const path = require("node:path");
const { isSecureStorageAvailable } = require("./safe-storage.cjs");
const crypto = require("node:crypto");
const { runRustCore } = require("./rust-core.cjs");

const SECURITY_FILE_NAME = "security.json";
const SECURITY_FILE_VERSION = 1;
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
  let contents;

  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyState();
    }

    throw new Error("Stored security credentials are unavailable.");
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Stored security credentials are unavailable.");
  }

  if (
    !parsed ||
    parsed.version !== SECURITY_FILE_VERSION ||
    !parsed.credentials ||
    typeof parsed.credentials !== "object" ||
    Array.isArray(parsed.credentials)
  ) {
    throw new Error("Stored security credentials are unavailable.");
  }

  const credentials = {};
  for (const kind of credentialKinds) {
    if (parsed.credentials[kind] === undefined) {
      continue;
    }

    if (typeof parsed.credentials[kind] !== "string" || parsed.credentials[kind].length === 0) {
      throw new Error("Stored security credentials are unavailable.");
    }

    credentials[kind] = parsed.credentials[kind];
  }

  return { version: SECURITY_FILE_VERSION, credentials };
}

function validateKind(kind) {
  if (!credentialKinds.has(kind)) {
    throw new Error("Unsupported security credential.");
  }
}

function validateSecret(kind, secret) {
  runRustCore("validate-security-credential", { kind, secret });
}

class SecurityStore {
  encryption: any;
  filePath: string;
  state: any;

  constructor(app, options: any = {}) {
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
        if (typeof secret !== "string" || secret.length === 0) {
          throw new Error("A security credential is required.");
        }
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

    const previousCredentials = { ...this.state.credentials };
    this.state.credentials[kind] = this.encryption.encryptString(secret).toString("base64");
    try {
      this.writeState();
    } catch (error) {
      this.state.credentials = previousCredentials;
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

    const verification = runRustCore("verify-security-credential", {
      storedSecret,
      candidateSecret: secret,
    });
    if (
      !verification ||
      typeof verification !== "object" ||
      Array.isArray(verification) ||
      typeof verification.verified !== "boolean"
    ) {
      throw new Error("The WinOTP Rust core returned invalid credential verification data.");
    }

    return {
      verified: verification.verified,
      credentialAvailable: true,
    };
  }

  removeCredential(kind) {
    this.removeCredentials([kind]);
  }

  removeCredentials(kinds = []) {
    const uniqueKinds = [...new Set(kinds)];
    uniqueKinds.forEach(validateKind);
    const previousCredentials = { ...this.state.credentials };
    const changed = uniqueKinds.some((kind) => this.state.credentials[kind]);
    if (!changed) {
      return;
    }

    uniqueKinds.forEach((kind) => delete this.state.credentials[kind]);
    try {
      this.writeState();
    } catch (error) {
      this.state.credentials = previousCredentials;
      throw error;
    }
  }

  ensureEncryptionAvailable() {
    if (!isSecureStorageAvailable(this.encryption)) {
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
      if (typeof secret !== "string" || secret.length === 0) {
        throw new Error("Stored security credentials are unavailable.");
      }
      return secret;
    } catch {
      throw new Error("Stored security credentials are unavailable.");
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
