const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  getWindowsHelloAvailability,
  mapAvailabilityStatus,
  mapVerificationStatus,
  runWindowsHelloOperation,
  serializeWindowHandle,
  verifyWindowsHello,
} = require("./windows-hello.cjs");

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

test("delegates Windows Hello availability to the Rust sidecar", async () => {
  let invocation;
  const result = await getWindowsHelloAvailability({
    platform: "win32",
    runOperation: async (operation, input, options) => {
      invocation = { operation, input, options };
      return { status: "Available" };
    },
  });

  assert.deepEqual(result, { status: "available" });
  assert.equal(invocation.operation, "windows-hello-availability");
  assert.deepEqual(invocation.input, {});
  assert.equal(invocation.options.timeoutMs, 120_000);
});

test("serializes only valid native window handles", () => {
  assert.equal(serializeWindowHandle(Buffer.from([0x78, 0x56, 0x34, 0x12])), "305419896");
  assert.equal(serializeWindowHandle(Buffer.alloc(8)), undefined);
  assert.equal(serializeWindowHandle(Buffer.from([1, 2, 3])), undefined);
  assert.equal(serializeWindowHandle(123), undefined);
});

test("delegates Windows Hello verification with the validated window handle", async () => {
  let invocation;
  const result = await verifyWindowsHello({
    platform: "win32",
    windowHandle: Buffer.from([0x78, 0x56, 0x34, 0x12]),
    runOperation: async (operation, input, options) => {
      invocation = { operation, input, options };
      return { status: "Canceled" };
    },
  });

  assert.deepEqual(result, { status: "canceled" });
  assert.equal(invocation.operation, "windows-hello-verify");
  assert.deepEqual(invocation.input, { windowHandle: "305419896" });
  assert.equal(invocation.options.timeoutMs, 120_000);
});

test("does not launch verification without an application window handle", async () => {
  let invoked = false;
  const result = await verifyWindowsHello({
    platform: "win32",
    runOperation: async () => {
      invoked = true;
      return { status: "Verified" };
    },
  });

  assert.deepEqual(result, { status: "error" });
  assert.equal(invoked, false);
});

test("fails safely for unavailable, invalid, or failed Rust operations", async () => {
  const nonWindows = await getWindowsHelloAvailability({
    platform: "linux",
    runOperation: async () => ({ status: "Available" }),
  });
  assert.deepEqual(nonWindows, { status: "error" });

  const invalid = await runWindowsHelloOperation(
    "windows-hello-availability",
    {},
    {
      platform: "win32",
      runOperation: async () => ({}),
    },
  );
  assert.equal(invalid.ok, false);

  const failed = await runWindowsHelloOperation(
    "windows-hello-availability",
    {},
    {
      platform: "win32",
      runOperation: async () => {
        throw new Error("bridge failed");
      },
    },
  );
  assert.deepEqual(failed, { ok: false, error: "bridge failed" });
});
