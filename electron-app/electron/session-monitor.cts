const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
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
const SESSION_WATCH_ERROR_RESTART_DELAY_MS = 60_000;
const MAX_SESSION_WATCH_OUTPUT_BYTES = 64 * 1024;

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

function parseSessionWatchMessage(line) {
  try {
    const event = JSON.parse(line);
    if (event?.ok === true && typeof event.event?.reason === "string") {
      return { reason: event.event.reason };
    }
    if (event?.ok === false && typeof event.error === "string" && event.error.trim()) {
      return { error: event.error.trim() };
    }
  } catch {
    // Malformed watcher output must not interrupt later transitions.
  }
  return {};
}

function shouldStartSessionChangeWatcher(platform = process.platform) {
  return platform === "win32" || platform === "linux";
}

function startSessionChangeWatcher(options: any = {}) {
  const resolveBinary = options.resolveRustCoreBinary ?? resolveRustCoreBinary;
  const binaryPath = options.binaryPath ?? resolveBinary(options);
  const onSessionChange = options.onSessionChange ?? (() => undefined);
  const onError = options.onError ?? (() => undefined);
  const createChild =
    options.createChild ?? ((binary, spawnOptions) => spawn(binary, [], spawnOptions));
  const restartDelayMs = options.restartDelayMs ?? SESSION_WATCH_RESTART_DELAY_MS;
  const errorRestartDelayMs = options.errorRestartDelayMs ?? SESSION_WATCH_ERROR_RESTART_DELAY_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_SESSION_WATCH_OUTPUT_BYTES;
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
    let watcherReportedError = false;
    try {
      child = createChild(binaryPath, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error("Unable to start the session watcher."));
      restartTimer = setTimeout(start, errorRestartDelayMs);
      return;
    }
    const watcherChild = child;
    const stdoutDecoder = new StringDecoder("utf8");
    let terminatingForOutput = false;
    const terminateForOutput = () => {
      if (terminatingForOutput) {
        return;
      }
      terminatingForOutput = true;
      watcherReportedError = true;
      onError(new Error("The session-change watcher returned too much output."));
      stdoutBuffer = "";
      watcherChild.kill();
    };
    const consumeOutput = (text) => {
      if (stopped || terminatingForOutput) {
        return;
      }
      stdoutBuffer += text;
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(rawLine) > maxOutputBytes) {
          terminateForOutput();
          return;
        }
        const line = rawLine.trim();
        const message = parseSessionWatchMessage(line);
        if (message.reason) {
          onSessionChange(message.reason);
        } else if (message.error) {
          watcherReportedError = true;
          onError(new Error(message.error));
        }
      }
      if (Buffer.byteLength(stdoutBuffer) > maxOutputBytes) {
        terminateForOutput();
      }
    };
    watcherChild.stdout?.on("data", (chunk) => {
      consumeOutput(Buffer.isBuffer(chunk) ? stdoutDecoder.write(chunk) : String(chunk));
    });
    watcherChild.on("error", (error) => {
      watcherReportedError = true;
      if (!stopped) {
        onError(error);
      }
    });
    watcherChild.on("close", (code) => {
      const finalOutput = stdoutDecoder.end();
      consumeOutput(finalOutput);
      if (child === watcherChild) {
        child = undefined;
      }
      if (!stopped) {
        if (code !== 0) {
          if (!watcherReportedError) {
            onError(
              new Error(`The session-change watcher exited with status ${code ?? "unknown"}.`),
            );
          }
          watcherReportedError = true;
        }
        restartTimer = setTimeout(
          start,
          watcherReportedError ? errorRestartDelayMs : restartDelayMs,
        );
      }
    });
    watcherChild.stdin?.end(JSON.stringify({ operation: "session-watch", input: {} }));
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
  MAX_SESSION_WATCH_OUTPUT_BYTES,
  SESSION_WATCH_ERROR_RESTART_DELAY_MS,
  SESSION_WATCH_RESTART_DELAY_MS,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  parseSessionWatchMessage,
  registerSessionNotification,
  runSessionNotificationOperation,
  shouldStartSessionChangeWatcher,
  startSessionChangeWatcher,
  unregisterSessionNotification,
};
