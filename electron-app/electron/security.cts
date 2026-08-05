const path = require("node:path");
const { fileURLToPath } = require("node:url");

function isTrustedRendererEvent(event, mainWindow) {
  return Boolean(
    mainWindow &&
    event?.sender === mainWindow.webContents &&
    event?.senderFrame === mainWindow.webContents.mainFrame,
  );
}

function isRendererUnlockedState(rendererUnlocked, trayState) {
  return rendererUnlocked === true && trayState?.locked === false;
}

function hasConfiguredProtection(settings) {
  return Boolean(
    settings?.pinProtection === true ||
    settings?.passwordProtection === true ||
    settings?.windowsHello === true,
  );
}

function isUnprotectedProfile(settings, migrationPending = false) {
  return migrationPending !== true && !hasConfiguredProtection(settings);
}

function isTrustedScreenCaptureEvent(event, captureWebContents) {
  return Boolean(
    captureWebContents?.has(event?.sender) && event?.senderFrame === event.sender.mainFrame,
  );
}

function isLoopbackRendererUrl(url) {
  let target;

  try {
    target = new URL(url);
  } catch {
    return false;
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  return (
    (target.protocol === "http:" || target.protocol === "https:") &&
    loopbackHosts.has(target.hostname) &&
    !target.username &&
    !target.password
  );
}

function shouldUseDevelopmentRenderer({ isPackaged, isDevelopment, rendererUrl }) {
  return !isPackaged && isDevelopment === true && isLoopbackRendererUrl(rendererUrl);
}

function isAllowedExternalUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  let target;
  try {
    target = new URL(value);
  } catch {
    return false;
  }

  return (
    (target.protocol === "http:" || target.protocol === "https:") &&
    !target.username &&
    !target.password
  );
}

function isAllowedRendererUrl(url, { isDev, rendererUrl, rendererFilePath }) {
  let target;

  try {
    target = new URL(url);
  } catch {
    return false;
  }

  if (!isDev) {
    if (target.protocol !== "file:" || target.host !== "" || !rendererFilePath) {
      return false;
    }

    try {
      return path.resolve(fileURLToPath(target)) === path.resolve(rendererFilePath);
    } catch {
      return false;
    }
  }

  let expected;
  try {
    expected = new URL(rendererUrl);
  } catch {
    return false;
  }

  return isLoopbackRendererUrl(rendererUrl) && target.origin === expected.origin;
}

module.exports = {
  isAllowedRendererUrl,
  isAllowedExternalUrl,
  hasConfiguredProtection,
  isUnprotectedProfile,
  isLoopbackRendererUrl,
  isRendererUnlockedState,
  shouldUseDevelopmentRenderer,
  isTrustedScreenCaptureEvent,
  isTrustedRendererEvent,
};
