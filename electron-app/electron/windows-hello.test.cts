const assert = require("node:assert/strict");
const { test } = require("node:test");

const { getWindowsHelloAvailability, verifyWindowsHello } = require("./windows-hello.cjs");

test("maps native availability to the result shown in Windows Hello settings", async () => {
  for (const [status, expected] of [
    ["Available", "available"],
    ["RemoteSession", "remote-session"],
    ["DeviceNotPresent", "unavailable"],
    ["unexpected", "error"],
  ]) {
    const result = await getWindowsHelloAvailability({
      platform: "win32",
      runOperation: async (operation, input) => {
        assert.equal(operation, "windows-hello-availability");
        assert.deepEqual(input, {});
        return { status };
      },
    });
    assert.deepEqual(result, { status: expected });
  }
});

test("verifies with the application's native window handle and maps the result", async () => {
  for (const [status, expected] of [
    ["Verified", "verified"],
    ["Canceled", "canceled"],
    ["RetriesExhausted", "failed"],
    ["DeviceNotPresent", "unavailable"],
    ["NotConfiguredForUser", "unavailable"],
    ["RemoteSession", "remote-session"],
    ["unexpected", "error"],
  ]) {
    const result = await verifyWindowsHello({
      platform: "win32",
      windowHandle: Buffer.from("7856341201000000", "hex"),
      runOperation: async (operation, input) => {
        assert.equal(operation, "windows-hello-verify");
        assert.deepEqual(input, { windowHandle: "4600387192" });
        return { status };
      },
    });
    assert.deepEqual(result, { status: expected });
  }
});

test("rejects missing or invalid native window handles without starting verification", async () => {
  let invoked = false;
  for (const windowHandle of [undefined, Buffer.alloc(8), Buffer.from([1, 2, 3]), 123]) {
    const result = await verifyWindowsHello({
      platform: "win32",
      windowHandle,
      runOperation: async () => {
        invoked = true;
        return { status: "Verified" };
      },
    });
    assert.deepEqual(result, { status: "error" });
  }
  assert.equal(invoked, false);
});

test("reports Windows Hello as unavailable outside Windows and fails safely on bridge errors", async () => {
  for (const platform of ["linux", "darwin"]) {
    const result = await getWindowsHelloAvailability({
      platform,
      runOperation: async () => ({ status: "Available" }),
    });
    assert.deepEqual(result, { status: "error" });
  }

  for (const runOperation of [
    async () => ({}),
    async () => {
      throw new Error("bridge failed");
    },
  ]) {
    assert.deepEqual(await getWindowsHelloAvailability({ platform: "win32", runOperation }), {
      status: "error",
    });
  }
});
