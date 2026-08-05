const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  registerSessionNotification,
  unregisterSessionNotification,
} = require("./session-monitor.cjs");

test("maps all Windows session transitions to renderer reasons", () => {
  assert.equal(SESSION_CHANGE_WINDOW_MESSAGE, 0x02b1);

  for (const [name, code] of Object.entries(SESSION_NOTIFICATION_FLAGS)) {
    assert.equal(isRelevantSessionChangeCode(code), true);
    assert.equal(getSessionChangeReason(code), name.replace(/([A-Z])/g, "-$1").toLowerCase());
  }
});

test("ignores unrelated or malformed Windows messages", () => {
  assert.equal(isRelevantSessionChangeCode(0), false);
  assert.equal(isRelevantSessionChangeCode(5), false);
  assert.equal(getSessionChangeCode(Buffer.from([0x03, 0x00, 0x00, 0x00])), 3);
  assert.equal(getSessionChangeCode(Buffer.from([0x01, 0x00])), undefined);
  assert.equal(getSessionChangeCode("3"), undefined);
});

test("registers and unregisters through the Rust sidecar", async () => {
  const calls = [];
  const runOperation = async (operation, input, options) => {
    calls.push({ operation, input, options });
    return { status: operation.endsWith("register") ? "registered" : "unregistered" };
  };
  const windowHandle = Buffer.from("78563412", "hex");

  const registered = await registerSessionNotification(windowHandle, {
    platform: "win32",
    runOperation,
  });
  const unregistered = await unregisterSessionNotification(windowHandle, {
    platform: "win32",
    runOperation,
  });

  assert.equal(registered.ok, true);
  assert.equal(unregistered.ok, true);
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ["session-notification-register", "session-notification-unregister"],
  );
  assert.deepEqual(calls[0].input, { windowHandle: "305419896" });
  assert.equal(calls[0].options.timeoutMs, 5_000);
});

test("rejects invalid handles and non-Windows session registration", async () => {
  const invalid = await registerSessionNotification(Buffer.alloc(0), {
    platform: "win32",
    runOperation: async () => ({ status: "registered" }),
  });
  assert.equal(invalid.ok, false);

  const nonWindows = await registerSessionNotification(Buffer.from("78563412", "hex"), {
    platform: "linux",
    runOperation: async () => ({ status: "registered" }),
  });
  assert.equal(nonWindows.ok, false);
});
