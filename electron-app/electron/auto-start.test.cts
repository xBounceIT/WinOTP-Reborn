const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createLoginItemSettings, getAutoStartStatus, setAutoStart } = require("./auto-start.cjs");

test("creates a hidden packaged Windows login item", () => {
  assert.deepEqual(
    createLoginItemSettings({
      enabled: true,
      isPackaged: true,
      appPath: "C:\\Program Files\\WinOTP",
      execPath: "C:\\Program Files\\WinOTP\\WinOTP.exe",
      platform: "win32",
    }),
    {
      openAtLogin: true,
      path: "C:\\Program Files\\WinOTP\\WinOTP.exe",
      args: ["--hidden"],
      name: "WinOTP_Reborn",
    },
  );
});

test("keeps development auto-start pointed at the Electron app", () => {
  assert.deepEqual(
    createLoginItemSettings({
      enabled: true,
      isPackaged: false,
      appPath: "C:\\work\\WinOTP-Reborn\\electron-app",
      execPath: "C:\\tools\\electron.exe",
      platform: "win32",
    }),
    {
      openAtLogin: true,
      path: "C:\\tools\\electron.exe",
      args: ["C:\\work\\WinOTP-Reborn\\electron-app", "--hidden"],
      name: "WinOTP_Reborn",
    },
  );
});

test("updates and verifies the operating system auto-start state", () => {
  let loginItemSettings = { openAtLogin: false };
  const calls = [];
  const lookups = [];
  const app = {
    isPackaged: true,
    setLoginItemSettings(settings) {
      calls.push(settings);
      loginItemSettings = settings;
    },
    getLoginItemSettings(options) {
      lookups.push(options);
      return loginItemSettings;
    },
  };

  assert.deepEqual(
    getAutoStartStatus(app, {
      platform: "win32",
      execPath: "C:\\WinOTP\\WinOTP.exe",
    }),
    { success: true, enabled: false },
  );
  assert.deepEqual(
    setAutoStart(app, true, {
      platform: "win32",
      execPath: "C:\\WinOTP\\WinOTP.exe",
    }),
    { success: true, enabled: true },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(lookups, [
    { path: "C:\\WinOTP\\WinOTP.exe", args: ["--hidden"] },
    { path: "C:\\WinOTP\\WinOTP.exe", args: ["--hidden"] },
  ]);
  assert.deepEqual(
    setAutoStart(app, false, {
      platform: "win32",
      execPath: "C:\\WinOTP\\WinOTP.exe",
    }),
    {
      success: true,
      enabled: false,
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    openAtLogin: false,
    path: "C:\\WinOTP\\WinOTP.exe",
    args: ["--hidden"],
    name: "WinOTP_Reborn",
  });
});

test("recognizes the argument-less v1 Windows login item", () => {
  const app = {
    getLoginItemSettings() {
      return {
        openAtLogin: false,
        executableWillLaunchAtLogin: true,
      };
    },
  };

  assert.deepEqual(
    getAutoStartStatus(app, {
      platform: "win32",
      execPath: "C:\\WinOTP_Reborn\\WinOTP.exe",
    }),
    { success: true, enabled: true },
  );
});

test("reports a Windows login item disabled by the operating system as disabled", () => {
  const app = {
    getLoginItemSettings() {
      return {
        openAtLogin: true,
        executableWillLaunchAtLogin: false,
      };
    },
  };

  assert.deepEqual(
    getAutoStartStatus(app, {
      platform: "win32",
      execPath: "C:\\WinOTP_Reborn\\WinOTP.exe",
    }),
    { success: true, enabled: false },
  );
});

test("reports OS auto-start failures without changing renderer state", () => {
  assert.deepEqual(setAutoStart({}, true, { platform: "win32" }), {
    success: false,
    enabled: false,
    message: "Unable to enable auto-start with the operating system.",
  });
  assert.deepEqual(setAutoStart({}, "true", { platform: "win32" }), {
    success: false,
    enabled: false,
    message: "Auto-start must be configured with a boolean value.",
  });
});
