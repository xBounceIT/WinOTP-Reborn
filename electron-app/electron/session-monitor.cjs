const {
  runPowerShellScript,
  serializeWindowHandle,
} = require("./windows-hello.cjs");

const SESSION_CHANGE_WINDOW_MESSAGE = 0x02b1;
const SESSION_NOTIFICATION_FLAGS = Object.freeze({
  consoleConnect: 0x1,
  consoleDisconnect: 0x2,
  remoteConnect: 0x3,
  remoteDisconnect: 0x4,
});
const SESSION_CHANGE_REASONS = new Map([
  [SESSION_NOTIFICATION_FLAGS.consoleConnect, "console-connect"],
  [SESSION_NOTIFICATION_FLAGS.consoleDisconnect, "console-disconnect"],
  [SESSION_NOTIFICATION_FLAGS.remoteConnect, "remote-connect"],
  [SESSION_NOTIFICATION_FLAGS.remoteDisconnect, "remote-disconnect"],
]);
const SESSION_NOTIFICATION_TIMEOUT_MS = 5_000;

const WINDOWS_SESSION_NOTIFICATION_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;

public static class WinOtpSessionNotificationBridge
{
    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WTSRegisterSessionNotification(IntPtr windowHandle, uint flags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WTSUnRegisterSessionNotification(IntPtr windowHandle);
}
`;

const WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
${WINDOWS_SESSION_NOTIFICATION_SOURCE}
'@

$windowHandle = [IntPtr]([long]__WINOTP_WINDOW_HANDLE__)
if (-not [WinOtpSessionNotificationBridge]::WTSRegisterSessionNotification($windowHandle, 0)) {
    throw "WTSRegisterSessionNotification failed."
}

[Console]::WriteLine((@{ ok = $true; status = "registered" } | ConvertTo-Json -Compress))
`;

const WINDOWS_UNREGISTER_SESSION_NOTIFICATION_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
${WINDOWS_SESSION_NOTIFICATION_SOURCE}
'@

$windowHandle = [IntPtr]([long]__WINOTP_WINDOW_HANDLE__)
if (-not [WinOtpSessionNotificationBridge]::WTSUnRegisterSessionNotification($windowHandle)) {
    throw "WTSUnRegisterSessionNotification failed."
}

[Console]::WriteLine((@{ ok = $true; status = "unregistered" } | ConvertTo-Json -Compress))
`;

function getSessionChangeCode(wParam) {
  if (!Buffer.isBuffer(wParam) || wParam.length < 4) {
    return undefined;
  }

  return wParam.readUInt32LE(0);
}

function isRelevantSessionChangeCode(code) {
  return SESSION_CHANGE_REASONS.has(code);
}

function getSessionChangeReason(code) {
  return SESSION_CHANGE_REASONS.get(code);
}

function buildSessionNotificationScript(template, windowHandle) {
  const serializedHandle = serializeWindowHandle(windowHandle);
  if (!serializedHandle) {
    return undefined;
  }

  return template.replace("__WINOTP_WINDOW_HANDLE__", serializedHandle);
}

async function runSessionNotificationScript(template, windowHandle, options = {}) {
  const script = buildSessionNotificationScript(template, windowHandle);
  if (!script) {
    return { ok: false, error: "The native window handle is unavailable." };
  }

  const runScript = options.runScript ?? runPowerShellScript;
  return runScript(script, {
    ...options,
    timeoutMs: options.timeoutMs ?? SESSION_NOTIFICATION_TIMEOUT_MS,
  });
}

function registerSessionNotification(windowHandle, options = {}) {
  return runSessionNotificationScript(
    WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT,
    windowHandle,
    options,
  );
}

function unregisterSessionNotification(windowHandle, options = {}) {
  return runSessionNotificationScript(
    WINDOWS_UNREGISTER_SESSION_NOTIFICATION_SCRIPT,
    windowHandle,
    options,
  );
}

module.exports = {
  SESSION_CHANGE_WINDOW_MESSAGE,
  SESSION_NOTIFICATION_FLAGS,
  SESSION_NOTIFICATION_TIMEOUT_MS,
  WINDOWS_REGISTER_SESSION_NOTIFICATION_SCRIPT,
  WINDOWS_UNREGISTER_SESSION_NOTIFICATION_SCRIPT,
  buildSessionNotificationScript,
  getSessionChangeCode,
  getSessionChangeReason,
  isRelevantSessionChangeCode,
  registerSessionNotification,
  unregisterSessionNotification,
};
