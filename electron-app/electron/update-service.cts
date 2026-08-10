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
  const candidates = [
    path.resolve(__dirname, "..", "..", ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(path.join(candidate, "rust", "Cargo.toml"))) ??
    candidates[0]
  );
}

function getUpdaterCommand({
  app,
  environment = process.env,
  platform = process.platform,
}: any = {}) {
  const configuredPath = environment.WINOTP_UPDATER_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) {
    return { command: configuredPath, args: [] };
  }

  if (app?.isPackaged) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (!resourcesPath) {
      return undefined;
    }
    const packagedPath = path.join(resourcesPath, "updater", updaterBinaryName(platform));
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

function shouldQuitAfterUpdateInstall(platform, result) {
  return platform === "win32" && result?.success === true;
}

function getLinuxPackageType({
  platform = process.platform,
  environment = process.env,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  readFileSync = fs.readFileSync,
}: any = {}) {
  if (platform !== "linux") {
    return undefined;
  }

  if (typeof environment?.APPIMAGE === "string" && environment.APPIMAGE.trim()) {
    return "appimage";
  }

  if (typeof resourcesPath === "string" && resourcesPath.trim()) {
    try {
      const packageType = String(readFileSync(path.join(resourcesPath, "package-type"), "utf8"))
        .trim()
        .toLowerCase();
      if (packageType === "deb" || packageType === "rpm") {
        return packageType;
      }
    } catch {
      // Development and legacy AppImage builds do not carry a package marker.
    }
  }

  return "appimage";
}

function isLinuxManualInstallReady(platform, environment, result) {
  return (
    platform === "linux" &&
    typeof environment?.APPIMAGE === "string" &&
    environment.APPIMAGE.trim().length > 0 &&
    result?.success === true &&
    typeof result?.state?.downloadedInstallerPath === "string" &&
    result.state.downloadedInstallerPath.trim().length > 0
  );
}

function runUpdater(request, options: any = {}) {
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

  return new Promise<any>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
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
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stdoutBytes += bytes.length;
      if (stdoutBytes > MAX_UPDATER_OUTPUT_BYTES) {
        settle(reject, new Error("The Rust update bridge returned too much output."));
        child.kill();
        return;
      }
      stdoutChunks.push(bytes);
    });
    child.stderr?.on("data", (chunk) => {
      if (settled) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stderrBytes += bytes.length;
      if (stderrBytes > MAX_UPDATER_OUTPUT_BYTES) {
        settle(reject, new Error("The Rust update bridge returned too much diagnostic output."));
        child.kill();
        return;
      }
      stderrChunks.push(bytes);
    });
    child.once("error", (error) => settle(reject, error));
    child.once("close", () => {
      if (settled) {
        return;
      }
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8");
      const stderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8");
      const serialized = stdout.trim();
      if (!serialized) {
        const detail = stderr.trim();
        settle(
          reject,
          new Error(
            detail
              ? `The Rust update bridge failed: ${detail}`
              : "The Rust update bridge returned no response.",
          ),
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

function createUpdateService({
  app,
  environment = process.env,
  platform = process.platform,
  spawnProcess = spawn,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  readFileSync = fs.readFileSync,
}: any = {}) {
  const currentVersion = String(app?.getVersion?.() ?? "0.0.0");
  const updatesDirectory = path.join(
    getAppDataDirectory(app, { environment, platform }),
    "Updates",
  );
  let state = defaultUpdateState(currentVersion);
  let operationPromise;
  const linuxPackageType = getLinuxPackageType({
    platform,
    environment,
    resourcesPath,
    readFileSync,
  });

  function getState() {
    return cloneState(state);
  }

  function request(command, options: any = {}) {
    return runUpdater(
      {
        command,
        currentVersion,
        channel: options.channel ?? state.selectedChannel,
        platform,
        architecture: process.arch,
        linuxPackageType,
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
          throw new Error(
            response?.message ?? "The Rust update bridge returned no download state.",
          );
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
    if (!state.downloadedInstallerPath) {
      const downloaded = await download();
      if (!downloaded.success || !downloaded.state.downloadedInstallerPath) {
        return downloaded;
      }
    }
    const downloadedState = getState();

    return runExclusive(async () => {
      try {
        const response = await request("install", {
          update: downloadedState.availableUpdate,
          filePath: downloadedState.downloadedInstallerPath,
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
        const message =
          error instanceof Error ? error.message : "Unable to start the update installer.";
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
  getRepositoryRoot,
  getUpdaterCommand,
  getLinuxPackageType,
  isLinuxManualInstallReady,
  runUpdater,
  shouldQuitAfterUpdateInstall,
  updaterBinaryName,
};
