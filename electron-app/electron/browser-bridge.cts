const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const {
  BRIDGE_ACCOUNT_ID_PATTERN,
  createBrowserBridgeBackend,
} = require("./browser-bridge-backend.cjs");

const {
  createNativeMessagingRegistration,
  localDataRoot,
  restrictWindowsPath,
  writeJsonAtomically,
} = require("./browser-bridge-registration.cjs");

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 64 * 1024;
const CONNECTION_TIMEOUT_MS = 4_000;
const DESCRIPTOR_LIFETIME_SECONDS = 15 * 60;
const DESCRIPTOR_REFRESH_MS = 10 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_REQUESTS = 40;
const MAX_CONCURRENT_CONNECTIONS = 32;
const DESCRIPTOR_FILE_NAME = "browser-bridge.json";

const SAFE_ERROR_MESSAGES = {
  APP_LOCKED: "WinOTP is locked",
  ACCOUNT_NOT_FOUND: "Account not found",
  INVALID_REQUEST: "Invalid request",
  UNSUPPORTED_PROTOCOL: "Unsupported Native Messaging protocol version",
  INTERNAL_ERROR: "WinOTP could not complete the request",
};

function successResponse(requestId, result) {
  return { version: PROTOCOL_VERSION, requestId, ok: true, result };
}

function errorResponse(requestId, code) {
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code, message: SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.INTERNAL_ERROR },
  };
}

function truncateUtf8(value, maximumBytes) {
  const source = String(value ?? "");
  if (Buffer.byteLength(source, "utf8") <= maximumBytes) {
    return source;
  }
  let result = "";
  for (const character of source) {
    if (Buffer.byteLength(result + character, "utf8") > maximumBytes) {
      break;
    }
    result += character;
  }
  return result;
}

function projectBrowserAccounts(accounts) {
  const result = [];
  const seen = new Set();
  for (const account of Array.isArray(accounts) ? accounts.slice(0, 10_000) : []) {
    const id = String(account?.id ?? "").trim();
    if (!BRIDGE_ACCOUNT_ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }
    const issuer = truncateUtf8(String(account?.issuer ?? "").trim(), 256);
    const name = truncateUtf8(
      String(account?.accountName ?? "").trim() || issuer || "Account",
      256,
    );
    if (!name) {
      continue;
    }
    seen.add(id);
    result.push({ id, issuer, name });
  }
  return result;
}

function createRateLimiter(options: any = {}) {
  const now = options.now ?? (() => performance.now());
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const maximumRequests = options.maximumRequests ?? RATE_LIMIT_REQUESTS;
  let requests = [];
  return {
    accept() {
      const current = now();
      requests = requests.filter((timestamp) => current - timestamp < windowMs);
      if (requests.length >= maximumRequests) {
        return false;
      }
      requests.push(current);
      return true;
    },
  };
}

async function dispatchBrowserBridgeRequest(request, callbacks, rateLimiter, options: any = {}) {
  if (!request.ok) {
    return errorResponse(request.requestId, request.errorCode ?? "INVALID_REQUEST");
  }
  if (options.rateLimitAccepted !== true && !rateLimiter.accept()) {
    return errorResponse(request.requestId, "INTERNAL_ERROR");
  }

  if (request.method === "getStatus") {
    const appVersion = truncateUtf8(callbacks.getAppVersion(), 64) || "0.0.0";
    return successResponse(request.requestId, {
      state: callbacks.isUnlocked() ? "unlocked" : "locked",
      appVersion,
    });
  }

  if (!callbacks.isUnlocked()) {
    return errorResponse(request.requestId, "APP_LOCKED");
  }

  if (request.method === "listAccounts") {
    try {
      const accounts = await callbacks.listAccounts();
      if (!callbacks.isUnlocked()) {
        return errorResponse(request.requestId, "APP_LOCKED");
      }
      return successResponse(request.requestId, { accounts: projectBrowserAccounts(accounts) });
    } catch (error) {
      callbacks.onError?.(error);
      return errorResponse(request.requestId, "INTERNAL_ERROR");
    }
  }

  if (request.method === "getTotp") {
    try {
      const account = await callbacks.getAccount(request.accountId);
      if (!callbacks.isUnlocked()) {
        return errorResponse(request.requestId, "APP_LOCKED");
      }
      if (!account) {
        return errorResponse(request.requestId, "ACCOUNT_NOT_FOUND");
      }
      const result = await callbacks.generateTotp(account);
      if (!callbacks.isUnlocked()) {
        return errorResponse(request.requestId, "APP_LOCKED");
      }
      const code = String(result?.code ?? "");
      const expiresIn = Number(result?.expiresIn);
      const period = Number(result?.period);
      if (
        !/^\d{4,10}$/.test(code) ||
        !Number.isInteger(expiresIn) ||
        !Number.isInteger(period) ||
        expiresIn < 1 ||
        period < 1 ||
        period > 300 ||
        expiresIn > period
      ) {
        throw new Error("The Rust core returned invalid browser TOTP data.");
      }
      return successResponse(request.requestId, { code, expiresIn, period });
    } catch (error) {
      callbacks.onError?.(error);
      return errorResponse(request.requestId, "INTERNAL_ERROR");
    }
  }

  return errorResponse(request.requestId, "INVALID_REQUEST");
}

function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new Error("The browser bridge response is too large.");
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function handleSocket(socket, authToken, callbacks, rateLimiter, backend, options: any = {}) {
  let buffer = Buffer.alloc(0);
  let expectedLength;
  let handled = false;
  const connectionTimer = setTimeout(
    () => socket.destroy(),
    options.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS,
  );
  connectionTimer.unref?.();
  socket.once("close", () => clearTimeout(connectionTimer));

  const fail = () => {
    handled = true;
    socket.destroy();
  };

  socket.on("data", (chunk) => {
    if (handled) {
      return;
    }
    if (buffer.length + chunk.length > MAX_MESSAGE_BYTES + 4) {
      fail();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    if (expectedLength === undefined && buffer.length >= 4) {
      expectedLength = buffer.readUInt32LE(0);
      if (expectedLength < 1 || expectedLength > MAX_MESSAGE_BYTES) {
        fail();
        return;
      }
    }
    if (expectedLength === undefined || buffer.length < expectedLength + 4) {
      return;
    }
    if (buffer.length !== expectedLength + 4) {
      fail();
      return;
    }

    handled = true;
    socket.pause();
    if (!rateLimiter.accept()) {
      socket.destroy();
      return;
    }
    void backend
      .authenticateRequest(buffer.subarray(4), authToken)
      .then((request) => {
        if (!request) {
          socket.destroy();
          return undefined;
        }
        return dispatchBrowserBridgeRequest(request, callbacks, rateLimiter, {
          rateLimitAccepted: true,
        });
      })
      .then((response) => {
        if (response) {
          socket.end(encodeFrame(response));
        }
      })
      .catch((error) => {
        callbacks.onError?.(error);
        socket.destroy();
      });
  });
  socket.on("end", () => {
    if (!handled) {
      socket.destroy();
    }
  });
  socket.on("error", () => undefined);
}

function browserBridgeRuntimeDirectory(app, options: any = {}) {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  if (platform === "linux") {
    const runtimeRoot = String(environment.XDG_RUNTIME_DIR ?? "").trim();
    if (runtimeRoot && path.isAbsolute(runtimeRoot)) {
      return path.join(runtimeRoot, "winotp-reborn");
    }
  }
  return path.join(localDataRoot(app, { environment, platform }), "WinOTP_Reborn", "runtime");
}

function ensureRuntimeDirectory(directoryPath, options: any = {}) {
  const platform = options.platform ?? process.platform;
  const fsModule = options.fsModule ?? fs;
  fsModule.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  if (platform === "win32") {
    restrictWindowsPath(directoryPath, { ...options, platform, directory: true });
  } else {
    const metadata = fsModule.lstatSync(directoryPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("The browser bridge runtime path is unsafe.");
    }
    fsModule.chmodSync(directoryPath, 0o700);
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new Error("The browser bridge runtime path belongs to another user.");
    }
  }
}

function unixEndpointDirectory(runtimeDirectory, options: any = {}) {
  const candidate = path.join(runtimeDirectory, `browser-${"f".repeat(32)}.sock`);
  if (Buffer.byteLength(candidate, "utf8") <= 90) {
    return runtimeDirectory;
  }
  const userId = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(options.temporaryDirectory ?? os.tmpdir(), `winotp-reborn-${userId}`);
}

function listen(server, endpointPath, platform) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      path: endpointPath,
      exclusive: true,
      ...(platform === "win32" ? { readableAll: false, writableAll: false } : {}),
    });
  });
}

function createBrowserBridgeService(options: any = {}) {
  const app = options.app;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const fsModule = options.fsModule ?? fs;
  const netModule = options.netModule ?? net;
  const backend = options.backend ?? createBrowserBridgeBackend(options.backendOptions);
  const runtimeDirectory =
    options.runtimeDirectory ?? browserBridgeRuntimeDirectory(app, { platform, environment });
  const descriptorPath =
    options.descriptorPath ?? path.join(runtimeDirectory, DESCRIPTOR_FILE_NAME);
  const registration =
    options.registration ??
    createNativeMessagingRegistration({
      app,
      platform,
      environment,
      dirname: options.dirname ?? __dirname,
    });
  const callbacks = options.callbacks;
  const rateLimiter = options.rateLimiter ?? createRateLimiter();
  let currentEndpoint;
  let enabled = false;
  let disposed = false;
  let lifecycleGeneration = 0;
  let runtimeDirectorySecured = false;
  let chromeConfigured = false;
  let refreshTimer;
  let queue = Promise.resolve();

  function enqueue(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function descriptorFor(endpoint, now = Date.now()) {
    return {
      version: PROTOCOL_VERSION,
      endpoint: endpoint.descriptor,
      authToken: endpoint.authToken,
      expiresAt: Math.floor(now / 1000) + DESCRIPTOR_LIFETIME_SECONDS,
    };
  }

  function publishDescriptor(endpoint) {
    writeJsonAtomically(descriptorPath, descriptorFor(endpoint), {
      fsModule,
      platform,
      environment,
      spawnProcess: options.spawnProcess,
    });
  }

  function safeRemove(filePath, kind) {
    try {
      const metadata = fsModule.lstatSync(filePath);
      if (kind === "socket" && (!metadata.isSocket() || metadata.isSymbolicLink())) {
        return;
      }
      if (kind === "file" && !metadata.isFile() && !metadata.isSymbolicLink()) {
        return;
      }
      fsModule.rmSync(filePath, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        callbacks.onError?.(error);
      }
    }
  }

  function closeEndpoint(endpoint) {
    if (!endpoint) {
      return;
    }
    for (const socket of endpoint.sockets ?? []) {
      socket.destroy();
    }
    endpoint.sockets?.clear();
    try {
      endpoint.server.close();
    } catch {
      // The endpoint may already be closed.
    }
    if (endpoint.socketPath) {
      safeRemove(endpoint.socketPath, "socket");
    }
  }

  async function createEndpoint() {
    if (!runtimeDirectorySecured) {
      ensureRuntimeDirectory(runtimeDirectory, {
        fsModule,
        platform,
        environment,
        spawnProcess: options.spawnProcess,
      });
      runtimeDirectorySecured = true;
    }
    const { authToken, endpointId } = await backend.createAuthenticationMaterial();
    let endpointPath;
    let descriptor;
    let socketPath;
    if (platform === "win32") {
      endpointPath = `\\\\.\\pipe\\winotp-reborn-browser-${endpointId}`;
      descriptor = { kind: "windowsNamedPipe", name: endpointPath };
    } else {
      const endpointDirectory = unixEndpointDirectory(runtimeDirectory, {
        temporaryDirectory: options.temporaryDirectory,
      });
      ensureRuntimeDirectory(endpointDirectory, { fsModule, platform, environment });
      endpointPath = path.join(endpointDirectory, `browser-${endpointId}.sock`);
      socketPath = endpointPath;
      descriptor = { kind: "unix", path: endpointPath };
    }

    const sockets = new Set();
    const endpoint: any = { server: undefined, descriptor, authToken, socketPath, sockets };
    const server = netModule.createServer((socket) => {
      if (sockets.size >= MAX_CONCURRENT_CONNECTIONS) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once("close", () => {
        sockets.delete(socket);
      });
      handleSocket(socket, authToken, callbacks, rateLimiter, backend, {
        connectionTimeoutMs: options.connectionTimeoutMs,
      });
    });
    endpoint.server = server;
    server.on("error", (error) => callbacks.onError?.(error));
    server.on("close", () => {
      if (!disposed && enabled && currentEndpoint === endpoint) {
        currentEndpoint = undefined;
        safeRemove(descriptorPath, "file");
        for (const socket of endpoint.sockets) {
          socket.destroy();
        }
        endpoint.sockets.clear();
        if (endpoint.socketPath) {
          safeRemove(endpoint.socketPath, "socket");
        }
      }
    });
    try {
      await listen(server, endpointPath, platform);
      if (platform !== "win32") {
        fsModule.chmodSync(endpointPath, 0o600);
        const metadata = fsModule.lstatSync(endpointPath);
        if (
          !metadata.isSocket() ||
          metadata.isSymbolicLink() ||
          (typeof process.getuid === "function" && metadata.uid !== process.getuid())
        ) {
          throw new Error("The browser bridge socket permissions are unsafe.");
        }
      }
      return endpoint;
    } catch (error) {
      closeEndpoint({ server, socketPath });
      throw error;
    }
  }

  async function rotateEndpoint() {
    const generation = lifecycleGeneration;
    const nextEndpoint = await createEndpoint();
    if (disposed || generation !== lifecycleGeneration) {
      closeEndpoint(nextEndpoint);
      return false;
    }
    try {
      publishDescriptor(nextEndpoint);
    } catch (error) {
      closeEndpoint(nextEndpoint);
      throw error;
    }
    const previousEndpoint = currentEndpoint;
    currentEndpoint = nextEndpoint;
    closeEndpoint(previousEndpoint);
    return true;
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(() => {
      void enqueue(async () => {
        if (enabled && currentEndpoint) {
          publishDescriptor(currentEndpoint);
        }
      }).catch((error) => callbacks.onError?.(error));
    }, options.descriptorRefreshMs ?? DESCRIPTOR_REFRESH_MS);
    refreshTimer.unref?.();
  }

  async function configure(nextEnabled) {
    return enqueue(async () => {
      if (disposed) {
        throw new Error("The browser bridge service has already been disposed.");
      }
      if (nextEnabled === true) {
        let registrationResult;
        try {
          registrationResult = registration.install();
        } catch (error) {
          if (!enabled) {
            try {
              registration.uninstall();
            } catch {
              // Keep the original registration failure as the actionable error.
            }
          }
          throw error;
        }
        chromeConfigured = registrationResult?.chromeConfigured === true;
        if (!enabled || !currentEndpoint) {
          try {
            if (!(await rotateEndpoint())) {
              throw new Error("The browser bridge endpoint start was cancelled.");
            }
          } catch (error) {
            if (!enabled) {
              try {
                registration.uninstall();
              } catch {
                // Keep the original endpoint failure as the actionable error.
              }
            }
            throw error;
          }
        }
        enabled = true;
        scheduleRefresh();
        return getStatus();
      }

      enabled = false;
      lifecycleGeneration += 1;
      chromeConfigured = false;
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
      safeRemove(descriptorPath, "file");
      const endpoint = currentEndpoint;
      currentEndpoint = undefined;
      closeEndpoint(endpoint);
      try {
        registration.uninstall();
      } catch (error) {
        callbacks.onError?.(error);
      }
      return getStatus();
    });
  }

  async function rotate() {
    return enqueue(async () => {
      if (enabled) {
        await rotateEndpoint();
      }
    });
  }

  function dispose() {
    disposed = true;
    enabled = false;
    lifecycleGeneration += 1;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    safeRemove(descriptorPath, "file");
    const endpoint = currentEndpoint;
    currentEndpoint = undefined;
    closeEndpoint(endpoint);
  }

  function getStatus() {
    return {
      enabled,
      ready: enabled && Boolean(currentEndpoint),
      chromeConfigured,
      descriptorPath,
    };
  }

  return { configure, dispose, getStatus, rotate };
}

module.exports = {
  CONNECTION_TIMEOUT_MS,
  DESCRIPTOR_FILE_NAME,
  MAX_MESSAGE_BYTES,
  MAX_CONCURRENT_CONNECTIONS,
  PROTOCOL_VERSION,
  browserBridgeRuntimeDirectory,
  createBrowserBridgeService,
  createRateLimiter,
  dispatchBrowserBridgeRequest,
  encodeFrame,
  handleSocket,
  projectBrowserAccounts,
  unixEndpointDirectory,
};
