const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createUpdateService,
  getUpdaterCommand,
  getRepositoryRoot,
  runUpdater,
  UPDATE_STATUS,
} = require("./update-service.cjs");

function createState(overrides = {}) {
  return {
    currentVersion: "2.0.0",
    selectedChannel: "Stable",
    status: UPDATE_STATUS.UP_TO_DATE,
    isUpdateAvailable: false,
    isBusy: false,
    isAutomaticCheckEnabled: true,
    statusMessage: "You're up to date.",
    lastCheckedUtc: "2026-08-04T00:00:00Z",
    availableUpdate: undefined,
    downloadedInstallerPath: undefined,
    isDownloadedAssetDigestVerified: false,
    lastError: undefined,
    ...overrides,
  };
}

function createSpawnMock(responseOrFactory) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: (payload) => {
        queueMicrotask(() => {
          const response =
            typeof responseOrFactory === "function"
              ? responseOrFactory(JSON.parse(payload))
              : responseOrFactory;
          child.stdout.emit("data", JSON.stringify(response));
          child.emit("close", 0, null);
        });
      },
    };
    child.kill = () => undefined;
    return child;
  };
}

test("resolves the repository root from the compiled Electron layout", () => {
  const repositoryRoot = getRepositoryRoot();

  assert.equal(fs.existsSync(path.join(repositoryRoot, "rust", "Cargo.toml")), true);
  assert.equal(repositoryRoot, path.resolve(process.cwd(), ".."));
});

test("uses the configured Rust updater path without shell execution", async () => {
  const response = { success: true, state: createState() };
  let request;
  const spawnProcess = (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args, []);
    assert.equal(options.shell, undefined);
    const child = createSpawnMock(response)();
    const originalEnd = child.stdin.end;
    child.stdin.end = (payload) => {
      request = JSON.parse(payload);
      originalEnd(payload);
    };
    return child;
  };

  const result = await runUpdater(
    { command: "status", currentVersion: "2.0.0" },
    {
      app: { isPackaged: false },
      environment: { WINOTP_UPDATER_PATH: process.execPath },
      spawnProcess,
    },
  );

  assert.equal(result.success, true);
  assert.equal(request.command, "status");
});

test("falls back to cargo in an unpackaged checkout and refuses a missing packaged bridge", () => {
  const command = getUpdaterCommand({
    app: { isPackaged: false },
    environment: {},
  });
  assert.ok(command.command === "cargo" || command.command.includes("winotp-updater"));
  if (command.command === "cargo") {
    assert.deepEqual(command.args.slice(0, 2), ["run", "--quiet"]);
  }

  const packagedCommand = getUpdaterCommand({
    app: { isPackaged: true },
    environment: {},
  });
  assert.equal(packagedCommand, undefined);
});

test("updates the service state from a real Rust bridge response", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-update-service-"));
  try {
    const updateState = createState({
      status: UPDATE_STATUS.UPDATE_AVAILABLE,
      isUpdateAvailable: true,
      statusMessage: "Version 2.1.0 is available.",
      availableUpdate: {
        version: "2.1.0",
        displayVersion: "2.1.0",
        releaseTag: "v2.1.0",
        releaseTitle: "2.1.0",
        releaseUrl: "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v2.1.0",
        isPreRelease: false,
        installerName: "WinOTP-2.1.0-win-x64-setup.exe",
        installerUrl:
          "https://github.com/xBounceIT/WinOTP-Reborn/releases/download/v2.1.0/WinOTP-2.1.0-win-x64-setup.exe",
        releaseNotes: "",
      },
    });
    const service = createUpdateService({
      app: { isPackaged: false, getVersion: () => "2.0.0", getPath: () => root },
      environment: { WINOTP_UPDATER_PATH: process.execPath, LOCALAPPDATA: root },
      spawnProcess: createSpawnMock({ success: true, state: updateState }),
    });

    const result = await service.check("Stable");
    assert.equal(result.success, true);
    assert.equal(result.state.status, UPDATE_STATUS.UPDATE_AVAILABLE);
    assert.equal(result.state.availableUpdate.displayVersion, "2.1.0");
    assert.equal(result.state.currentVersion, "2.0.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installs an update that is already downloaded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-update-service-"));
  const availableUpdate = {
    version: "2.1.0",
    displayVersion: "2.1.0",
    releaseTag: "v2.1.0",
    releaseTitle: "2.1.0",
    releaseUrl: "https://github.com/xBounceIT/WinOTP-Reborn/releases/tag/v2.1.0",
    isPreRelease: false,
    installerName: "WinOTP-2.1.0-win-x64-setup.exe",
    installerUrl:
      "https://github.com/xBounceIT/WinOTP-Reborn/releases/download/v2.1.0/WinOTP-2.1.0-win-x64-setup.exe",
    releaseNotes: "",
  };
  const installerPath = path.join(root, availableUpdate.installerName);
  const requests = [];

  try {
    const service = createUpdateService({
      app: { isPackaged: false, getVersion: () => "2.0.0", getPath: () => root },
      environment: { WINOTP_UPDATER_PATH: process.execPath, LOCALAPPDATA: root },
      spawnProcess: createSpawnMock((request) => {
        requests.push(request);
        if (request.command === "check") {
          return {
            success: true,
            state: createState({
              status: UPDATE_STATUS.UPDATE_AVAILABLE,
              isUpdateAvailable: true,
              availableUpdate,
            }),
          };
        }
        if (request.command === "download") {
          return {
            success: true,
            state: createState({
              status: UPDATE_STATUS.LAUNCH_READY,
              isUpdateAvailable: true,
              availableUpdate,
              downloadedInstallerPath: installerPath,
              isDownloadedAssetDigestVerified: true,
            }),
            filePath: installerPath,
            isDigestVerified: true,
          };
        }
        return {
          success: true,
          state: createState({ status: UPDATE_STATUS.LAUNCH_READY }),
        };
      }),
    });

    await service.check("Stable");
    await service.download();
    const result = await service.install();

    assert.equal(result.success, true);
    assert.deepEqual(
      requests.map((request) => request.command),
      ["check", "download", "install"],
    );
    assert.equal(requests[2].filePath, installerPath);
    assert.deepEqual(requests[2].update, availableUpdate);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an updater bridge response that exceeds the output limit", async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: () => {
        queueMicrotask(() => {
          child.stdout.emit("data", "x".repeat(8 * 1024 * 1024 + 1));
          child.emit("close", 0, null);
        });
      },
    };
    child.kill = () => undefined;
    return child;
  };

  await assert.rejects(
    runUpdater(
      { command: "status", currentVersion: "2.0.0" },
      {
        app: { isPackaged: false },
        environment: { WINOTP_UPDATER_PATH: process.execPath },
        spawnProcess,
      },
    ),
    /too much output/,
  );
});
