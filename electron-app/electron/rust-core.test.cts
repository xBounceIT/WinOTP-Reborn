const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RustCoreUnavailableError,
  getCoreBinaryCandidates,
  resolveRustCoreBinary,
  runRustCoreAsync,
  tryRunRustCore,
} = require("./rust-core.cjs");

test("finds the packaged core beside Electron resources without an app object", () => {
  const resourcesPath = path.resolve("fixture-packaged-app", "resources");
  const candidates = getCoreBinaryCandidates({
    platform: "win32",
    environment: { RESOURCES_PATH: resourcesPath },
    dirname: path.join(resourcesPath, "app.asar", "electron"),
  });

  assert.ok(candidates.includes(path.join(resourcesPath, "updater", "winotp-core.exe")));
});

test("finds the unpackaged core from the compiled Electron layout", () => {
  const appRoot = path.resolve("fixture-unpackaged-app");
  const candidates = getCoreBinaryCandidates({
    platform: "win32",
    environment: {},
    dirname: path.join(appRoot, "electron-dist", "electron"),
  });

  assert.ok(candidates.includes(path.join(appRoot, "native", "winotp-core.exe")));
});

test("resolves the packaged core from the resource directory", () => {
  const resourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-resources-"));
  const binaryPath = path.join(resourcePath, "updater", "winotp-core.exe");

  try {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, "test");
    assert.equal(
      resolveRustCoreBinary({
        platform: "win32",
        environment: { RESOURCES_PATH: resourcePath },
        dirname: path.join(resourcePath, "app.asar", "electron"),
      }),
      binaryPath,
    );
  } finally {
    fs.rmSync(resourcePath, { recursive: true, force: true });
  }
});

test("runs a Rust core operation through the asynchronous bridge", async () => {
  const result = await runRustCoreAsync("version", {
    informationalVersion: "v2.3.4+build.9",
  });

  assert.deepEqual(result, { version: "2.3.4" });
});

test("reports a missing asynchronous Rust core as unavailable", async () => {
  const binaryPath = path.join(os.tmpdir(), `winotp-core-missing-${process.pid}`);

  await assert.rejects(
    runRustCoreAsync("version", {}, { binaryPath }),
    (error) => error instanceof RustCoreUnavailableError,
  );
});

test("rejects oversized Rust core requests before launching the sidecar", async () => {
  await assert.rejects(
    runRustCoreAsync(
      "version",
      { payload: "x".repeat(64) },
      { binaryPath: resolveCoreBinary(), maxInputBytes: 16 },
    ),
    /request is too large/,
  );
});

test("does not hide a Rust operation failure behind a bridge fallback", () => {
  assert.throws(
    () => tryRunRustCore("unsupported-operation", {}, { binaryPath: resolveCoreBinary() }),
    /Unsupported WinOTP core operation/,
  );
});

function resolveCoreBinary() {
  const candidates = getCoreBinaryCandidates();
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(binary, "the test core binary must be built before Electron tests run");
  return binary;
}
