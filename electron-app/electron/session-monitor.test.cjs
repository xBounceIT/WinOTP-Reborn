const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT,
  WINDOWS_UNREGISTER_SESSION_NOTIFICATION_SCRIPT,
  buildSessionNotificationScript,
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

test("builds a bounded native registration script from a valid window handle", () => {
  const script = buildSessionNotificationScript(
    WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT,
    Buffer.from("78563412", "hex"),
  );

  assert.match(script, /WTSRegisterSessionNotification/);
  assert.match(script, /305419896/);
  assert.doesNotMatch(script, /__WINOTP_WINDOW_HANDLE__/);
  assert.equal(
    buildSessionNotificationScript(WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT, Buffer.alloc(0)),
    undefined,
  );
});

test("registers and unregisters through the injected PowerShell runner", async () => {
  const calls = [];
  const runScript = async (script, options) => {
    calls.push({ script, options });
    return { ok: true, status: "registered" };
  };
  const windowHandle = Buffer.from("78563412", "hex");

  const registered = await registerSessionNotification(windowHandle, { runScript });
  const unregistered = await unregisterSessionNotification(windowHandle, { runScript });

  assert.equal(registered.ok, true);
  assert.equal(unregistered.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].script, /WTSRegisterSessionNotification/);
  assert.match(calls[1].script, /WTSUnRegisterSessionNotification/);
  assert.equal(calls[0].options.timeoutMs, 5_000);
});
