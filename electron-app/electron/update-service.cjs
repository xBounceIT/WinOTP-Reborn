const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { getAppDataDirectory } = require("./account-store.cjs");

const UPDATE_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_UPDATER_OUTPUT_BYTES = 8 * 1024 * 1024;
const UPDATE_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  UP_TO_DATE: "upToDate",
  UPDATE_AVAILABLE: "updateAvailable",
  DOWNLOADING: "downloading",
  LAUNCH_READY: "launchReady",
  ERROR: "error",
  DISABLED: "disabled",
};

function updaterBinaryName(platform = process.platform) {
  return platform === "win32" ? "winotp-updater.exe" : "winotp-updater";
}

function getRepositoryRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getUpdaterCommand({ app, environment = process.env, platform = process.platform } = {}) {
  const configuredPath = environment.WINOTP_UPDATER_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) {
    return { command: configuredPath, args: [] };
  }

  if (app?.isPackaged) {
    if (!process.resourcesPath) {
      return undefined;
    }
    const packagedPath = path.join(
      process.resourcesPath,
      "updater",
      updaterBinaryName(platform),
    );
    return fs.existsSync(packagedPath) ? { command: packagedPath, args: [] } : undefined;
  }

  const repositoryRoot = getRepositoryRoot();
  const binaryName = updaterBinaryName(platform);
  for (const configuration of ["release", "debug"]) {
    const localPath = path.join(repositoryRoot, "rust", "target", configuration, binaryName);
    if (fs.existsSync(localPath)) {
      return { command: localPath, args: [] };
    }
  }

  return {
    command: "cargo",
    args: [
      "run",
      "--quiet",
      "--manifest-path",
      path.join(repositoryRoot, "rust", "Cargo.toml"),
      "--bin",
      "winotp-updater",
      "--",
    ],
  };
}

function defaultUpdateState(currentVersion, selectedChannel = "Stable") {
  return {
    currentVersion,
    selectedChannel,
    status: UPDATE_STATUS.IDLE,
    isUpdateAvailable: false,
    isBusy: false,
    isAutomaticCheckEnabled: true,
    statusMessage: "Ready to check for updates.",
    lastCheckedUtc: undefined,
    availableUpdate: undefined,
    downloadedInstallerPath: undefined,
    isDownloadedAssetDigestVerified: false,
    lastError: undefined,
  };
}

function cloneState(state) {
  return {
    ...state,
    availableUpdate: state.availableUpdate ? { ...state.availableUpdate } : undefined,
  };
}

function failureResult(state, message) {
  return {
    success: false,
    state: cloneState(state),
    message,
  };
}

function runUpdater(request, options = {}) {
  const {
    app,
    environment = process.env,
    platform = process.platform,
    spawnProcess = spawn,
  } = options;
  const command = getUpdaterCommand({ app, environment, platform });
  if (!command) {
    return Promise.reject(new Error("The Rust update bridge is unavailable."));
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const child = spawnProcess(command.command, command.args, {
      cwd: command.command === "cargo" ? getRepositoryRoot() : path.dirname(command.command),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process may have already exited.
      }
      settle(reject, new Error("The update operation timed out."));
    }, UPDATE_COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      if (settled) {
        return;
      }
      const text = chunk.toString();
      stdoutBytes += Buffer.byteLength(text);
      if (stdoutBytes > MAX_UPDATER_OUTPUT_BYTES) {
        settle(reject, new Error("The Rust update bridge returned too much output."));
        child.kill();
        return;
      }
      stdout += text;
    });
    child.stderr?.on("data", (chunk) => {
      if (settled) {
        return;
      }
      const text = chunk.toString();
      stderrBytes += Buffer.byteLength(text);
      if (stderrBytes > MAX_UPDATER_OUTPUT_BYTES) {
        settle(reject, new Error("The Rust update bridge returned too much diagnostic output."));
        child.kill();
        return;
      }
      stderr += text;
    });
    child.once("error", (error) => settle(reject, error));
    child.once("close", () => {
      const serialized = stdout.trim();
      if (!serialized) {
        const detail = stderr.trim();
        settle(
          reject,
          new Error(detail ? `The Rust update bridge failed: ${detail}` : "The Rust update bridge returned no response."),
        );
        return;
      }

      try {
        settle(resolve, JSON.parse(serialized));
      } catch (error) {
        const detail = stderr.trim();
        settle(
          reject,
          new Error(
            detail
              ? `The Rust update bridge returned invalid JSON: ${detail}`
              : `The Rust update bridge returned invalid JSON: ${error.message}`,
          ),
        );
      }
    });

    child.stdin?.end(JSON.stringify(request));
  });
}

function createUpdateService({ app, environment = process.env, platform = process.platform, spawnProcess = spawn } = {}) {
  const currentVersion = String(app?.getVersion?.() ?? "0.0.0");
  const updatesDirectory = path.join(
    getAppDataDirectory(app, { environment, platform }),
    "Updates",
  );
  let state = defaultUpdateState(currentVersion);
  let operationPromise;

  function getState() {
    return cloneState(state);
  }

  function request(command, options = {}) {
    return runUpdater(
      {
        command,
        currentVersion,
        channel: options.channel ?? state.selectedChannel,
        platform,
        architecture: process.arch,
        updatesDirectory,
        automaticCheckEnabled: options.automaticCheckEnabled ?? state.isAutomaticCheckEnabled,
        update: options.update,
        filePath: options.filePath,
      },
      { app, environment, platform, spawnProcess },
    );
  }

  async function runExclusive(operation) {
    if (operationPromise) {
      return failureResult(state, "Another update operation is already in progress.");
    }

    operationPromise = operation();
    try {
      return await operationPromise;
    } finally {
      operationPromise = undefined;
    }
  }

  async function check(channel = state.selectedChannel, automaticCheckEnabled = true) {
    const selectedChannel = channel === "Pre-release" ? "Pre-release" : "Stable";
    return runExclusive(async () => {
      state = {
        ...state,
        selectedChannel,
        status: UPDATE_STATUS.CHECKING,
        isBusy: true,
        isAutomaticCheckEnabled: automaticCheckEnabled,
        statusMessage: "Checking for updates...",
        lastError: undefined,
      };

      try {
        const response = await request("check", {
          channel: selectedChannel,
          automaticCheckEnabled,
        });
        if (!response?.state) {
          throw new Error(response?.message ?? "The Rust update bridge returned no update state.");
        }
        state = { ...response.state, isBusy: false };
        return {
          success: response.success === true,
          state: getState(),
          message: response.message,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to check for updates.";
        state = {
          ...state,
          status: UPDATE_STATUS.ERROR,
          isBusy: false,
          statusMessage: "Couldn't check for updates.",
          lastError: message,
          lastCheckedUtc: new Date().toISOString(),
        };
        return failureResult(state, message);
      }
    });
  }

  async function download() {
    const update = state.availableUpdate;
    if (!update) {
      return failureResult(state, "No update is currently available.");
    }

    return runExclusive(async () => {
      state = {
        ...state,
        status: UPDATE_STATUS.DOWNLOADING,
        isBusy: true,
        statusMessage: "Downloading installer...",
        lastError: undefined,
      };

      try {
        const response = await request("download", { update });
        if (!response?.state) {
          throw new Error(response?.message ?? "The Rust update bridge returned no download state.");
        }
        state = { ...response.state, isBusy: false };
        return {
          success: response.success === true,
          state: getState(),
          message: response.message,
          filePath: response.filePath,
          isDigestVerified: response.isDigestVerified === true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to download the update.";
        state = {
          ...state,
          status: UPDATE_STATUS.UPDATE_AVAILABLE,
          isBusy: false,
          statusMessage: `Version ${update.displayVersion} is available.`,
          lastError: message,
        };
        return failureResult(state, message);
      }
    });
  }

  async function install() {
    const downloaded = state.downloadedInstallerPath ? getState() : await download();
    if (!downloaded.success || !downloaded.state.downloadedInstallerPath) {
      return downloaded;
    }

    return runExclusive(async () => {
      try {
        const response = await request("install", {
          update: downloaded.state.availableUpdate,
          filePath: downloaded.state.downloadedInstallerPath,
        });
        if (!response?.state) {
          throw new Error(response?.message ?? "The Rust update bridge returned no install state.");
        }
        state = { ...response.state, isBusy: false };
        return {
          success: response.success === true,
          state: getState(),
          message: response.message,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start the update installer.";
        state = { ...state, isBusy: false, lastError: message };
        return failureResult(state, message);
      }
    });
  }

  return {
    getState,
    check,
    download,
    install,
  };
}

module.exports = {
  UPDATE_STATUS,
  createUpdateService,
  defaultUpdateState,
  getUpdaterCommand,
  runUpdater,
  updaterBinaryName,
};
