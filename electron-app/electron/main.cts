const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray,
} = require("electron");
const path = require("node:path");
const { createDisplayCapturePlan, getThumbnailSize } = require("./screen-capture.cjs");
const { AccountStore, normalizeAccounts, sanitizeAccount } = require("./account-store.cjs");
const { createAccountStoreLoader } = require("./account-store-loader.cjs");
const { saveAccountBatch } = require("./account-batch-save.cjs");
const { BackupStore } = require("./backup-store.cjs");
const { SecurityStore } = require("./security-store.cjs");
const {
  createUpdateService,
  defaultUpdateState,
  shouldQuitAfterUpdateInstall,
} = require("./update-service.cjs");
const { SettingsStore, normalizeSettings } = require("./settings-store.cjs");
const {
  completeLegacySettingsMigration,
  migrateLegacySettingsForApp,
  runLegacyMigration,
} = require("./legacy-migration.cjs");
const { getWindowsHelloAvailability, verifyWindowsHello } = require("./windows-hello.cjs");
const { configureUserDataPath, getIconPath, getRendererFilePath } = require("./app-paths.cjs");
const {
  createTotpPreviewRunner,
  generateTotpCode,
  generateTotpCodes,
  generateTotpPreviews,
} = require("./totp.cjs");
const { getAutoStartStatus, setAutoStart } = require("./auto-start.cjs");
const { runRustCore, runRustCoreAsync } = require("./rust-core.cjs");
const { startSessionChangeWatcher } = require("./session-monitor.cjs");
const {
  isAllowedRendererUrl,
  isAllowedExternalUrl,
  hasConfiguredProtection,
  isSecurityMigrationPending: isSecurityMigrationPendingState,
  isUnprotectedProfile,
  isLoopbackRendererUrl,
  isRendererUnlockedState,
  shouldUseDevelopmentRenderer,
  isTrustedScreenCaptureEvent,
  isTrustedRendererEvent,
} = require("./security.cjs");

const { createTrayController, orderAccountsByIds } = require("./tray.cjs");

let mainWindow;
let trayController;
let sessionChangeWatcher;
let rendererUnlocked = false;
let screenCaptureRequest;
let screenCaptureInProgress = false;
let screenCaptureCancellationVersion = 0;
let securityStore;
let updateService;
let settingsStore;
let legacySettingsMigrationFailed = false;
let legacyAppLockMigrationPending = false;
let settingsRecoveryRequired = false;
let windowsHelloOperationInProgress = false;
let isQuitting = false;
const runTotpPreviews = createTotpPreviewRunner(generateTotpPreviews);
const titleBarHeight = 32;
const defaultTitleBarTheme = {
  color: "#000000",
  symbolColor: "#ffffff",
};

configureUserDataPath(app);

function isStartedHidden() {
  return process.argv.includes("--hidden");
}

function getAutoStartOptions() {
  const execPath =
    process.platform === "linux" && app.isPackaged ? process.env.APPIMAGE : process.execPath;
  return {
    appPath: app.isPackaged ? undefined : app.getAppPath(),
    isPackaged: app.isPackaged,
    execPath,
  };
}

function isHexColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value);
}

function updateTitleBarTheme(theme: any = {}) {
  if (!mainWindow || typeof mainWindow.setTitleBarOverlay !== "function") {
    return;
  }

  const safeTheme = theme && typeof theme === "object" ? theme : {};
  const color = isHexColor(safeTheme.color) ? safeTheme.color : defaultTitleBarTheme.color;
  const symbolColor = isHexColor(safeTheme.symbolColor)
    ? safeTheme.symbolColor
    : defaultTitleBarTheme.symbolColor;

  mainWindow.setTitleBarOverlay({
    color,
    symbolColor,
    height: titleBarHeight,
  });
}

function isDevelopment() {
  return process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL);
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) {
      createWindow();
    }
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function getAccountLabel(account) {
  const issuer = String(account?.issuer ?? "").trim();
  const accountName = String(account?.accountName ?? "").trim();
  if (issuer && accountName) {
    return `${issuer} (${accountName})`;
  }

  return issuer || accountName || "Account";
}

function loadStoredAccounts() {
  try {
    return accountStoreLoader.get()?.readAccounts().accounts ?? [];
  } catch (error) {
    accountStoreLoader.close();
    console.error("Failed to refresh accounts for the tray menu.", error);
    return undefined;
  }
}

function isValidTrayTotpCode(code, digits) {
  const expectedDigits = digits === 8 ? 8 : 6;
  return typeof code === "string" && new RegExp(`^\\d{${expectedDigits}}$`).test(code);
}

function refreshTrayCodes() {
  const state = trayController?.getState();
  if (!state || !state.showTotpInTray || state.locked || !isRendererUnlocked()) {
    return;
  }

  const storedAccounts = loadStoredAccounts();
  if (!storedAccounts) {
    return;
  }

  const orderedStoredAccounts = orderAccountsByIds(
    storedAccounts,
    state.accounts.map((account) => account.id),
  );
  const codes = generateTotpCodes(orderedStoredAccounts);

  trayController.setState({
    ...state,
    accounts: orderedStoredAccounts.map((account, index) => ({
      id: account.id,
      label: getAccountLabel(account),
      code: codes[index] ?? "—".repeat(account.digits === 8 ? 8 : 6),
    })),
  });
}

function copyTrayCode(accountId) {
  const state = trayController?.getState();
  if (!state || !state.showTotpInTray || state.locked || !isRendererUnlocked()) {
    return;
  }

  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  const storedAccounts = loadStoredAccounts();
  if (!storedAccounts) {
    return;
  }
  const storedAccount = storedAccounts.find((item) => item.id === account.id);
  if (!storedAccount) {
    return;
  }
  const currentCode = generateTotpCode(storedAccount);
  if (!isValidTrayTotpCode(currentCode, storedAccount.digits)) {
    return;
  }

  try {
    clipboard.writeText(currentCode);
  } catch (error) {
    console.error("Failed to copy a TOTP code from the tray menu.", error);
    return;
  }

  try {
    const store = accountStoreLoader.get();
    const result = store?.recordUsage(account.id);
    if (result?.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tray-usage-recorded", {
        id: account.id,
        usageCount: result.usageCount,
        lastUsedAt: result.lastUsedAt,
      });
    }
  } catch (error) {
    console.error("Failed to record tray code usage.", error);
  }
}

function updateTrayState(event, state) {
  if (!isTrustedRendererEvent(event, mainWindow)) {
    return;
  }

  if (state?.locked === true) {
    rendererUnlocked = false;
  }

  const nextState = state && typeof state === "object" ? state : {};
  const canShowUnlockedState = rendererUnlocked || isCurrentProfileUnprotected();
  trayController?.setState(
    canShowUnlockedState ? nextState : { ...nextState, locked: true, accounts: [] },
  );
}

function isRendererUnlocked() {
  const trayState = trayController?.getState();
  return (
    isRendererUnlockedState(rendererUnlocked, trayState) ||
    (trayState?.locked === false && isCurrentProfileUnprotected())
  );
}

function isSecurityMigrationPending() {
  return (
    isSecurityMigrationPendingState(legacySettingsMigrationFailed, legacyAppLockMigrationPending) ||
    settingsRecoveryRequired
  );
}

function isCurrentProfileUnprotected() {
  try {
    return isUnprotectedProfile(getSettingsStore().getSettings(), isSecurityMigrationPending());
  } catch {
    return false;
  }
}

function clearRendererUnlockState() {
  rendererUnlocked = false;
  const trayState = trayController?.getState();
  if (trayState) {
    trayController.setState({ ...trayState, locked: true, accounts: [] });
  }
}

function notifyRendererOfSessionChange(reason) {
  clearRendererUnlockState();
  cancelActiveScreenCapture();

  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("session-changed", { reason });
}

function registerSessionChangeMonitoring() {
  // Electron owns the BrowserWindow message loop. The Rust sidecar cannot
  // register WTS notifications for that HWND, so use Electron's in-process
  // power/session events for lock and resume handling.
  for (const eventName of ["lock-screen", "unlock-screen", "suspend", "resume"]) {
    powerMonitor.on(eventName, () => notifyRendererOfSessionChange(eventName));
  }

  if (process.platform === "win32") {
    // Remote Desktop connect/disconnect transitions do not raise Electron
    // power events; stream them from a hidden watcher window owned by the
    // Rust sidecar so the app locks on session changes.
    sessionChangeWatcher = startSessionChangeWatcher({
      onSessionChange: (reason) => notifyRendererOfSessionChange(reason),
      onError: (error) => {
        console.error("Windows session-change monitoring failed.", error);
      },
    });
  }
}

function loadRenderer(window, query: Record<string, string> = {}) {
  const configuredRendererUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (
    shouldUseDevelopmentRenderer({
      isPackaged: app.isPackaged,
      isDevelopment: process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL),
      rendererUrl: configuredRendererUrl,
    })
  ) {
    const rendererUrl = new URL(configuredRendererUrl);
    Object.entries(query).forEach(([key, value]) => {
      rendererUrl.searchParams.set(key, value);
    });
    return window.loadURL(rendererUrl.toString());
  }

  return window.loadFile(getRendererFilePath(__dirname), { query });
}

async function captureDisplays() {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) {
    return undefined;
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: getThumbnailSize(displays),
    fetchWindowIcons: false,
  });
  const capturePlan = createDisplayCapturePlan(displays, sources);
  const displayCount = capturePlan[0]?.displayCount ?? 0;

  const capturedDisplays = capturePlan.flatMap((entry) => {
    const { source } = entry;
    const thumbnail = source?.thumbnail;
    if (!thumbnail || thumbnail.isEmpty()) {
      return [];
    }

    const pixelSize = thumbnail.getSize();
    if (pixelSize.width < 1 || pixelSize.height < 1) {
      return [];
    }

    return [
      {
        id: entry.id,
        bounds: entry.bounds,
        scaleFactor: entry.scaleFactor,
        displayIndex: entry.displayIndex,
        displayCount: entry.displayCount,
        dataUrl: thumbnail.toDataURL(),
      },
    ];
  });

  if (capturedDisplays.length === 0 || capturedDisplays.length !== displayCount) {
    return undefined;
  }

  return { displays: capturedDisplays };
}

function createScreenCaptureWindow(display) {
  const captureWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    useContentSize: true,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    focusable: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#000000",
    title: "WinOTP Screen Capture",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  captureWindow.setAlwaysOnTop(true, "screen-saver");
  captureWindow.on("closed", () => {
    if (screenCaptureRequest?.windows.has(captureWindow) && !screenCaptureRequest.settled) {
      settleScreenCapture({ status: "cancelled" });
    }
  });

  return captureWindow;
}

function applyScreenCaptureWindowBounds(captureWindow, display) {
  if (captureWindow.isDestroyed()) {
    return;
  }

  // Display.bounds is the complete display rectangle in Electron's DIP
  // coordinate space. Reapply it after showing the window because Windows can
  // otherwise restore a hidden window to the monitor work area, leaving the
  // taskbar outside the overlay on mixed-height monitor layouts.
  captureWindow.setContentBounds(display.bounds);
  captureWindow.setAlwaysOnTop(true, "screen-saver");
  if (typeof captureWindow.moveTop === "function") {
    captureWindow.moveTop();
  }
}

function prepareScreenCaptureWindow(captureWindow, capture) {
  let loadSettled = false;
  let resolveLoad;
  let rejectLoad;
  const loadPromise = new Promise((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });

  const cleanup = () => {
    captureWindow.webContents.removeListener("did-finish-load", onFinishLoad);
    captureWindow.webContents.removeListener("did-fail-load", onFailLoad);
    captureWindow.webContents.removeListener("render-process-gone", onRenderProcessGone);
    captureWindow.removeListener("closed", onClosed);
  };

  const failLoad = (error) => {
    if (loadSettled) {
      return;
    }

    loadSettled = true;
    cleanup();
    rejectLoad(error);
  };

  const onFinishLoad = () => {
    if (loadSettled) {
      return;
    }

    if (captureWindow.isDestroyed()) {
      failLoad(new Error("Screen capture overlay was destroyed while loading"));
      return;
    }

    try {
      captureWindow.webContents.send("screen-capture-ready", capture);
    } catch (error) {
      failLoad(error);
      return;
    }

    loadSettled = true;
    resolveLoad();
  };

  const onFailLoad = (_loadEvent, errorCode, errorDescription) => {
    failLoad(
      new Error(`Screen capture overlay failed to load (${errorCode}): ${errorDescription}`),
    );
  };

  const onRenderProcessGone = (_goneEvent, details) => {
    const error = new Error(`Screen capture overlay exited (${details?.reason || "unknown"})`);
    if (!loadSettled) {
      failLoad(error);
      return;
    }

    settleScreenCapture({ status: "failed" });
  };

  const onClosed = () => {
    failLoad(new Error("Screen capture overlay was closed while loading"));
  };

  captureWindow.webContents.once("did-finish-load", onFinishLoad);
  captureWindow.webContents.once("did-fail-load", onFailLoad);
  captureWindow.webContents.on("render-process-gone", onRenderProcessGone);
  captureWindow.once("closed", onClosed);

  return { loadPromise, cleanup };
}

function normalizeScreenCaptureResult(value) {
  if (!value || typeof value.status !== "string") {
    return { status: "failed" };
  }

  if (value.status === "success") {
    if (typeof value.text !== "string") {
      return { status: "failed" };
    }

    const text = value.text.trim();
    return text.length > 0
      ? { status: "success", text: text.slice(0, 8192) }
      : { status: "failed" };
  }

  if (value.status === "cancelled" || value.status === "no-qr-code") {
    return { status: value.status };
  }

  return { status: "failed" };
}

function settleScreenCapture(result) {
  if (!screenCaptureRequest || screenCaptureRequest.settled) {
    return;
  }

  screenCaptureRequest.settled = true;
  screenCaptureRequest.resolve(normalizeScreenCaptureResult(result));
}

function closeScreenCaptureWindows(windows) {
  windows.forEach((captureWindow) => {
    if (!captureWindow.isDestroyed()) {
      captureWindow.close();
    }
  });
}

function cancelActiveScreenCapture() {
  screenCaptureCancellationVersion += 1;
  const request = screenCaptureRequest;
  if (!request || request.settled) {
    return;
  }

  settleScreenCapture({ status: "cancelled" });
  closeScreenCaptureWindows(request.windows);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureScreen(event) {
  if (
    !isTrustedRendererEvent(event, mainWindow) ||
    !isRendererUnlocked() ||
    screenCaptureRequest ||
    screenCaptureInProgress
  ) {
    return { status: "failed" };
  }

  const ownerWindow = mainWindow;
  const cancellationVersion = screenCaptureCancellationVersion;
  let captureWindows = [];
  let resultPromise;
  let captureRequest;
  let windowLifecycles = [];
  screenCaptureInProgress = true;

  try {
    ownerWindow.hide();
    await wait(180);
    if (cancellationVersion !== screenCaptureCancellationVersion || !isRendererUnlocked()) {
      return { status: "failed" };
    }

    const capture = await captureDisplays();
    if (
      !capture ||
      cancellationVersion !== screenCaptureCancellationVersion ||
      !isRendererUnlocked()
    ) {
      return { status: "failed" };
    }

    captureWindows = [];
    for (const display of capture.displays) {
      captureWindows.push(createScreenCaptureWindow(display));
    }
    resultPromise = new Promise((resolve) => {
      captureRequest = {
        windows: new Set(captureWindows),
        webContents: new Set(captureWindows.map((captureWindow) => captureWindow.webContents)),
        resolve,
        settled: false,
      };
      screenCaptureRequest = captureRequest;
    });

    windowLifecycles = captureWindows.map((captureWindow, displayIndex) => {
      const display = capture.displays[displayIndex];
      const lifecycle = prepareScreenCaptureWindow(captureWindow, {
        display,
      });
      return { captureWindow, display, ...lifecycle };
    });

    const overlaysReady = Promise.all(
      windowLifecycles.map(async ({ captureWindow, loadPromise }) => {
        await loadRenderer(captureWindow, { "screen-capture": "1" });
        await loadPromise;
      }),
    );
    const readyOrResult = await Promise.race([
      overlaysReady.then(() => ({ type: "ready" })),
      resultPromise.then((result) => ({ type: "result", result })),
    ]);

    if (readyOrResult.type === "result") {
      return readyOrResult.result;
    }

    if (!captureRequest.settled) {
      captureWindows.forEach((captureWindow, displayIndex) => {
        if (!captureWindow.isDestroyed()) {
          applyScreenCaptureWindowBounds(captureWindow, capture.displays[displayIndex]);
          captureWindow.show();
          applyScreenCaptureWindowBounds(captureWindow, capture.displays[displayIndex]);
        }
      });
      captureWindows.forEach((captureWindow) => {
        if (!captureWindow.isDestroyed()) {
          captureWindow.focus();
        }
      });
    }

    return await resultPromise;
  } catch {
    if (captureRequest?.settled && resultPromise) {
      return await resultPromise;
    }

    return { status: "failed" };
  } finally {
    try {
      windowLifecycles.forEach(({ cleanup }) => cleanup());

      if (screenCaptureRequest === captureRequest) {
        settleScreenCapture({ status: "failed" });
        screenCaptureRequest = undefined;
      }

      closeScreenCaptureWindows(captureWindows);

      if (!ownerWindow.isDestroyed()) {
        ownerWindow.show();
        ownerWindow.focus();
      }
    } finally {
      screenCaptureInProgress = false;
    }
  }
}

function accountStoreUnavailableResult() {
  return {
    accounts: [],
    issues: [
      {
        code: "storage-unavailable",
        accountId: "(database)",
        message: "Unable to open the local account database.",
      },
    ],
    migration: {
      status: "failed",
      importedCount: 0,
      skippedCount: 0,
      issueCount: 1,
      message: "Unable to open the local account database.",
    },
  };
}

const accountStoreLoader = createAccountStoreLoader(
  () => new AccountStore(app),
  (error) => console.error("Failed to initialize the local account database.", error),
);

let backupStore;

function initializeLegacyMigration() {
  legacySettingsMigrationFailed = false;
  legacyAppLockMigrationPending = false;
  try {
    migrateLegacySettingsForApp(app);
  } catch (error) {
    legacySettingsMigrationFailed = true;
    console.error("Failed to migrate the native WinOTP settings.", error);
  }

  try {
    securityStore = new SecurityStore(app);
  } catch (error) {
    securityStore = undefined;
    legacyAppLockMigrationPending = true;
    console.error("Failed to initialize Electron secure storage for migration.", error);
  }

  try {
    backupStore = new BackupStore(app, () => accountStoreLoader.get(), {
      encryption: safeStorage,
      skipAutomaticReconciliation: true,
    });
  } catch (error) {
    backupStore = undefined;
    console.error("Failed to initialize the backup store for migration.", error);
  }

  try {
    const migration = runLegacyMigration(app, { securityStore, backupStore });
    legacySettingsMigrationFailed ||= migration.settings.status === "failed";
    legacyAppLockMigrationPending ||= migration.appLock.status === "failed";
    if (
      migration.settings.status === "completed" &&
      migration.settings.importedCount > 0 &&
      migration.appLock.importedCount > 0
    ) {
      try {
        clearInactiveSecurityCredentialsSync(getSettingsStore().getSettings());
      } catch (error) {
        legacyAppLockMigrationPending = true;
        console.error("Failed to reconcile migrated security credentials.", error);
      }
    }
    if (migration.backupPassword.status !== "failed") {
      backupStore?.reconcileAutomaticSettings();
    }
    if (
      migration.appLock.status === "failed" ||
      migration.backupPassword.status === "failed" ||
      migration.settings.status === "failed"
    ) {
      console.warn("One or more native WinOTP settings or credentials remain to be migrated.");
    }
  } catch (error) {
    legacySettingsMigrationFailed = true;
    legacyAppLockMigrationPending = true;
    console.error("Failed to persist the native WinOTP migration state.", error);
  }
}

function getBackupStore() {
  if (!backupStore) {
    backupStore = new BackupStore(app, () => accountStoreLoader.get(), {
      encryption: safeStorage,
    });
  }
  return backupStore;
}

function getUpdateService() {
  if (!updateService) {
    updateService = createUpdateService({ app });
  }

  return updateService;
}

function updateUnavailableResult(message = "The Rust update bridge is unavailable.") {
  return {
    success: false,
    message,
    state: defaultUpdateState(app.getVersion()),
  };
}

function exposeLinuxAppImageUpdate(result) {
  if (
    process.platform !== "linux" ||
    !process.env.APPIMAGE ||
    result?.success === true ||
    typeof result?.state?.downloadedInstallerPath !== "string"
  ) {
    return result;
  }

  const installerPath = result.state.downloadedInstallerPath;
  try {
    shell.showItemInFolder(installerPath);
    return {
      ...result,
      message:
        "The update was downloaded and its folder was opened. Close WinOTP, then replace the current AppImage with the downloaded file.",
    };
  } catch (error) {
    console.error("Failed to open the downloaded AppImage folder.", error);
    return {
      ...result,
      message: `${result.message ?? "The update could not be launched."} Downloaded file: ${installerPath}`,
    };
  }
}

function registerUpdateIpc() {
  ipcMain.handle("updates:status", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return updateUnavailableResult("The renderer is not authorized.");
    }

    try {
      return { success: true, state: getUpdateService().getState() };
    } catch (error) {
      console.error("Failed to read update status.", error);
      return updateUnavailableResult();
    }
  });

  ipcMain.handle("updates:check", async (event, channel, automaticCheckEnabled) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return updateUnavailableResult("The renderer is not authorized.");
    }

    try {
      const result = await getUpdateService().check(channel, automaticCheckEnabled !== false);
      return result;
    } catch (error) {
      console.error("Failed to check for app updates.", error);
      return updateUnavailableResult();
    }
  });

  ipcMain.handle("updates:download", async (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return updateUnavailableResult("The renderer is not authorized.");
    }

    try {
      return await getUpdateService().download();
    } catch (error) {
      console.error("Failed to download the app update.", error);
      return updateUnavailableResult();
    }
  });

  ipcMain.handle("updates:install", async (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return updateUnavailableResult("The renderer is not authorized.");
    }

    try {
      const result = exposeLinuxAppImageUpdate(await getUpdateService().install());
      if (shouldQuitAfterUpdateInstall(process.platform, result)) {
        quitApp();
      }
      return result;
    } catch (error) {
      console.error("Failed to launch the app update installer.", error);
      return updateUnavailableResult();
    }
  });
}

function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = new SettingsStore(app, { recoverMalformed: true });
    settingsRecoveryRequired =
      settingsStore.recoveryRequired === true || legacySettingsMigrationFailed;
  }

  return settingsStore;
}

function settingsUnavailableResult() {
  return {
    success: false,
    message: "The settings service is unavailable.",
  };
}

function lockedSettingsResult() {
  return {
    success: false,
    message: "Unlock WinOTP before changing protection settings.",
  };
}

function credentialStatusForCore(isSet) {
  return isSet === true ? "Set" : "NotSet";
}

function helloAvailabilityForCore(status) {
  switch (status) {
    case "available":
      return "Available";
    case "remote-session":
      return "RemoteSession";
    case "unavailable":
      return "Unavailable";
    default:
      return "Error";
  }
}

function protectionInputForCore(settings, status, helloAvailability) {
  return {
    pinEnabled: settings.pinProtection === true,
    passwordEnabled: settings.passwordProtection === true,
    windowsHelloEnabled: settings.windowsHello === true,
    remotePinEnabled: settings.remotePin === true,
    remotePasswordEnabled: settings.remotePassword === true,
    pinStatus: credentialStatusForCore(status.pinSet),
    passwordStatus: credentialStatusForCore(status.passwordSet),
    windowsHelloAvailability: helloAvailabilityForCore(helloAvailability),
    remotePinStatus: credentialStatusForCore(status.remotePinSet),
    remotePasswordStatus: credentialStatusForCore(status.remotePasswordSet),
  };
}

const protectionSettingKeys = [
  "pinProtection",
  "passwordProtection",
  "windowsHello",
  "remotePin",
  "remotePassword",
];

function hasSameProtectionSettings(left, right) {
  return protectionSettingKeys.every((key) => left?.[key] === right?.[key]);
}

const settingsRecoveryCredentialKinds = new Set(["pin", "password", "remotePin", "remotePassword"]);
const remoteSettingsRecoveryCredentialKinds = new Set(["remotePin", "remotePassword"]);

function directCredentialKinds(status) {
  return [status.pinSet ? "pin" : undefined, status.passwordSet ? "password" : undefined].filter(
    Boolean,
  );
}

function credentialCleanupInput(settings) {
  return {
    pinEnabled: settings.pinProtection === true,
    passwordEnabled: settings.passwordProtection === true,
    windowsHelloEnabled: settings.windowsHello === true,
    remotePinEnabled: settings.remotePin === true,
    remotePasswordEnabled: settings.remotePassword === true,
  };
}

function removeInactiveSecurityCredentials(result) {
  if (!Array.isArray(result) || result.some((kind) => typeof kind !== "string")) {
    throw new Error("The Rust core returned invalid credential cleanup data.");
  }
  return getSecurityStore().removeCredentials(result);
}

async function clearInactiveSecurityCredentials(settings) {
  const result = await runRustCoreAsync(
    "credential-kinds-to-clear",
    credentialCleanupInput(settings),
  );
  return removeInactiveSecurityCredentials(result);
}

function clearInactiveSecurityCredentialsSync(settings) {
  const result = runRustCore("credential-kinds-to-clear", credentialCleanupInput(settings));
  return removeInactiveSecurityCredentials(result);
}

async function isRemoteWindowsHelloSession() {
  try {
    const availability = await getWindowsHelloAvailability();
    return availability.status === "remote-session";
  } catch {
    return false;
  }
}

async function authorizeSettingsRecovery(authorization: any = {}) {
  if (isRendererUnlocked()) {
    return true;
  }

  if (authorization?.kind === "windowsHello") {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    try {
      const status = getSecurityStore().getStatus();
      if (directCredentialKinds(status).length > 0) {
        return false;
      }
    } catch {
      return false;
    }

    try {
      const availability = await getWindowsHelloAvailability();
      if (availability.status !== "available") {
        return false;
      }
    } catch {
      return false;
    }

    const result = await runWindowsHelloOperation(async () =>
      verifyWindowsHello({
        windowHandle: mainWindow.getNativeWindowHandle(),
      }),
    );
    return result.success === true && result.status === "verified";
  }

  if (
    !settingsRecoveryCredentialKinds.has(authorization?.kind) ||
    typeof authorization?.secret !== "string"
  ) {
    return false;
  }

  if (
    remoteSettingsRecoveryCredentialKinds.has(authorization.kind) &&
    !(await isRemoteWindowsHelloSession())
  ) {
    return false;
  }

  try {
    const status = getSecurityStore().getStatus();
    const directKinds = directCredentialKinds(status);
    if (authorization.kind === "pin" || authorization.kind === "password") {
      if (
        settingsRecoveryRequired
          ? !directKinds.includes(authorization.kind)
          : directKinds.length !== 1 || directKinds[0] !== authorization.kind
      ) {
        return false;
      }
    } else if (directKinds.length > 0) {
      return false;
    }

    return getSecurityStore().verifyCredential(authorization.kind, authorization.secret).verified;
  } catch {
    return false;
  }
}

async function reconcileLockedProtectionSettings(settings) {
  try {
    const securityStatus = getSecurityStore().getStatus();
    const helloAvailability = await getWindowsHelloAvailability();
    const state = await runRustCoreAsync(
      "reconcile-protection",
      protectionInputForCore(settings, securityStatus, helloAvailability.status),
    );
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return undefined;
    }

    return {
      pinProtection: state.pinEnabled === true,
      passwordProtection: state.passwordEnabled === true,
      windowsHello: state.windowsHelloEnabled === true,
      remotePin: state.remotePinEnabled === true,
      remotePassword: state.remotePasswordEnabled === true,
    };
  } catch {
    return undefined;
  }
}

function registerSettingsIpc() {
  ipcMain.handle("settings:get", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return settingsUnavailableResult();
    }

    try {
      return {
        success: true,
        settings: getSettingsStore().getSettings(),
        persistable: !legacySettingsMigrationFailed,
        settingsRecoveryRequired: settingsRecoveryRequired,
        securityMigrationPending: isSecurityMigrationPending(),
      };
    } catch (error) {
      console.error("Failed to read Electron settings.", error);
      return settingsUnavailableResult();
    }
  });

  ipcMain.handle("settings:recover", async (event, authorization) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return settingsUnavailableResult();
    }

    try {
      const store = getSettingsStore();
      const legacySettingsRecoveryRequired = legacySettingsMigrationFailed;
      if (!store.recoveryRequired && !legacySettingsRecoveryRequired) {
        return settingsUnavailableResult();
      }

      if (!(await authorizeSettingsRecovery(authorization))) {
        return lockedSettingsResult();
      }

      const result = store.recoverSettings();
      if (legacySettingsRecoveryRequired) {
        completeLegacySettingsMigration(app);
        legacySettingsMigrationFailed = false;
      }
      settingsRecoveryRequired = false;
      rendererUnlocked = true;
      try {
        await clearInactiveSecurityCredentials(result.settings);
      } catch (error) {
        console.error("Failed to clear inactive credentials after settings recovery.", error);
      }
      return {
        ...result,
        persistable: !legacySettingsMigrationFailed,
        settingsRecoveryRequired,
        securityMigrationPending: isSecurityMigrationPending(),
      };
    } catch (error) {
      console.error("Failed to recover Electron settings.", error);
      return settingsUnavailableResult();
    }
  });

  ipcMain.handle("settings:save", async (event, settings) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return settingsUnavailableResult();
    }

    try {
      const store = getSettingsStore();
      const nextSettings = normalizeSettings(settings);
      const currentSettings = store.getSettings();
      if (!isRendererUnlocked()) {
        if (isSecurityMigrationPending() && hasConfiguredProtection(currentSettings)) {
          return lockedSettingsResult();
        }

        const safeProtectionSettings = await reconcileLockedProtectionSettings(currentSettings);
        if (
          !safeProtectionSettings ||
          !hasSameProtectionSettings(nextSettings, {
            ...currentSettings,
            ...safeProtectionSettings,
          })
        ) {
          return lockedSettingsResult();
        }
      }

      const protectionSettingsChanged = !hasSameProtectionSettings(currentSettings, nextSettings);
      const result = store.saveSettings(nextSettings);
      if (protectionSettingsChanged) {
        try {
          await clearInactiveSecurityCredentials(nextSettings);
        } catch (error) {
          console.error("Failed to clear inactive credentials after settings save.", error);
        }
      }

      return result;
    } catch (error) {
      console.error("Failed to save Electron settings.", error);
      return settingsUnavailableResult();
    }
  });
}

function backupUnavailableResult() {
  return {
    success: false,
    errorCode: "UnexpectedError",
    message: "The backup service is unavailable.",
    automaticEnabled: false,
    customFolderPath: "",
    defaultFolderPath: "",
    effectiveFolderPath: "",
    hasStoredPassword: false,
  };
}

function lockedBackupResult() {
  return {
    ...backupUnavailableResult(),
    errorCode: "Locked",
    message: "Unlock WinOTP before accessing backups.",
  };
}

const CORE_IMPORT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_ACCOUNT_INPUT_BYTES = 256 * 1024;

function boundedCoreText(value, maximumBytes, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} is too large.`);
  }
  return value;
}

function boundedAccountInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Account data is invalid.");
  }

  const serialized = JSON.stringify(value);
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > MAX_ACCOUNT_INPUT_BYTES
  ) {
    throw new Error("Account data is too large.");
  }
  return value;
}

function runCoreFromRenderer(event, operation, input, options: any = {}) {
  const isTrustedMainRenderer = isTrustedRendererEvent(event, mainWindow);
  const isTrustedCaptureOverlay =
    options.allowScreenCaptureOverlay === true &&
    isTrustedScreenCaptureEvent(event, screenCaptureRequest?.webContents);
  if (!isTrustedMainRenderer && !isTrustedCaptureOverlay) {
    return Promise.reject(new Error("The renderer is not authorized."));
  }

  const { allowScreenCaptureOverlay: _allowScreenCaptureOverlay, ...coreOptions } = options;

  return runRustCoreAsync(operation, input, {
    maxInputBytes: coreOptions.maxInputBytes ?? 8 * 1024 * 1024,
    maxBuffer: coreOptions.maxBuffer ?? 8 * 1024 * 1024,
    timeoutMs: coreOptions.timeoutMs ?? 15_000,
  });
}

function registerCoreIpc() {
  ipcMain.handle("core:parse-otp-uri", (event, uri) =>
    runCoreFromRenderer(event, "parse-otp-uri", {
      uri: boundedCoreText(uri, 8 * 1024, "The OTP URI"),
    }),
  );
  ipcMain.handle("core:parse-winauth-line", (event, line) =>
    runCoreFromRenderer(event, "parse-winauth-line", {
      line:
        line === null || line === undefined
          ? line
          : boundedCoreText(line, 8 * 1024, "The WinAuth line"),
    }),
  );
  ipcMain.handle("core:parse-legacy-json", (event, content) =>
    runCoreFromRenderer(
      event,
      "parse-legacy-json",
      { content: boundedCoreText(content, CORE_IMPORT_MAX_BUFFER_BYTES, "The import file") },
      {
        maxInputBytes: CORE_IMPORT_MAX_BUFFER_BYTES + 8 * 1024,
        maxBuffer: CORE_IMPORT_MAX_BUFFER_BYTES,
      },
    ),
  );
  ipcMain.handle("core:parse-winauth-text", (event, content) =>
    runCoreFromRenderer(
      event,
      "parse-winauth-text",
      { content: boundedCoreText(content, CORE_IMPORT_MAX_BUFFER_BYTES, "The import file") },
      {
        maxInputBytes: CORE_IMPORT_MAX_BUFFER_BYTES + 8 * 1024,
        maxBuffer: CORE_IMPORT_MAX_BUFFER_BYTES,
      },
    ),
  );
  ipcMain.handle("core:sort-accounts", (event, input) =>
    runCoreFromRenderer(event, "sort-accounts", input),
  );
  ipcMain.handle("core:prune-custom-order-ids", (event, input) =>
    runCoreFromRenderer(event, "prune-custom-order-ids", input),
  );
  ipcMain.handle("core:order-drop-index", (event, input) =>
    runCoreFromRenderer(event, "order-drop-index", input),
  );
  ipcMain.handle("core:order-project", (event, input) =>
    runCoreFromRenderer(event, "order-project", input),
  );
  ipcMain.handle("core:reconcile-protection", (event, input) =>
    runCoreFromRenderer(event, "reconcile-protection", input),
  );
  ipcMain.handle("core:transition-protection", (event, input) =>
    runCoreFromRenderer(event, "transition-protection", input),
  );
  ipcMain.handle("core:screen-capture-map", (event, input) =>
    runCoreFromRenderer(event, "screen-capture-map", input, {
      allowScreenCaptureOverlay: true,
    }),
  );
  ipcMain.handle("core:screen-capture-expand", (event, input) =>
    runCoreFromRenderer(event, "screen-capture-expand", input, {
      allowScreenCaptureOverlay: true,
    }),
  );
  ipcMain.handle("core:screen-capture-padding", (event, input) =>
    runCoreFromRenderer(event, "screen-capture-padding", input, {
      allowScreenCaptureOverlay: true,
    }),
  );
}

function createMissingAccount(id) {
  return {
    id,
    issuer: "",
    accountName: "",
    secret: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "1970-01-01T00:00:00.000Z",
    usageCount: 0,
  };
}

function registerTotpIpc() {
  ipcMain.handle("totp:code", (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow) || !isRendererUnlocked()) {
      return { success: false, message: "The TOTP code is unavailable." };
    }

    const accountId = String(id ?? "").trim();
    const account = accountStoreLoader
      .get()
      ?.getPreviewAccounts()
      ?.find((item) => item.id === accountId);
    if (!account) {
      return { success: false, message: "The TOTP account is unavailable." };
    }

    const code = generateTotpCode(account, Date.now());
    if (!isValidTrayTotpCode(code, account.digits)) {
      return { success: false, message: "The TOTP code is unavailable." };
    }

    return { success: true, code };
  });

  ipcMain.handle("totp:previews", async (event, ids, timestamp) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return [];
    }
    if (!isRendererUnlocked()) {
      return [];
    }

    const requestedIds = Array.isArray(ids)
      ? ids.map((id) => String(id ?? "").trim()).slice(0, 1_000)
      : [];
    const storedAccounts = accountStoreLoader.get()?.getPreviewAccounts() ?? [];
    const accountById = new Map(storedAccounts.map((account) => [account.id, account]));
    const accounts = requestedIds.map((id) => accountById.get(id) ?? createMissingAccount(id));
    const previews = await runTotpPreviews(accounts, timestamp);
    return isRendererUnlocked() ? previews : [];
  });
}

function withBackupStatus(service, result) {
  if (
    result &&
    typeof result.automaticEnabled === "boolean" &&
    typeof result.customFolderPath === "string" &&
    typeof result.defaultFolderPath === "string" &&
    typeof result.effectiveFolderPath === "string" &&
    typeof result.hasStoredPassword === "boolean"
  ) {
    return result;
  }

  try {
    return {
      ...service.getStatus(),
      ...result,
    };
  } catch {
    return {
      ...backupUnavailableResult(),
      ...result,
    };
  }
}

async function attachAutomaticBackupResult(result, options: any = {}) {
  const { shouldCreate = true, context = "an account mutation", service } = options;
  if (!result?.success || !shouldCreate) {
    return result;
  }

  try {
    const automaticBackup = await (service ?? getBackupStore()).createAutomaticBackup();
    return automaticBackup.skipped ? result : { ...result, automaticBackup };
  } catch (error) {
    console.error(`Automatic backup failed after ${context}.`, error);
    return {
      ...result,
      automaticBackup: {
        success: false,
        errorCode: "UnexpectedError",
        message: "Unable to create the automatic backup.",
      },
    };
  }
}

function registerAccountIpc() {
  ipcMain.handle("accounts:list", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return accountStoreUnavailableResult();
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return accountStoreUnavailableResult();
    }

    try {
      return store.readAccounts({ includeSecrets: false });
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to load accounts from the local database.", error);
      return accountStoreUnavailableResult();
    }
  });

  ipcMain.handle("accounts:get", (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return undefined;
    }
    if (!isRendererUnlocked()) {
      return undefined;
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return undefined;
    }

    try {
      return store.getAccount(id);
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to load an account for editing.", error);
      return undefined;
    }
  });

  ipcMain.handle("accounts:ack-migration", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return false;
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return false;
    }

    try {
      return store.acknowledgeMigrationNotification();
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to acknowledge account migration.", error);
      return false;
    }
  });

  ipcMain.handle("accounts:save", async (event, account) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
    }
    if (!isRendererUnlocked()) {
      return {
        success: false,
        errorCode: "Locked",
        message: "Unlock WinOTP before changing accounts.",
      };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      const result = store.saveAccount(boundedAccountInput(account));
      const rendererResult = result?.account
        ? { ...result, account: sanitizeAccount(result.account) }
        : result;
      return attachAutomaticBackupResult(rendererResult);
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to save an account to the local database.", error);
      return { success: false, message: "Unable to save the account." };
    }
  });

  ipcMain.handle("accounts:save-batch", async (event, accounts) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { results: [] };
    }
    if (!isRendererUnlocked()) {
      return { results: [] };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { results: [] };
    }

    const boundedAccounts = Array.isArray(accounts) ? accounts.slice(0, 1_000) : [];
    const normalizationResults = Array.from({ length: boundedAccounts.length });
    const normalizationEntries = [];
    const normalizationIndexes = [];

    for (const [index, account] of boundedAccounts.entries()) {
      try {
        const bounded = boundedAccountInput(account);
        normalizationEntries.push({ source: bounded, fallbackId: bounded.id });
        normalizationIndexes.push(index);
      } catch (error) {
        normalizationResults[index] = {
          ok: false,
          error: error instanceof Error ? error.message : "Account data is invalid.",
        };
      }
    }

    if (normalizationEntries.length > 0) {
      try {
        const normalized = normalizeAccounts(normalizationEntries);
        for (const [offset, result] of normalized.entries()) {
          normalizationResults[normalizationIndexes[offset]] = result;
        }
      } catch (error) {
        console.error("Failed to normalize imported accounts through the Rust core.", error);
        for (const index of normalizationIndexes) {
          normalizationResults[index] = {
            ok: false,
            error: "Unable to normalize the account.",
          };
        }
      }
    }

    return saveAccountBatch(normalizationResults, {
      saveAccount: (normalized) => {
        if (!normalized?.ok) {
          return { success: false, message: normalized?.error ?? "Account data is invalid." };
        }
        const result = store.saveNormalizedAccount(normalized.account);
        return result?.account ? { ...result, account: sanitizeAccount(result.account) } : result;
      },
      createAutomaticBackup: () => getBackupStore().createAutomaticBackup(),
      onSaveError: (error) => {
        console.error("Failed to save an imported account to the local database.", error);
      },
      onBackupError: (error) => {
        console.error("Automatic backup failed after an account import.", error);
      },
    });
  });

  ipcMain.handle("accounts:delete", async (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
    }
    if (!isRendererUnlocked()) {
      return {
        success: false,
        errorCode: "Locked",
        message: "Unlock WinOTP before changing accounts.",
      };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      return attachAutomaticBackupResult(store.deleteAccount(id));
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to delete an account from the local database.", error);
      return { success: false, message: "Unable to delete the account." };
    }
  });

  ipcMain.handle("accounts:record-usage", (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
    }
    if (!isRendererUnlocked()) {
      return {
        success: false,
        errorCode: "Locked",
        message: "Unlock WinOTP before recording account usage.",
      };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      return store.recordUsage(id);
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to record account usage.", error);
      return { success: false, message: "Unable to record account usage." };
    }
  });
}

function registerBackupIpc() {
  ipcMain.handle("backup:status", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }

    try {
      return { success: true, ...getBackupStore().getStatus() };
    } catch (error) {
      console.error("Failed to read backup status.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:configure", async (event, settings) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      return withBackupStatus(service, await service.configure(settings));
    } catch (error) {
      console.error("Failed to configure backup settings.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:enable-automatic", async (event, password, customFolderPath) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      return withBackupStatus(service, await service.enableAutomatic(password, customFolderPath));
    } catch (error) {
      console.error("Failed to enable automatic backup.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:disable-automatic", async (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      return withBackupStatus(service, await service.disableAutomatic());
    } catch (error) {
      console.error("Failed to disable automatic backup.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:choose-folder", async (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      const pickerResult = await dialog.showOpenDialog(mainWindow, {
        title: "Choose automatic backup folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
        return withBackupStatus(service, { success: false, cancelled: true });
      }
      if (!isRendererUnlocked()) {
        return lockedBackupResult();
      }

      return withBackupStatus(
        service,
        await service.setCustomFolderPath(pickerResult.filePaths[0]),
      );
    } catch (error) {
      console.error("Failed to set the automatic backup folder.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:reset-folder", async (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      return withBackupStatus(service, await service.setCustomFolderPath(""));
    } catch (error) {
      console.error("Failed to reset the automatic backup folder.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:import", async (event, password) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const pickerResult = await dialog.showOpenDialog(mainWindow, {
        title: "Import WinOTP backup",
        properties: ["openFile"],
        filters: [{ name: "WinOTP Backup", extensions: ["wotpbackup"] }],
      });
      if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      if (!isRendererUnlocked()) {
        return lockedBackupResult();
      }

      const service = getBackupStore();
      const result = service.importBackup(pickerResult.filePaths[0], password);
      return attachAutomaticBackupResult(result, {
        shouldCreate: result.importedCount > 0,
        context: "importing accounts",
        service,
      });
    } catch (error) {
      console.error("Failed to import the backup.", error);
      return backupUnavailableResult();
    }
  });

  ipcMain.handle("backup:export", async (event, passwordOverride) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return backupUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedBackupResult();
    }

    try {
      const service = getBackupStore();
      const storedPassword =
        passwordOverride === undefined ? service.getStoredPassword() : undefined;
      if (passwordOverride === undefined && !storedPassword) {
        return {
          success: false,
          errorCode: "PasswordUnavailable",
          message: "A backup password is required to export a backup.",
        };
      }

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
      const suggestedFileName = `winotp-backup-${timestamp}.wotpbackup`;
      const pickerResult = await dialog.showSaveDialog(mainWindow, {
        title: "Export WinOTP backup",
        defaultPath: path.join(app.getPath("documents"), suggestedFileName),
        filters: [{ name: "WinOTP Backup", extensions: ["wotpbackup"] }],
        showOverwriteConfirmation: true,
      });
      if (pickerResult.canceled || !pickerResult.filePath) {
        return { success: false, cancelled: true };
      }
      if (!isRendererUnlocked()) {
        return lockedBackupResult();
      }

      return service.exportBackup(pickerResult.filePath, passwordOverride ?? storedPassword);
    } catch (error) {
      console.error("Failed to export the backup.", error);
      return backupUnavailableResult();
    }
  });
}

function securityUnavailableResult() {
  return {
    success: false,
    message: "OS-backed security storage is unavailable.",
  };
}

function lockedSecurityResult() {
  return {
    success: false,
    errorCode: "Locked",
    message: "Unlock WinOTP before changing security credentials.",
  };
}

function getSecurityStore() {
  if (!securityStore) {
    securityStore = new SecurityStore(app);
  }

  return securityStore;
}

async function canAuthorizeRendererUnlock(kind) {
  try {
    const settings = getSettingsStore().getSettings();
    if (kind === "pin") {
      return settings.pinProtection === true;
    }
    if (kind === "password") {
      return settings.passwordProtection === true;
    }
    if (
      (kind !== "remotePin" && kind !== "remotePassword") ||
      settings.windowsHello !== true ||
      settings[kind] !== true
    ) {
      return false;
    }

    return isRemoteWindowsHelloSession();
  } catch {
    return false;
  }
}

function canAuthorizeWindowsHelloUnlock() {
  try {
    const settings = getSettingsStore().getSettings();
    return (
      settings.windowsHello === true || isUnprotectedProfile(settings, isSecurityMigrationPending())
    );
  } catch {
    return false;
  }
}

async function runWindowsHelloOperation(operation) {
  if (windowsHelloOperationInProgress) {
    return {
      success: false,
      message: "Another Windows Hello request is already in progress.",
    };
  }

  windowsHelloOperationInProgress = true;
  try {
    return { success: true, ...(await operation()) };
  } catch {
    return {
      success: false,
      message: "The Windows Hello bridge is unavailable.",
    };
  } finally {
    windowsHelloOperationInProgress = false;
  }
}

function registerSecurityIpc() {
  ipcMain.handle("security:status", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
    }

    try {
      return { success: true, ...getSecurityStore().getStatus() };
    } catch {
      return securityUnavailableResult();
    }
  });

  ipcMain.handle("security:set-credential", (event, kind, secret) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedSecurityResult();
    }

    try {
      const wasUnprotected = isCurrentProfileUnprotected();
      getSecurityStore().setCredential(kind, secret);
      if (wasUnprotected) {
        rendererUnlocked = true;
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unable to save the security credential.",
      };
    }
  });

  ipcMain.handle("security:verify-credential", async (event, kind, secret) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
    }

    try {
      const result = getSecurityStore().verifyCredential(kind, secret);
      if (result.verified === true) {
        if (rendererUnlocked || (await canAuthorizeRendererUnlock(kind))) {
          rendererUnlocked = true;
        }
      }
      return { success: true, ...result };
    } catch {
      return securityUnavailableResult();
    }
  });

  ipcMain.handle("security:remove-credential", (event, kind) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
    }
    if (!isRendererUnlocked()) {
      return lockedSecurityResult();
    }

    try {
      getSecurityStore().removeCredential(kind);
      return { success: true };
    } catch {
      return securityUnavailableResult();
    }
  });

  ipcMain.handle("security:windows-hello-availability", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return {
        success: false,
        message: "The renderer is not authorized.",
      };
    }

    return runWindowsHelloOperation(() => getWindowsHelloAvailability());
  });

  ipcMain.handle("security:windows-hello-verify", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return {
        success: false,
        message: "The renderer is not authorized.",
      };
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      return {
        success: false,
        message: "The main window is unavailable.",
      };
    }

    return runWindowsHelloOperation(async () => {
      const result = await verifyWindowsHello({
        windowHandle: mainWindow.getNativeWindowHandle(),
      });
      if (result.status === "verified" && (rendererUnlocked || canAuthorizeWindowsHelloUnlock())) {
        rendererUnlocked = true;
      }
      return result;
    });
  });
}

function registerAutoStartIpc() {
  ipcMain.handle("auto-start:status", (event) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return {
        success: false,
        enabled: false,
        message: "The renderer is not authorized.",
      };
    }

    try {
      return getAutoStartStatus(app, getAutoStartOptions());
    } catch {
      return {
        success: false,
        enabled: false,
        message: "The operating system auto-start service is unavailable.",
      };
    }
  });

  ipcMain.handle("auto-start:set", (event, enabled) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return {
        success: false,
        enabled: false,
        message: "The renderer is not authorized.",
      };
    }

    if (typeof enabled !== "boolean") {
      return {
        success: false,
        enabled: false,
        message: "Auto-start must be configured with a boolean value.",
      };
    }

    try {
      return setAutoStart(app, enabled, getAutoStartOptions());
    } catch {
      return {
        success: false,
        enabled: false,
        message: `Unable to ${enabled ? "enable" : "disable"} auto-start with the operating system.`,
      };
    }
  });
}

function createWindow() {
  const iconPath = getIconPath(app, __dirname);
  const devRequested =
    !app.isPackaged && (process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL));
  const rendererUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const rendererFilePath = getRendererFilePath(__dirname);
  const isDev = devRequested && isLoopbackRendererUrl(rendererUrl);
  const navigationOptions = { isDev, rendererUrl, rendererFilePath };

  mainWindow = new BrowserWindow({
    width: 480,
    height: 650,
    useContentSize: true,
    minWidth: 480,
    maxWidth: 480,
    minHeight: 650,
    maxHeight: 650,
    resizable: false,
    frame: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      ...defaultTitleBarTheme,
      height: titleBarHeight,
    },
    title: "WinOTP",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#000000",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const rejectUnexpectedNavigation = (event, url) => {
    if (!isAllowedRendererUrl(url, navigationOptions)) {
      event.preventDefault();
    }
  };
  mainWindow.webContents.on("will-navigate", rejectUnexpectedNavigation);
  mainWindow.webContents.on("will-redirect", rejectUnexpectedNavigation);
  mainWindow.webContents.on("did-start-loading", clearRendererUnlockState);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    const state = trayController?.getState();
    if (state?.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }

    if (state?.minimizeOnClose) {
      event.preventDefault();
      mainWindow.minimize();
      return;
    }
  });

  if (isDev && !app.isPackaged) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(rendererFilePath);
  }

  mainWindow.once("ready-to-show", () => {
    if (!isStartedHidden()) {
      mainWindow.show();
    }
  });
  mainWindow.on("closed", () => {
    clearRendererUnlockState();
    mainWindow = undefined;
  });
}

const hasSingleInstanceLock = isDevelopment() || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (!commandLine.includes("--hidden")) {
      restoreMainWindow();
    }
  });

  app.whenReady().then(() => {
    app.setName("WinOTP");
    app.setAppUserModelId("com.xbounceit.winotp");

    initializeLegacyMigration();
    accountStoreLoader.get();
    registerSettingsIpc();
    registerAccountIpc();
    registerBackupIpc();
    registerUpdateIpc();
    registerSecurityIpc();
    registerAutoStartIpc();
    registerCoreIpc();
    registerTotpIpc();
    registerSessionChangeMonitoring();
    ipcMain.handle("open-external", async (event, url) => {
      if (!isTrustedRendererEvent(event, mainWindow)) {
        return false;
      }

      if (!isAllowedExternalUrl(url)) {
        return false;
      }

      try {
        await shell.openExternal(url);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle("capture-screen", captureScreen);
    ipcMain.on("set-tray-state", updateTrayState);
    ipcMain.on("screen-capture-result", (event, result) => {
      if (
        !screenCaptureRequest ||
        !isTrustedScreenCaptureEvent(event, screenCaptureRequest.webContents)
      ) {
        return;
      }

      settleScreenCapture(result);
    });
    ipcMain.on("set-title-bar-theme", (event, theme) => {
      if (!isTrustedRendererEvent(event, mainWindow)) {
        return;
      }

      updateTitleBarTheme(theme);
    });

    trayController = createTrayController({
      Tray,
      Menu,
      iconPath: getIconPath(app, __dirname),
      onOpen: restoreMainWindow,
      onCopy: copyTrayCode,
      onExit: quitApp,
      onMenuOpen: refreshTrayCodes,
      onError: (error) => {
        console.error("Tray icon operation failed.", error);
      },
    });
    createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  restoreMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  sessionChangeWatcher?.stop();
  trayController?.dispose();
  accountStoreLoader.close();
});
