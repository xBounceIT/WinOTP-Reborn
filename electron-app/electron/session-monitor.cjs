const { runRustCoreAsync } = require("./rust-core.cjs");
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

function runSessionNotificationOperation(operation, windowHandle, options = {}) {
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

function registerSessionNotification(windowHandle, options = {}) {
  return runSessionNotificationOperation("session-notification-register", windowHandle, options);
}

function unregisterSessionNotification(windowHandle, options = {}) {
  return runSessionNotificationOperation("session-notification-unregister", windowHandle, options);
}

module.exports = {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  SESSION_NOTIFICATION_TIMEOUT_MS,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  registerSessionNotification,
  runSessionNotificationOperation,
  unregisterSessionNotification,
};
