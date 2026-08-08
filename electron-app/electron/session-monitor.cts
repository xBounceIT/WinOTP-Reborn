const { spawn } = require("node:child_process");
const { resolveRustCoreBinary, runRustCoreAsync } = require("./rust-core.cjs");
const { serializeWindowHandle } = require("./windows-hello.cjs");

const SESSION_CHANGE_WINDOW_MESSAGE = 0x02b1;
const SESSION_NOTIFICATION_FLAGS = Object.freeze({
  consoleConnect: 0x1,
  consoleDisconnect: 0x2,
  remoteConnect: 0x3,
  remoteDisconnect: 0x4,
});
const SESSION_CHANGE_REASONS = new Map([
  [SESSION_NOTIFICATION_FLAGS.consoleConnect, "console-connect"],
  [SESSION_NOTIFICATION_FLAGS.consoleDisconnect, "console-disconnect"],
  [SESSION_NOTIFICATION_FLAGS.remoteConnect, "remote-connect"],
  [SESSION_NOTIFICATION_FLAGS.remoteDisconnect, "remote-disconnect"],
]);
const SESSION_NOTIFICATION_TIMEOUT_MS = 5_000;
const SESSION_WATCH_RESTART_DELAY_MS = 5_000;

function getSessionChangeCode(wParam) {
  if (!Buffer.isBuffer(wParam) || wParam.length < 4) {
    return undefined;
  }

  return wParam.readUInt32LE(0);
}

function isRelevantSessionChangeCode(code) {
  return SESSION_CHANGE_REASONS.has(code);
}

function getSessionChangeReason(code) {
  return SESSION_CHANGE_REASONS.get(code);
}

function runSessionNotificationOperation(operation, windowHandle, options: any = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return Promise.resolve({
      ok: false,
      error: "Windows session notifications are only available on Windows.",
    });
  }

  const serializedHandle = serializeWindowHandle(windowHandle);
  if (!serializedHandle) {
    return Promise.resolve({ ok: false, error: "The native window handle is unavailable." });
  }

  const { runOperation = runRustCoreAsync, ...bridgeOptions } = options;
  return Promise.resolve()
    .then(() =>
      runOperation(
        operation,
        { windowHandle: serializedHandle },
        {
          ...bridgeOptions,
          timeoutMs: options.timeoutMs ?? SESSION_NOTIFICATION_TIMEOUT_MS,
          maxBuffer: options.maxBuffer ?? 16 * 1024,
        },
      ),
    )
    .then((result) => {
      if (!result || typeof result.status !== "string") {
        return { ok: false, error: "The Rust session bridge returned an invalid result." };
      }
      return { ok: true, status: result.status };
    })
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Windows session notification failed.",
    }));
}

function registerSessionNotification(windowHandle, options: any = {}) {
  return runSessionNotificationOperation("session-notification-register", windowHandle, options);
}

function unregisterSessionNotification(windowHandle, options: any = {}) {
  return runSessionNotificationOperation("session-notification-unregister", windowHandle, options);
}

function parseSessionWatchEvent(line) {
  try {
    const event = JSON.parse(line);
    if (event?.ok === true && typeof event.event?.reason === "string") {
      return event.event.reason;
    }
  } catch {
    // Malformed watcher output must not interrupt later transitions.
  }
  return undefined;
}

function startSessionChangeWatcher(options: any = {}) {
  const resolveBinary = options.resolveRustCoreBinary ?? resolveRustCoreBinary;
  const binaryPath = options.binaryPath ?? resolveBinary(options);
  const onSessionChange = options.onSessionChange ?? (() => undefined);
  const onError = options.onError ?? (() => undefined);
  const createChild =
    options.createChild ?? ((binary, spawnOptions) => spawn(binary, [], spawnOptions));
  const restartDelayMs = options.restartDelayMs ?? SESSION_WATCH_RESTART_DELAY_MS;
  let child;
  let restartTimer;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
    if (child) {
      try {
        child.kill();
      } catch {
        // The watcher may have already exited.
      }
      child = undefined;
    }
  };

  const start = () => {
    if (stopped) {
      return;
    }
    let stdoutBuffer = "";
    child = createChild(binaryPath, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const reason = parseSessionWatchEvent(line);
        if (reason) {
          onSessionChange(reason);
        }
      }
    });
    child.on("error", (error) => {
      child = undefined;
      if (!stopped) {
        onError(error);
      }
    });
    child.on("close", (code) => {
      child = undefined;
      if (!stopped) {
        if (code !== 0) {
          onError(new Error(`The session-change watcher exited with status ${code ?? "unknown"}.`));
        }
        restartTimer = setTimeout(start, restartDelayMs);
      }
    });
    child.stdin?.end(JSON.stringify({ operation: "session-watch", input: {} }));
  };

  if (!binaryPath) {
    onError(new Error("The WinOTP Rust core is unavailable."));
  } else {
    start();
  }
  return { stop };
}

module.exports = {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  SESSION_NOTIFICATION_TIMEOUT_MS,
  SESSION_WATCH_RESTART_DELAY_MS,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  parseSessionWatchEvent,
  registerSessionNotification,
  runSessionNotificationOperation,
  startSessionChangeWatcher,
  unregisterSessionNotification,
};
