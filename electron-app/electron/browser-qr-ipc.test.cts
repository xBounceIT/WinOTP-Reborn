const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { test } = require("node:test");
const { createBrowserBridgeBackend } = require("./browser-bridge-backend.cjs");
const { createBrowserBridgeService, encodeFrame } = require("./browser-bridge.cjs");
const { createBrowserQrImport } = require("./browser-qr-import.cjs");
const { AccountStore, sanitizeAccount } = require("./account-store.cjs");
const { saveAccountBatch } = require("./account-batch-save.cjs");

function send(descriptor, request, token = descriptor.authToken) {
  return new Promise<any>((resolve, reject) => {
    const socket = net.createConnection(descriptor.endpoint.name ?? descriptor.endpoint.path);
    const chunks = [];
    socket.on("error", reject);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const frame = Buffer.concat(chunks);
      resolve(frame.length ? JSON.parse(frame.subarray(4).toString("utf8")) : undefined);
    });
    socket.on("connect", () =>
      socket.write(
        encodeFrame({
          version: 1,
          requestId: request.requestId,
          auth: { scheme: "ephemeral-token", token },
          request,
        }),
      ),
    );
  });
}

test("authenticated local QR handoff uses Rust parsing and the existing account persistence on the host platform", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-qr-ipc-"));
  const backend = createBrowserBridgeBackend();
  let unlocked = true;
  let activations = 0;
  let backups = 0;
  let parseGate;
  const states = [];
  const createStore = () =>
    new AccountStore(
      { getPath: () => directory },
      {
        directoryPath: directory,
        legacyCredentialReader: () => ({ ok: true, entries: [] }),
        // Persistence is real SQLite; OS encryption is covered separately by native tests.
        encryption: {
          isEncryptionAvailable: () => true,
          encryptString: (text) => Buffer.from(text),
          decryptString: (bytes) => bytes.toString("utf8"),
        },
      },
    );
  let store = createStore();
  const manager = createBrowserQrImport({
    isUnlocked: () => unlocked,
    parseQr: (text) => (parseGate ? parseGate() : backend.parseQr(text)),
    activate: () => {
      activations++;
    },
    onChanged: (state) => states.push(state),
    saveAccounts: (accounts) =>
      saveAccountBatch(accounts, {
        saveAccount: (account) => {
          const result = store.saveNormalizedImportAccount(account);
          return { ...result, account: sanitizeAccount(result.account) };
        },
        createAutomaticBackup: () => {
          backups++;
          return { skipped: true };
        },
      }),
  });
  const service = createBrowserBridgeService({
    runtimeDirectory: directory,
    temporaryDirectory: directory,
    backend,
    registration: { install: () => ({}), uninstall: () => undefined },
    callbacks: {
      isUnlocked: () => unlocked,
      importQr: manager.enqueue,
      onDisabled: manager.clear,
      onError: () => assert.fail("QR operations must not log errors containing payloads"),
    },
  });
  const qr = {
    version: 1,
    requestId: "qr-local",
    method: "importQr",
    params: { text: "OtPaUtH://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example" },
  };
  try {
    await service.configure(true);
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(directory, "browser-bridge.json"), "utf8"),
    );
    assert.equal(await send(descriptor, qr, "x".repeat(43)), undefined);
    assert.equal(activations, 0);
    unlocked = false;
    assert.equal((await send(descriptor, qr)).error.code, "APP_LOCKED");
    assert.equal(activations, 0);
    unlocked = true;
    for (const params of [
      { text: "otpauth://totp/a?secret=bad!" },
      { text: "otpauth-migration://offline?data=test" },
      { text: `otpauth://${"é".repeat(4092)}` },
      { text: "otpauth://bad\n" },
      { ...qr.params, extra: true },
    ]) {
      const invalid = await send(descriptor, {
        ...qr,
        requestId: `invalid-${activations}-${params.text.length}`,
        params,
      });
      assert.equal(invalid.error.code, "INVALID_REQUEST");
      assert.equal(JSON.stringify(invalid).includes("secret="), false);
    }
    assert.equal((await send(descriptor, { ...qr, extra: true })).error.code, "INVALID_REQUEST");
    const started = performance.now();
    const responses = await Promise.all([
      send(descriptor, qr),
      send(descriptor, qr),
      send(descriptor, { ...qr, requestId: "retry" }),
      send(descriptor, {
        ...qr,
        requestId: "equivalent",
        params: { text: "OTPAUTH://totp/Example:alice?issuer=Example&secret=JBSWY3DPEHPK3PXP" },
      }),
    ]);
    assert.ok(performance.now() - started < 5_000);
    for (const response of responses) assert.deepEqual(response.result, { accepted: true });
    assert.equal(activations, 1);
    assert.equal(store.readAccounts().accounts.length, 0);
    assert.equal(backups, 0);
    const id = manager.snapshot().review.id;
    await manager.confirm(id);
    await manager.confirm(id);
    await send(descriptor, qr);
    await send(descriptor, { ...qr, requestId: "after-save" });
    assert.equal(store.readAccounts().accounts.length, 1);
    const parsedWhileDisabling = await backend.parseQr(
      "otpauth://totp/Other?secret=MFRGGZDFMZTWQ2LK",
    );
    let finishParsing;
    let parsingStarted;
    const startedParsing = new Promise<void>((resolve) => {
      parsingStarted = resolve;
    });
    parseGate = () => {
      parsingStarted();
      return new Promise((resolve) => {
        finishParsing = resolve;
      });
    };
    const inFlight = send(descriptor, {
      ...qr,
      requestId: "disabled-in-flight",
      params: { text: "otpauth://totp/Other?secret=MFRGGZDFMZTWQ2LK" },
    });
    await startedParsing;
    await service.configure(false);
    finishParsing(parsedWhileDisabling);
    await inFlight;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manager.snapshot().review, undefined);
    assert.equal(activations, 1);
    assert.equal(backups, 1);
    assert.equal(JSON.stringify([responses, states]).includes("JBSWY3DPEHPK3PXP"), false);
    assert.equal(JSON.stringify(states).includes("otpauth"), false);
    // Replay history is volatile; persistence must still reject duplicate accounts.
    const savedAccount = store.readAccounts().accounts[0];
    store.close();
    store = createStore();
    const parsed = await backend.parseQr(qr.params.text);
    const afterRestart = store.saveNormalizedImportAccount(parsed.account);
    assert.equal(afterRestart.alreadyExists, true);
    assert.deepEqual(store.readAccounts().accounts, [savedAccount]);
  } finally {
    manager.clear();
    service.dispose();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
