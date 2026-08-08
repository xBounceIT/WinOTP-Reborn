const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { SecurityStore } = require("./security-store.cjs");

function createStore(encryption) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-security-"));
  const filePath = path.join(directory, "security.json");
  const store = new SecurityStore(undefined, { encryption, filePath });
  return {
    store,
    filePath,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function createEncryption() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      assert.ok(text.startsWith("encrypted:"));
      return text.slice("encrypted:".length);
    },
  };
}

test("stores credentials encrypted and verifies them after reopening", () => {
  const encryption = createEncryption();
  const first = createStore(encryption);

  try {
    first.store.setCredential("pin", "1234");
    first.store.setCredential("password", "correct horse");

    assert.deepEqual(first.store.getStatus(), {
      pinSet: true,
      passwordSet: true,
      remotePinSet: false,
      remotePasswordSet: false,
    });
    assert.deepEqual(first.store.verifyCredential("pin", "1234"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.deepEqual(first.store.verifyCredential("pin", "4321"), {
      verified: false,
      credentialAvailable: true,
    });
    assert.deepEqual(first.store.verifyCredential("password", "correct horse"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.equal(fs.readFileSync(first.filePath, "utf8").includes("1234"), false);
    assert.equal(fs.readFileSync(first.filePath, "utf8").includes("correct horse"), false);

    const reopened = new SecurityStore(undefined, {
      encryption,
      filePath: first.filePath,
    });
    assert.deepEqual(reopened.verifyCredential("pin", "1234"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.deepEqual(reopened.verifyCredential("password", "wrong"), {
      verified: false,
      credentialAvailable: true,
    });
  } finally {
    first.cleanup();
  }
});

test("removes inactive credentials in one persisted update", () => {
  const handle = createStore(createEncryption());

  try {
    handle.store.setCredential("pin", "1234");
    handle.store.setCredential("password", "correct horse");
    handle.store.setCredential("remotePin", "5678");
    handle.store.setCredential("remotePassword", "remote horse");
    handle.store.removeCredentials(["pin", "remotePassword"]);

    assert.deepEqual(handle.store.getStatus(), {
      pinSet: false,
      passwordSet: true,
      remotePinSet: true,
      remotePasswordSet: false,
    });
  } finally {
    handle.cleanup();
  }
});

test("imports native app-lock credentials without replacing existing Electron credentials", () => {
  const handle = createStore(createEncryption());

  try {
    handle.store.setCredential("pin", "9999");
    const result = handle.store.importLegacyCredentials({
      pin: "1234",
      password: "correct horse",
      remotePin: "5678",
    });

    assert.deepEqual(result, {
      success: true,
      importedCount: 2,
      skippedCount: 1,
      issueCount: 0,
    });
    assert.deepEqual(handle.store.verifyCredential("pin", "9999"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.deepEqual(handle.store.verifyCredential("password", "correct horse"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.deepEqual(handle.store.verifyCredential("remotePin", "5678"), {
      verified: true,
      credentialAvailable: true,
    });
  } finally {
    handle.cleanup();
  }
});

test("preserves legacy credentials outside the current validation policy", () => {
  const handle = createStore(createEncryption());
  const legacyPin = "١٢٣٤";
  const legacyPassword = "x".repeat(129);

  try {
    assert.deepEqual(
      handle.store.importLegacyCredentials({ pin: legacyPin, password: legacyPassword }),
      {
        success: true,
        importedCount: 2,
        skippedCount: 0,
        issueCount: 0,
      },
    );
    assert.deepEqual(handle.store.getStatus(), {
      pinSet: true,
      passwordSet: true,
      remotePinSet: false,
      remotePasswordSet: false,
    });
    assert.deepEqual(handle.store.verifyCredential("pin", legacyPin), {
      verified: true,
      credentialAvailable: true,
    });
    assert.deepEqual(handle.store.verifyCredential("password", legacyPassword), {
      verified: true,
      credentialAvailable: true,
    });
  } finally {
    handle.cleanup();
  }
});

test("does not partially mutate security state when legacy encryption fails", () => {
  let encryptCalls = 0;
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      encryptCalls += 1;
      if (encryptCalls === 2) {
        throw new Error("simulated encryption failure");
      }
      return Buffer.from(`encrypted:${value}`, "utf8");
    },
    decryptString: (value) => value.toString("utf8").slice("encrypted:".length),
  };
  const handle = createStore(encryption);

  try {
    assert.throws(
      () => handle.store.importLegacyCredentials({ pin: "1234", password: "correct horse" }),
      /simulated encryption failure/,
    );
    assert.deepEqual(handle.store.getStatus(), {
      pinSet: false,
      passwordSet: false,
      remotePinSet: false,
      remotePasswordSet: false,
    });
    assert.equal(fs.existsSync(handle.filePath), false);
  } finally {
    handle.cleanup();
  }
});

test("rejects invalid credentials before enabling protection", () => {
  const handle = createStore(createEncryption());

  try {
    assert.throws(() => handle.store.setCredential("pin", "12"), /4-6 digits/);
    assert.throws(() => handle.store.setCredential("pin", "12ab"), /4-6 digits/);
    assert.throws(() => handle.store.setCredential("password", "abc"), /at least 4/);
    assert.throws(() => handle.store.setCredential("password", "x".repeat(129)), /at most 128/);
    assert.throws(() => handle.store.setCredential("password", "    "), /required/);
    assert.throws(() => handle.store.setCredential("unknown", "1234"), /Unsupported/);
    assert.deepEqual(handle.store.getStatus(), {
      pinSet: false,
      passwordSet: false,
      remotePinSet: false,
      remotePasswordSet: false,
    });
  } finally {
    handle.cleanup();
  }
});

test("treats an undecryptable credential as unavailable storage", () => {
  const encryption = createEncryption();
  const handle = createStore(encryption);

  try {
    fs.writeFileSync(
      handle.filePath,
      JSON.stringify({
        version: 1,
        credentials: { pin: Buffer.from("corrupt").toString("base64") },
      }),
    );

    const corruptedStore = new SecurityStore(undefined, {
      encryption,
      filePath: handle.filePath,
    });
    assert.throws(() => corruptedStore.getStatus(), /Stored security credentials are unavailable/);
    assert.throws(
      () => corruptedStore.verifyCredential("pin", "1234"),
      /Stored security credentials are unavailable/,
    );
  } finally {
    handle.cleanup();
  }
});

test("treats malformed stored security state as unavailable", () => {
  const handle = createStore(createEncryption());

  try {
    fs.writeFileSync(handle.filePath, "not-json", "utf8");
    assert.throws(
      () =>
        new SecurityStore(undefined, { encryption: createEncryption(), filePath: handle.filePath }),
      /Stored security credentials are unavailable/,
    );
  } finally {
    handle.cleanup();
  }
});

test("keeps the previous state when replacing the security file fails", () => {
  const handle = createStore(createEncryption());
  const originalRename = fs.renameSync;

  try {
    handle.store.setCredential("pin", "1234");
    const previousFile = fs.readFileSync(handle.filePath, "utf8");
    fs.renameSync = () => {
      throw new Error("simulated replacement failure");
    };

    assert.throws(() => handle.store.setCredential("pin", "5678"), /simulated replacement failure/);
    assert.equal(fs.readFileSync(handle.filePath, "utf8"), previousFile);
    assert.deepEqual(handle.store.verifyCredential("pin", "1234"), {
      verified: true,
      credentialAvailable: true,
    });
    assert.equal(
      fs.readdirSync(path.dirname(handle.filePath)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    fs.renameSync = originalRename;
    handle.cleanup();
  }
});

test("removes a credential and persists that it is no longer available", () => {
  const handle = createStore(createEncryption());

  try {
    handle.store.setCredential("password", "correct horse");
    handle.store.removeCredential("password");

    assert.deepEqual(handle.store.getStatus(), {
      pinSet: false,
      passwordSet: false,
      remotePinSet: false,
      remotePasswordSet: false,
    });
    assert.deepEqual(handle.store.verifyCredential("password", "correct horse"), {
      verified: false,
      credentialAvailable: false,
    });

    const reopened = new SecurityStore(undefined, {
      encryption: createEncryption(),
      filePath: handle.filePath,
    });
    assert.deepEqual(reopened.getStatus(), {
      pinSet: false,
      passwordSet: false,
      remotePinSet: false,
      remotePasswordSet: false,
    });
  } finally {
    handle.cleanup();
  }
});

test("does not write a credential when OS-backed encryption is unavailable", () => {
  const handle = createStore({ isEncryptionAvailable: () => false });

  try {
    assert.throws(() => handle.store.setCredential("pin", "1234"), /unavailable/);
    assert.throws(() => handle.store.verifyCredential("pin", null), /unavailable/);
    assert.equal(fs.existsSync(handle.filePath), false);
  } finally {
    handle.cleanup();
  }
});
