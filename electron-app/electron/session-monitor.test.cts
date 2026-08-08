const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  parseSessionWatchEvent,
  registerSessionNotification,
  startSessionChangeWatcher,
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

function createFakeWatcherChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    end: (request) => {
      child.request = request;
    },
  };
  child.kill = () => {
    child.killed = true;
    child.emit("close", 0);
  };
  return child;
}

test("parses Rust session watcher events", () => {
  assert.equal(
    parseSessionWatchEvent(
      JSON.stringify({ ok: true, event: { code: 3, reason: "remote-connect" } }),
    ),
    "remote-connect",
  );
  assert.equal(parseSessionWatchEvent(JSON.stringify({ ok: false, error: "denied" })), undefined);
  assert.equal(parseSessionWatchEvent("not-json"), undefined);
});

test("streams Windows session transitions from the Rust watcher", () => {
  const reasons = [];
  const children = [];
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core.exe",
    createChild: (_binary, spawnOptions) => {
      const child = createFakeWatcherChild();
      child.spawnOptions = spawnOptions;
      children.push(child);
      return child;
    },
    onSessionChange: (reason) => reasons.push(reason),
  });

  assert.equal(children.length, 1);
  assert.deepEqual(JSON.parse(children[0].request), {
    operation: "session-watch",
    input: {},
  });
  children[0].stdout.emit(
    "data",
    `${JSON.stringify({ ok: true, event: { code: 3, reason: "remote-connect" } })}\n`,
  );
  children[0].stdout.emit(
    "data",
    `${JSON.stringify({ ok: true, event: { code: 4, reason: "remote-disconnect" } })}\n`,
  );
  children[0].stdout.emit("data", "not-json\n");
  assert.deepEqual(reasons, ["remote-connect", "remote-disconnect"]);

  watcher.stop();
  assert.equal(children[0].killed, true);
});

test("restarts the Rust watcher after an unexpected exit and stops on demand", async () => {
  const children = [];
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core.exe",
    createChild: () => {
      const child = createFakeWatcherChild();
      children.push(child);
      return child;
    },
    restartDelayMs: 10,
  });

  assert.equal(children.length, 1);
  children[0].emit("close", 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(children.length, 2);

  watcher.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(children.length, 2);
});

test("reports when the Rust watcher binary is unavailable", () => {
  const errors = [];
  startSessionChangeWatcher({
    resolveRustCoreBinary: () => undefined,
    onError: (error) => errors.push(error),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /unavailable/);
});
