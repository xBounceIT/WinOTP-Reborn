const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const {
  browserBridgeRuntimeDirectory,
  createBrowserBridgeService,
  createRateLimiter,
  dispatchBrowserBridgeRequest,
  encodeFrame,
  parseAuthenticatedRequest,
  projectBrowserAccounts,
} = require("./browser-bridge.cjs");
const { resolveBrowserBridgeBinary } = require("./browser-bridge-registration.cjs");

const AUTH_TOKEN = "a".repeat(43);

function authenticatedRequest(request, token = AUTH_TOKEN) {
  return {
    version: 1,
    requestId: request.requestId,
    auth: { scheme: "ephemeral-token", token },
    request,
  };
}

function parse(value, token = AUTH_TOKEN) {
  return parseAuthenticatedRequest(Buffer.from(JSON.stringify(value)), token);
}

function createCallbacks(overrides: any = {}) {
  return {
    getAppVersion: () => "2.1.0",
    isUnlocked: () => true,
    listAccounts: () => [],
    getAccount: () => undefined,
    generateTotp: () => ({ code: "123456", expiresIn: 18, period: 30 }),
    onError: () => undefined,
    ...overrides,
  };
}

test("authenticates the closed desktop request envelope before dispatch", () => {
  const request = { version: 1, requestId: "request-1", method: "getStatus" };
  assert.deepEqual(parse(authenticatedRequest(request)), {
    ok: true,
    requestId: "request-1",
    method: "getStatus",
  });
  assert.throws(
    () => parse(authenticatedRequest(request, "b".repeat(43))),
    /UnauthorizedBrowserBridgeRequest/,
  );
  assert.deepEqual(parse({ ...authenticatedRequest(request), extra: true }), {
    ok: false,
    requestId: "request-1",
  });
  assert.deepEqual(parse(authenticatedRequest({ ...request, version: 2 })), {
    ok: false,
    requestId: "request-1",
    errorCode: "UNSUPPORTED_PROTOCOL",
  });
  assert.deepEqual(
    parse(
      authenticatedRequest({
        version: 1,
        requestId: "request-2",
        method: "getTotp",
        params: { accountId: "account-1", secret: "never" },
      }),
    ),
    { ok: false, requestId: "request-2" },
  );
});

test("projects only account id, issuer, and a non-empty name", () => {
  assert.deepEqual(
    projectBrowserAccounts([
      {
        id: "account-1",
        issuer: "Example",
        accountName: "user@example.test",
        secret: "NEVER",
        createdAt: "2026-01-01T00:00:00Z",
      },
      { id: "bad id", issuer: "Skipped", accountName: "Unsafe" },
      { id: "account-2", issuer: "Issuer only", accountName: "" },
    ]),
    [
      { id: "account-1", issuer: "Example", name: "user@example.test" },
      { id: "account-2", issuer: "Issuer only", name: "Issuer only" },
    ],
  );
});

test("re-checks the live lock state for protected browser methods", async () => {
  let unlocked = false;
  const callbacks = createCallbacks({
    isUnlocked: () => unlocked,
    listAccounts: () => [{ id: "account-1", issuer: "Example", accountName: "User" }],
    getAccount: () => ({ id: "account-1", period: 30 }),
  });
  const limiter = createRateLimiter();
  const status = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "status-1", method: "getStatus" },
    callbacks,
    limiter,
  );
  assert.deepEqual(status.result, { state: "locked", appVersion: "2.1.0" });

  const lockedList = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "list-1", method: "listAccounts" },
    callbacks,
    limiter,
  );
  assert.equal(lockedList.error.code, "APP_LOCKED");

  unlocked = true;
  callbacks.listAccounts = async () => {
    unlocked = false;
    return [{ id: "account-1", issuer: "Example", accountName: "User" }];
  };
  const relockedList = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "list-2", method: "listAccounts" },
    callbacks,
    limiter,
  );
  assert.equal(relockedList.error.code, "APP_LOCKED");
  assert.equal("result" in relockedList, false);
});

test("returns a selected current TOTP without exposing the account", async () => {
  const response = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "totp-1", method: "getTotp", accountId: "account-1" },
    createCallbacks({ getAccount: () => ({ id: "account-1", secret: "NEVER", period: 30 }) }),
    createRateLimiter(),
  );
  assert.deepEqual(response.result, { code: "123456", expiresIn: 18, period: 30 });
  assert.equal(JSON.stringify(response).includes("NEVER"), false);

  const missing = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "totp-2", method: "getTotp", accountId: "missing" },
    createCallbacks(),
    createRateLimiter(),
  );
  assert.equal(missing.error.code, "ACCOUNT_NOT_FOUND");
  assert.equal("result" in missing, false);

  let unlocked = true;
  const relocked = await dispatchBrowserBridgeRequest(
    { ok: true, requestId: "totp-3", method: "getTotp", accountId: "account-1" },
    createCallbacks({
      isUnlocked: () => unlocked,
      getAccount: () => ({ id: "account-1", secret: "NEVER", period: 30 }),
      generateTotp: async () => {
        unlocked = false;
        return { code: "123456", expiresIn: 18, period: 30 };
      },
    }),
    createRateLimiter(),
  );
  assert.equal(relocked.error.code, "APP_LOCKED");
  assert.equal("result" in relocked, false);
});

test("rate-limits abusive same-user requests", () => {
  let current = 1_000;
  const limiter = createRateLimiter({ now: () => current, windowMs: 1_000, maximumRequests: 2 });
  assert.equal(limiter.accept(), true);
  assert.equal(limiter.accept(), true);
  assert.equal(limiter.accept(), false);
  current += 1_001;
  assert.equal(limiter.accept(), true);
});

test("uses the Desktop trusted contract descriptor locations", () => {
  assert.equal(
    browserBridgeRuntimeDirectory(undefined, {
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    }),
    path.join("C:\\Users\\tester\\AppData\\Local", "WinOTP_Reborn", "runtime"),
  );
  assert.equal(
    browserBridgeRuntimeDirectory(undefined, {
      platform: "darwin",
      environment: { HOME: "/Users/tester" },
    }),
    path.join("/Users/tester", "Library/Application Support", "WinOTP_Reborn", "runtime"),
  );
  assert.equal(
    browserBridgeRuntimeDirectory(undefined, {
      platform: "linux",
      environment: { XDG_RUNTIME_DIR: "/run/user/1000", HOME: "/home/tester" },
    }),
    path.join("/run/user/1000", "winotp-reborn"),
  );
});

function readFrame(socket) {
  return new Promise<any>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }
      const length = buffer.readUInt32LE(0);
      if (buffer.length >= length + 4) {
        resolve(JSON.parse(buffer.subarray(4, length + 4).toString("utf8")));
      }
    });
    socket.on("error", reject);
    socket.on("end", () => {
      if (buffer.length < 4) {
        reject(new Error("The browser bridge returned no frame."));
      }
    });
  });
}

async function sendRequest(descriptor, request) {
  const endpointPath = descriptor.endpoint.name ?? descriptor.endpoint.path;
  const socket = net.createConnection(endpointPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const response = readFrame(socket);
  socket.end(encodeFrame(authenticatedRequest(request, descriptor.authToken)));
  return response;
}

test("publishes, rotates, and removes one authenticated local endpoint", async () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-bridge-"));
  const registrationCalls = [];
  let unlocked = true;
  const service = createBrowserBridgeService({
    app: { getVersion: () => "2.1.0" },
    runtimeDirectory: directoryPath,
    temporaryDirectory: directoryPath,
    registration: {
      install: () => {
        registrationCalls.push("install");
        return { chromeConfigured: true };
      },
      uninstall: () => registrationCalls.push("uninstall"),
    },
    spawnProcess: () => ({ status: 0 }),
    callbacks: createCallbacks({ isUnlocked: () => unlocked }),
    descriptorRefreshMs: 60_000,
  });
  const descriptorPath = path.join(directoryPath, "browser-bridge.json");
  try {
    assert.equal(fs.existsSync(descriptorPath), false);
    await service.configure(true);
    const first = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    assert.equal(first.version, 1);
    assert.ok(first.authToken.length >= 43);
    assert.ok(first.expiresAt > Math.floor(Date.now() / 1000));
    assert.equal(service.getStatus().ready, true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(descriptorPath).mode & 0o077, 0);
      assert.equal(fs.statSync(first.endpoint.path).mode & 0o077, 0);
    }

    await service.configure(true);
    const idempotent = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    assert.equal(idempotent.authToken, first.authToken);
    assert.deepEqual(idempotent.endpoint, first.endpoint);

    const status = await sendRequest(first, {
      version: 1,
      requestId: "status-1",
      method: "getStatus",
    });
    assert.deepEqual(status.result, { state: "unlocked", appVersion: "2.1.0" });

    unlocked = false;
    const locked = await sendRequest(first, {
      version: 1,
      requestId: "list-1",
      method: "listAccounts",
    });
    assert.equal(locked.error.code, "APP_LOCKED");

    await service.rotate();
    const second = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    assert.notEqual(second.authToken, first.authToken);
    assert.notDeepEqual(second.endpoint, first.endpoint);

    await service.configure(false);
    assert.equal(fs.existsSync(descriptorPath), false);
    assert.deepEqual(registrationCalls, ["install", "install", "uninstall"]);
  } finally {
    service.dispose();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("drops authenticated in-flight requests when the endpoint token rotates", async () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-inflight-"));
  let signalGenerationStarted;
  let finishGeneration;
  const generationStarted = new Promise<void>((resolve) => {
    signalGenerationStarted = resolve;
  });
  const generationResult = new Promise((resolve) => {
    finishGeneration = resolve;
  });
  const service = createBrowserBridgeService({
    runtimeDirectory: directoryPath,
    temporaryDirectory: directoryPath,
    registration: {
      install: () => ({ chromeConfigured: false }),
      uninstall: () => undefined,
    },
    spawnProcess: () => ({ status: 0 }),
    callbacks: createCallbacks({
      getAccount: () => ({ id: "account-1", secret: "NEVER", period: 30 }),
      generateTotp: () => {
        signalGenerationStarted();
        return generationResult;
      },
    }),
  });
  try {
    await service.configure(true);
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(directoryPath, "browser-bridge.json"), "utf8"),
    );
    const response = sendRequest(descriptor, {
      version: 1,
      requestId: "totp-inflight",
      method: "getTotp",
      params: { accountId: "account-1" },
    });
    await generationStarted;

    await service.rotate();
    finishGeneration({ code: "123456", expiresIn: 18, period: 30 });

    let timeout;
    const outcome = await Promise.race([
      response.then(
        () => "response",
        () => "disconnected",
      ),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 1_000);
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(outcome, "disconnected");
  } finally {
    service.dispose();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("enforces an absolute connection deadline against slow unauthenticated clients", async () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-slow-client-"));
  const service = createBrowserBridgeService({
    runtimeDirectory: directoryPath,
    temporaryDirectory: directoryPath,
    connectionTimeoutMs: 50,
    registration: {
      install: () => ({ chromeConfigured: false }),
      uninstall: () => undefined,
    },
    spawnProcess: () => ({ status: 0 }),
    callbacks: createCallbacks(),
  });
  let dripTimer;
  try {
    await service.configure(true);
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(directoryPath, "browser-bridge.json"), "utf8"),
    );
    const endpointPath = descriptor.endpoint.name ?? descriptor.endpoint.path;
    const socket = net.createConnection(endpointPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(Buffer.from([1]));
    let bytesSent = 1;
    dripTimer = setInterval(() => {
      if (bytesSent < 3 && !socket.destroyed) {
        socket.write(Buffer.from([1]));
        bytesSent += 1;
      }
    }, 20);

    const outcome = await Promise.race([
      new Promise((resolve) => socket.once("close", () => resolve("closed"))),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 75)),
    ]);
    assert.equal(outcome, "closed");
  } finally {
    clearInterval(dripTimer);
    service.dispose();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("does not republish a descriptor when shutdown races endpoint creation", async () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-shutdown-"));
  let server: any;
  const netModule = {
    createServer: () => {
      server = new EventEmitter();
      server.listen = () => undefined;
      server.close = () => {
        server.closed = true;
      };
      return server;
    },
  };
  const service = createBrowserBridgeService({
    platform: "win32",
    runtimeDirectory: directoryPath,
    netModule,
    registration: {
      install: () => ({ chromeConfigured: false }),
      uninstall: () => undefined,
    },
    spawnProcess: () => ({ status: 0 }),
    callbacks: createCallbacks(),
  });
  try {
    const starting = service.configure(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(server);

    service.dispose();
    server.emit("listening");

    await assert.rejects(starting, /cancelled/);
    assert.equal(server.closed, true);
    assert.equal(fs.existsSync(path.join(directoryPath, "browser-bridge.json")), false);
  } finally {
    service.dispose();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("removes a stale descriptor when the active endpoint closes unexpectedly", async () => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-closed-"));
  let server: any;
  const netModule = {
    createServer: () => {
      server = new EventEmitter();
      server.listen = () => setImmediate(() => server.emit("listening"));
      server.close = () => undefined;
      return server;
    },
  };
  const service = createBrowserBridgeService({
    platform: "win32",
    runtimeDirectory: directoryPath,
    netModule,
    registration: {
      install: () => ({ chromeConfigured: false }),
      uninstall: () => undefined,
    },
    spawnProcess: () => ({ status: 0 }),
    callbacks: createCallbacks(),
  });
  const descriptorPath = path.join(directoryPath, "browser-bridge.json");
  try {
    await service.configure(true);
    assert.equal(fs.existsSync(descriptorPath), true);

    server.emit("close");

    assert.equal(fs.existsSync(descriptorPath), false);
    assert.equal(service.getStatus().ready, false);
  } finally {
    service.dispose();
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("cleans partial Native Messaging registration when opt-in fails", async () => {
  let uninstallCalls = 0;
  const service = createBrowserBridgeService({
    platform: "win32",
    runtimeDirectory: path.join(os.tmpdir(), "winotp-browser-registration-failure"),
    registration: {
      install: () => {
        throw new Error("registration failed");
      },
      uninstall: () => {
        uninstallCalls += 1;
      },
    },
    callbacks: createCallbacks(),
  });
  try {
    await assert.rejects(service.configure(true), /registration failed/);
    assert.equal(uninstallCalls, 1);
    assert.equal(service.getStatus().enabled, false);
  } finally {
    service.dispose();
  }
});

function runNativeHostRequest(executablePath, environment, request) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(executablePath, [], {
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = Buffer.alloc(0);
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
    });
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0 || output.length < 4) {
        reject(new Error(errors || `Native host exited with ${code}.`));
        return;
      }
      const length = output.readUInt32LE(0);
      resolve(JSON.parse(output.subarray(4, length + 4).toString("utf8")));
    });
    child.stdin.end(encodeFrame(request));
  });
}

test("the pinned Native Messaging host answers ping without desktop access", async () => {
  const executablePath = resolveBrowserBridgeBinary();
  assert.ok(executablePath, "The pretest build must provide the Native Messaging host.");
  const response = await runNativeHostRequest(
    executablePath,
    {},
    {
      version: 1,
      requestId: "ping-interop",
      method: "ping",
    },
  );
  assert.deepEqual(response, {
    version: 1,
    requestId: "ping-interop",
    ok: true,
    result: { protocolVersion: 1, bridgeVersion: "0.1.0" },
  });
});

test(
  "interoperates with the pinned WebBridge Native Messaging host",
  { skip: process.platform !== "linux" },
  async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-native-host-"));
    const environment =
      process.platform === "win32"
        ? { ...process.env, LOCALAPPDATA: dataRoot }
        : { ...process.env, XDG_RUNTIME_DIR: dataRoot };
    const executablePath = resolveBrowserBridgeBinary();
    assert.ok(executablePath, "The pretest build must provide the Native Messaging host.");
    const service = createBrowserBridgeService({
      app: { getVersion: () => "2.1.0" },
      environment,
      registration: {
        install: () => ({ chromeConfigured: false }),
        uninstall: () => undefined,
      },
      callbacks: createCallbacks(),
      descriptorRefreshMs: 60_000,
    });
    try {
      await service.configure(true);
      const response = await runNativeHostRequest(executablePath, environment, {
        version: 1,
        requestId: "status-interop",
        method: "getStatus",
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.deepEqual(response.result, { state: "unlocked", appVersion: "2.1.0" });
    } finally {
      service.dispose();
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  },
);

test(
  "applies a current-user ACL to the Windows descriptor and runtime directory",
  { skip: process.platform !== "win32" },
  async () => {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-acl-"));
    const service = createBrowserBridgeService({
      app: { getVersion: () => "2.1.0" },
      runtimeDirectory: directoryPath,
      registration: {
        install: () => ({ chromeConfigured: false }),
        uninstall: () => undefined,
      },
      callbacks: createCallbacks(),
      descriptorRefreshMs: 60_000,
    });
    try {
      await service.configure(true);
      const descriptorPath = path.join(directoryPath, "browser-bridge.json");
      assert.equal(fs.statSync(descriptorPath).isFile(), true);
      const aclScript = `
$ErrorActionPreference = "Stop"
$target = $env:WINOTP_TEST_ACL_TARGET
$acl = if ([System.IO.File]::Exists($target)) {
  [System.IO.File]::GetAccessControl($target)
} else {
  [System.IO.Directory]::GetAccessControl($target)
}
[pscustomobject]@{
  protected = $acl.AreAccessRulesProtected
  identities = @(
    $acl.GetAccessRules($true, $true, [System.Security.Principal.NTAccount]) |
      ForEach-Object { $_.IdentityReference.Value }
  )
} | ConvertTo-Json -Compress
`.trim();
      for (const targetPath of [directoryPath, descriptorPath]) {
        const result = spawnSync(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", aclScript],
          {
            encoding: "utf8",
            windowsHide: true,
            env: { ...process.env, WINOTP_TEST_ACL_TARGET: targetPath },
          },
        );
        assert.equal(result.status, 0, result.stderr);
        const acl = JSON.parse(result.stdout.trim());
        assert.equal(acl.protected, true);
        const identities = Array.isArray(acl.identities) ? acl.identities : [acl.identities];
        assert.deepEqual(
          identities.map((identity) => identity.toLowerCase()),
          [`${process.env.USERDOMAIN}\\${process.env.USERNAME}`.toLowerCase()],
        );
      }
    } finally {
      service.dispose();
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  },
);
