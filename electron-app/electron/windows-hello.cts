const { runRustCoreAsync } = require("./rust-core.cjs");

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024;

const unavailableAvailabilityResults = new Set([
  "DeviceNotPresent",
  "NotConfiguredForUser",
  "DisabledByPolicy",
]);

const unavailableVerificationResults = unavailableAvailabilityResults;

function mapAvailabilityStatus(status) {
  if (status === "Available") {
    return "available";
  }
  if (status === "RemoteSession") {
    return "remote-session";
  }
  if (unavailableAvailabilityResults.has(status)) {
    return "unavailable";
  }
  return "error";
}

function mapVerificationStatus(status) {
  if (status === "Verified") {
    return "verified";
  }
  if (status === "RemoteSession") {
    return "remote-session";
  }
  if (unavailableVerificationResults.has(status)) {
    return "unavailable";
  }
  if (status === "Canceled" || status === "Cancelled") {
    return "canceled";
  }
  if (status === "DeviceBusy" || status === "RetriesExhausted") {
    return "failed";
  }
  return "error";
}

function serializeWindowHandle(windowHandle) {
  if (!Buffer.isBuffer(windowHandle) || ![4, 8].includes(windowHandle.length)) {
    return undefined;
  }

  let value = 0n;
  for (let index = 0; index < windowHandle.length; index += 1) {
    value |= BigInt(windowHandle[index]) << BigInt(index * 8);
  }

  if (value === 0n || value > 0x7fffffffffffffffn) {
    return undefined;
  }

  return value.toString(10);
}

function runWindowsHelloOperation(operation, input, options: any = {}): Promise<any> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return Promise.resolve({ ok: false, error: "Windows Hello is only available on Windows." });
  }

  const { runOperation = runRustCoreAsync, ...bridgeOptions } = options;
  return Promise.resolve()
    .then(() =>
      runOperation(operation, input, {
        ...bridgeOptions,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? MAX_OUTPUT_BYTES,
      }),
    )
    .then((result) => {
      if (!result || typeof result.status !== "string") {
        return { ok: false, error: "The Rust Windows Hello bridge returned an invalid result." };
      }
      return { ok: true, status: result.status };
    })
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Windows Hello failed.",
    }));
}

async function getWindowsHelloAvailability(options: any = {}) {
  const result = await runWindowsHelloOperation("windows-hello-availability", {}, options);
  return { status: result.ok ? mapAvailabilityStatus(result.status) : "error" };
}

async function verifyWindowsHello(options: any = {}) {
  const windowHandle = serializeWindowHandle(options.windowHandle);
  if (!windowHandle) {
    return { status: "error" };
  }

  const result = await runWindowsHelloOperation("windows-hello-verify", { windowHandle }, options);
  return { status: result.ok ? mapVerificationStatus(result.status) : "error" };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  getWindowsHelloAvailability,
  mapAvailabilityStatus,
  mapVerificationStatus,
  runWindowsHelloOperation,
  serializeWindowHandle,
  verifyWindowsHello,
};
