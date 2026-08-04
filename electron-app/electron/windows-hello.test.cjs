const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

const {
  WINDOWS_HELLO_VERIFY_SCRIPT,
  getWindowsHelloAvailability,
  getWindowsPowerShellPath,
  mapAvailabilityStatus,
  mapVerificationStatus,
  parsePowerShellResult,
  runPowerShellScript,
  serializeWindowHandle,
  verifyWindowsHello,
} = require("./windows-hello.cjs");

function createChildProcess({ output, code = 0, emitClose = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    if (emitClose) {
      queueMicrotask(() => child.emit("close", null));
    }
    return true;
  };

  if (output !== undefined) {
    queueMicrotask(() => {
      child.stdout.end(output);
      if (emitClose) {
        child.emit("close", code);
      }
    });
  }

  return child;
}

test("resolves Windows PowerShell from the system directory", () => {
  assert.match(
    getWindowsPowerShellPath({ SystemRoot: "C:\\Windows" }),
    /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
  );
  assert.equal(getWindowsPowerShellPath({}), undefined);
});

test("parses only successful, shaped PowerShell results", () => {
  assert.equal(parsePowerShellResult('{"ok":true,"status":"Available"}'), "Available");
  assert.equal(parsePowerShellResult('{"ok":false,"status":"Available"}'), undefined);
  assert.equal(parsePowerShellResult("not json"), undefined);
  assert.equal(parsePowerShellResult('{"ok":true,"status":42}'), undefined);
});

test("maps Windows Hello availability and verification outcomes", () => {
  assert.equal(mapAvailabilityStatus("Available"), "available");
  assert.equal(mapAvailabilityStatus("RemoteSession"), "remote-session");
  assert.equal(mapAvailabilityStatus("DeviceNotPresent"), "unavailable");
  assert.equal(mapAvailabilityStatus("unexpected"), "error");

  assert.equal(mapVerificationStatus("Verified"), "verified");
  assert.equal(mapVerificationStatus("Canceled"), "canceled");
  assert.equal(mapVerificationStatus("RetriesExhausted"), "failed");
  assert.equal(mapVerificationStatus("DeviceNotPresent"), "unavailable");
  assert.equal(mapVerificationStatus("NotConfiguredForUser"), "unavailable");
  assert.equal(mapVerificationStatus("RemoteSession"), "remote-session");
  assert.equal(mapVerificationStatus("unexpected"), "error");
});

test("runs a fixed Windows Hello script without accepting renderer input", async () => {
  let invocation;
  const result = await getWindowsHelloAvailability({
    platform: "win32",
    powershellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    spawnProcess: (file, args, options) => {
      invocation = { file, args, options };
      return createChildProcess({ output: '{"ok":true,"status":"Available"}' });
    },
  });

  assert.deepEqual(result, { status: "available" });
  assert.equal(invocation.args.includes("-NonInteractive"), true);
  assert.equal(invocation.args.includes("-Sta"), true);
  assert.equal(invocation.options.windowsHide, true);
  assert.match(WINDOWS_HELLO_VERIFY_SCRIPT, /RequestVerificationForWindowAsync/);
  assert.match(WINDOWS_HELLO_VERIFY_SCRIPT, /UserConsentVerifierInteropIid/);
  assert.doesNotMatch(WINDOWS_HELLO_VERIFY_SCRIPT, /RequestVerificationAsync\(/);
  assert.doesNotMatch(WINDOWS_HELLO_VERIFY_SCRIPT, /args|process\.argv|window\.location/i);
});

test("serializes only valid native window handles", () => {
  assert.equal(serializeWindowHandle(Buffer.from([0x78, 0x56, 0x34, 0x12])), "305419896");
  assert.equal(serializeWindowHandle(Buffer.alloc(8)), undefined);
  assert.equal(serializeWindowHandle(Buffer.from([1, 2, 3])), undefined);
  assert.equal(serializeWindowHandle(123), undefined);
});

test("maps verification results returned by the bridge", async () => {
  let invocation;
  const result = await verifyWindowsHello({
    platform: "win32",
    powershellPath: "powershell.exe",
    windowHandle: Buffer.from([0x78, 0x56, 0x34, 0x12]),
    spawnProcess: (file, args) => {
      invocation = { file, args };
      return createChildProcess({ output: '{"ok":true,"status":"Canceled"}' });
    },
  });

  assert.deepEqual(result, { status: "canceled" });
  assert.match(invocation.args.at(-1), /\[long\]305419896/);
  assert.doesNotMatch(invocation.args.at(-1), /__WINOTP_WINDOW_HANDLE__/);
});

test("does not launch verification without an application window handle", async () => {
  let spawned = false;
  const result = await verifyWindowsHello({
    platform: "win32",
    spawnProcess: () => {
      spawned = true;
      return createChildProcess({ output: '{"ok":true,"status":"Verified"}' });
    },
  });

  assert.deepEqual(result, { status: "error" });
  assert.equal(spawned, false);
});

test("fails safely when PowerShell cannot start or returns invalid output", async () => {
  const spawnFailure = await runPowerShellScript("script", {
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess: () => {
      throw new Error("spawn failed");
    },
  });
  assert.equal(spawnFailure.ok, false);

  const invalidOutput = await runPowerShellScript("script", {
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess: () => createChildProcess({ output: "not json" }),
  });
  assert.equal(invalidOutput.ok, false);
});

test("does not launch PowerShell off Windows and times out a stuck prompt", async () => {
  let spawned = false;
  const nonWindows = await runPowerShellScript("script", {
    platform: "linux",
    spawnProcess: () => {
      spawned = true;
      return createChildProcess();
    },
  });
  assert.equal(nonWindows.ok, false);
  assert.equal(spawned, false);

  let child;
  const timedOut = await runPowerShellScript("script", {
    platform: "win32",
    powershellPath: "powershell.exe",
    timeoutMs: 10,
    spawnProcess: () => {
      child = createChildProcess({ emitClose: false });
      return child;
    },
  });
  assert.equal(timedOut.ok, false);
  assert.equal(child.killed, true);
});
