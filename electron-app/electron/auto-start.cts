const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const hiddenLaunchArgument = "--hidden";
const windowsLoginItemName = "WinOTP_Reborn";
const linuxAutostartDirectoryName = "autostart";
const linuxAutostartFileName = "WinOTP_Reborn.desktop";

function quoteDesktopExecArgument(value) {
  const argument = String(value);
  if ([...argument].some((character) => character.charCodeAt(0) < 0x20 || character === "\u007f")) {
    throw new Error("The Linux auto-start executable path contains control characters.");
  }
  return `"${argument.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function createLoginItemSettings({
  enabled,
  isPackaged,
  appPath,
  execPath,
  platform = process.platform,
}: any) {
  const settings: any = { openAtLogin: enabled };

  if (platform === "darwin") {
    settings.openAsHidden = enabled;
  }

  if (platform === "win32") {
    settings.path = execPath;
    settings.args = isPackaged ? [hiddenLaunchArgument] : [appPath, hiddenLaunchArgument];
    settings.name = windowsLoginItemName;
  }

  return settings;
}

function createLinuxAutostartEntry({ enabled, isPackaged, appPath, execPath }: any) {
  const resolvedExecPath = typeof execPath === "string" ? execPath : "";
  const resolvedAppPath = typeof appPath === "string" ? appPath : "";
  if (!resolvedExecPath || (!isPackaged && !resolvedAppPath)) {
    throw new Error("The Linux auto-start executable path is unavailable.");
  }

  const command = [resolvedExecPath, ...(isPackaged ? [] : [resolvedAppPath]), hiddenLaunchArgument]
    .map(quoteDesktopExecArgument)
    .join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=WinOTP",
    `Exec=${command}`,
    "Terminal=false",
    `X-GNOME-Autostart-enabled=${enabled ? "true" : "false"}`,
    "\n",
  ].join("\n");
}

function getLinuxAutostartPath(app, options: any = {}) {
  const appDataPath = options.appDataPath ?? app.getPath?.("appData");
  if (typeof appDataPath !== "string" || !appDataPath) {
    throw new Error("The Linux auto-start configuration path is unavailable.");
  }
  return path.join(appDataPath, linuxAutostartDirectoryName, linuxAutostartFileName);
}

function getLinuxAutostartEntry(app, options: any = {}, enabled = true) {
  return createLinuxAutostartEntry({
    enabled,
    isPackaged: options.isPackaged ?? app.isPackaged,
    appPath: options.appPath,
    execPath: options.execPath ?? process.execPath,
  });
}

function writeFileAtomically(filePath, contents) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );

  try {
    fs.writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The destination may already have been replaced successfully.
    }
  }
}

function getLinuxAutoStartStatus(app, options: any = {}) {
  const filePath = getLinuxAutostartPath(app, options);
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { success: true, enabled: false };
    }
    throw error;
  }

  return {
    success: true,
    enabled: contents === getLinuxAutostartEntry(app, options),
  };
}

function setLinuxAutoStart(app, enabled, options: any = {}) {
  const filePath = getLinuxAutostartPath(app, options);
  if (enabled) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeFileAtomically(filePath, getLinuxAutostartEntry(app, options));
  } else {
    fs.rmSync(filePath, { force: true });
  }

  const status = getLinuxAutoStartStatus(app, options);
  if (status.enabled !== enabled) {
    return unavailableResult(
      `The operating system did not ${enabled ? "enable" : "disable"} auto-start.`,
      status.enabled,
    );
  }
  return status;
}

function unavailableResult(message, enabled = false) {
  return {
    success: false,
    enabled,
    message,
  };
}

function getAutoStartStatus(app, options: any = {}) {
  try {
    const platform = options.platform ?? process.platform;
    if (platform === "linux") {
      return getLinuxAutoStartStatus(app, options);
    }

    const loginItemSettings = createLoginItemSettings({
      enabled: true,
      isPackaged: options.isPackaged ?? app.isPackaged,
      appPath: options.appPath,
      execPath: options.execPath ?? process.execPath,
      platform,
    });
    const settingsOptions =
      platform === "win32"
        ? { path: loginItemSettings.path, args: loginItemSettings.args }
        : undefined;

    const loginItem = app.getLoginItemSettings(settingsOptions);
    return {
      success: true,
      enabled: Boolean(
        platform === "win32"
          ? (loginItem.executableWillLaunchAtLogin ?? loginItem.openAtLogin)
          : loginItem.openAtLogin,
      ),
    };
  } catch {
    return unavailableResult("The operating system auto-start service is unavailable.");
  }
}

function setAutoStart(app, enabled, options: any = {}) {
  if (typeof enabled !== "boolean") {
    return unavailableResult("Auto-start must be configured with a boolean value.");
  }

  try {
    if ((options.platform ?? process.platform) === "linux") {
      return setLinuxAutoStart(app, enabled, options);
    }

    app.setLoginItemSettings(
      createLoginItemSettings({
        enabled,
        isPackaged: options.isPackaged ?? app.isPackaged,
        appPath: options.appPath,
        execPath: options.execPath ?? process.execPath,
        platform: options.platform,
      }),
    );

    const status = getAutoStartStatus(app, options);
    if (!status.success) {
      return status;
    }

    if (status.enabled !== enabled) {
      return unavailableResult(
        `The operating system did not ${enabled ? "enable" : "disable"} auto-start.`,
        status.enabled,
      );
    }

    return status;
  } catch {
    return unavailableResult(
      `Unable to ${enabled ? "enable" : "disable"} auto-start with the operating system.`,
    );
  }
}

module.exports = {
  createLoginItemSettings,
  createLinuxAutostartEntry,
  getLinuxAutostartPath,
  getAutoStartStatus,
  setAutoStart,
};
