const hiddenLaunchArgument = "--hidden";
const windowsLoginItemName = "WinOTP_Reborn";

function createLoginItemSettings({
  enabled,
  isPackaged,
  appPath,
  execPath,
  platform = process.platform,
}) {
  const settings = { openAtLogin: enabled };

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

function unavailableResult(message, enabled = false) {
  return {
    success: false,
    enabled,
    message,
  };
}

function getAutoStartStatus(app, options = {}) {
  try {
    const platform = options.platform ?? process.platform;
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

function setAutoStart(app, enabled, options = {}) {
  if (typeof enabled !== "boolean") {
    return unavailableResult("Auto-start must be configured with a boolean value.");
  }

  try {
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
  getAutoStartStatus,
  setAutoStart,
};
