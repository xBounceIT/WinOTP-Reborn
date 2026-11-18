const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  shouldStartSessionChangeWatcher,
  startSessionChangeWatcher,
} = require("./session-monitor.cjs");

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

test("preserves UTF-8 watcher errors split across chunks", (context) => {
  const errors = [];
  const child = createFakeWatcherChild();
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => child,
    onError: (error) => errors.push(error),
  });
  context.after(() => watcher.stop());
  const payload = Buffer.from(
    `${JSON.stringify({ ok: false, error: "sessione non disponibile — riprovare" })}\n`,
  );
  const splitIndex = payload.indexOf(Buffer.from("—")) + 1;

  child.stdout.emit("data", payload.subarray(0, splitIndex));
  child.stdout.emit("data", payload.subarray(splitIndex));

  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "sessione non disponibile — riprovare");
});

test("starts the native session watcher on Windows and Linux", () => {
  assert.equal(shouldStartSessionChangeWatcher("win32"), true);
  assert.equal(shouldStartSessionChangeWatcher("linux"), true);
  assert.equal(shouldStartSessionChangeWatcher("darwin"), false);
});

test("streams Windows session transitions from the Rust watcher", (context) => {
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
  context.after(() => watcher.stop());

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

test("restarts the Rust watcher after an unexpected exit and stops on demand", async (context) => {
  const children = [];
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core.exe",
    createChild: () => {
      const child = createFakeWatcherChild();
      children.push(child);
      return child;
    },
    restartDelayMs: 1,
    errorRestartDelayMs: 20,
  });
  context.after(() => watcher.stop());

  assert.equal(children.length, 1);
  children[0].emit("close", 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(children.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(children.length, 2);

  watcher.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(children.length, 2);
});

test("uses a restart snapshot to resynchronize missed session transitions", async (context) => {
  const reasons = [];
  const children = [];
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core.exe",
    createChild: () => {
      const child = createFakeWatcherChild();
      children.push(child);
      return child;
    },
    onSessionChange: (reason) => reasons.push(reason),
    restartDelayMs: 1,
  });
  context.after(() => watcher.stop());

  children[0].stdout.emit(
    "data",
    `${JSON.stringify({
      ok: true,
      event: { code: 3, reason: "remote-connect", snapshot: true },
    })}\n`,
  );
  assert.deepEqual(reasons, []);

  children[0].emit("close", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(children.length, 2);
  children[1].stdout.emit(
    "data",
    `${JSON.stringify({
      ok: true,
      event: { code: 1, reason: "console-connect", snapshot: true },
    })}\n`,
  );

  assert.deepEqual(reasons, ["console-connect"]);
});

test("terminates a watcher that exceeds its output boundary", (context) => {
  const errors = [];
  const child = createFakeWatcherChild();
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => child,
    onError: (error) => errors.push(error),
    errorRestartDelayMs: 60_000,
  });
  context.after(() => watcher.stop());

  child.stdout.emit("data", "x".repeat(64 * 1024 + 1));

  assert.equal(child.killed, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /too much output/);
});

test("rejects oversized complete watcher messages only once", (context) => {
  const errors = [];
  const child = createFakeWatcherChild();
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => child,
    onError: (error) => errors.push(error),
    maxOutputBytes: 16,
    errorRestartDelayMs: 60_000,
  });
  context.after(() => watcher.stop());

  child.stdout.emit("data", `${"x".repeat(17)}\n`);
  child.stdout.emit("data", `${"x".repeat(17)}\n`);

  assert.equal(child.killed, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /too much output/);
});

test("backs off after synchronous watcher spawn failures", async (context) => {
  const errors = [];
  let attempts = 0;
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => {
      attempts += 1;
      throw new Error("spawn failed");
    },
    onError: (error) => errors.push(error),
    errorRestartDelayMs: 20,
  });
  context.after(() => watcher.stop());

  assert.equal(attempts, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attempts, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(attempts, 2);
  assert.equal(errors.length, 2);
});

test("backs off retries after a native watcher error", async (context) => {
  const children = [];
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => {
      const child = createFakeWatcherChild();
      children.push(child);
      return child;
    },
    restartDelayMs: 1,
    errorRestartDelayMs: 30,
  });
  context.after(() => watcher.stop());

  children[0].stdout.emit(
    "data",
    `${JSON.stringify({ ok: false, error: "logind unavailable" })}\n`,
  );
  children[0].emit("close", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(children.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(children.length, 2);
  watcher.stop();
});

test("can still stop a watcher after its child emits an error", () => {
  const child = createFakeWatcherChild();
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => child,
  });

  child.emit("error", new Error("temporary process error"));
  watcher.stop();
  assert.equal(child.killed, true);
});

test("ignores session events that arrive after the watcher is stopped", () => {
  const reasons = [];
  const child = createFakeWatcherChild();
  const watcher = startSessionChangeWatcher({
    resolveRustCoreBinary: () => "winotp-core",
    createChild: () => child,
    onSessionChange: (reason) => reasons.push(reason),
  });

  watcher.stop();
  child.stdout.emit(
    "data",
    `${JSON.stringify({ ok: true, event: { code: 1, reason: "lock-screen" } })}\n`,
  );
  child.emit("close", 0);

  assert.deepEqual(reasons, []);
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
