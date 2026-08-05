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
const { AccountStore } = require("./account-store.cjs");
const { createAccountStoreLoader } = require("./account-store-loader.cjs");
const { BackupStore } = require("./backup-store.cjs");
const { SecurityStore } = require("./security-store.cjs");
const { createUpdateService, defaultUpdateState } = require("./update-service.cjs");
const { SettingsStore } = require("./settings-store.cjs");
const { migrateLegacySettingsForApp, runLegacyMigration } = require("./legacy-migration.cjs");
const { getWindowsHelloAvailability, verifyWindowsHello } = require("./windows-hello.cjs");
const { configureUserDataPath, getIconPath, getRendererFilePath } = require("./app-paths.cjs");
const { generateTotpCode, generateTotpCodes } = require("./totp.cjs");
const { getAutoStartStatus, setAutoStart } = require("./auto-start.cjs");
const {
  isAllowedRendererUrl,
  isLoopbackRendererUrl,
  isTrustedRendererEvent,
} = require("./security.cjs");

const { createTrayController, orderAccountsByIds } = require("./tray.cjs");

let mainWindow;
let trayController;
let screenCaptureRequest;
let screenCaptureInProgress = false;
let securityStore;
let updateService;
let settingsStore;
let legacySettingsMigrationFailed = false;
let legacyAppLockMigrationPending = false;
let windowsHelloOperationInProgress = false;
let isQuitting = false;
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
  return {
    appPath: app.isPackaged ? undefined : app.getAppPath(),
    isPackaged: app.isPackaged,
    execPath: process.execPath,
  };
}

function isHexColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value);
}

function updateTitleBarTheme(theme = {}) {
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

function exitFromTray() {
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

function refreshTrayCodes() {
  const state = trayController?.getState();
  if (!state || !state.showTotpInTray || state.locked) {
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
  if (!state || !state.showTotpInTray || state.locked) {
    return;
  }

  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  const storedAccounts = loadStoredAccounts();
  const storedAccount = storedAccounts?.find((item) => item.id === account.id);
  if (storedAccounts && !storedAccount) {
    return;
  }
  const currentCode = storedAccount ? generateTotpCode(storedAccount) : account.code;

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

  trayController?.setState(state);
}

function notifyRendererOfSessionChange(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("session-changed", { reason });
}

function registerPowerSessionChangeMonitoring() {
  // Electron owns the BrowserWindow message loop. The Rust sidecar cannot
  // register WTS notifications for that HWND, so use Electron's in-process
  // power/session events for lock and resume handling.
  for (const eventName of ["lock-screen", "unlock-screen", "suspend", "resume"]) {
    powerMonitor.on(eventName, () => notifyRendererOfSessionChange(eventName));
  }
}

function loadRenderer(window, query = {}) {
  if (isDevelopment() && !app.isPackaged) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureScreen(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    screenCaptureRequest ||
    screenCaptureInProgress
  ) {
    return { status: "failed" };
  }

  const ownerWindow = mainWindow;
  let captureWindows = [];
  let resultPromise;
  let captureRequest;
  let windowLifecycles = [];
  screenCaptureInProgress = true;

  try {
    ownerWindow.hide();
    await wait(180);

    const capture = await captureDisplays();
    if (!capture) {
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

      captureWindows.forEach((captureWindow) => {
        if (!captureWindow.isDestroyed()) {
          captureWindow.close();
        }
      });

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
    securityStore = new SecurityStore(app);
    backupStore = new BackupStore(app, () => accountStoreLoader.get(), {
      encryption: safeStorage,
      skipAutomaticReconciliation: true,
    });

    const migration = runLegacyMigration(app, { securityStore, backupStore });
    legacySettingsMigrationFailed = migration.settings.status === "failed";
    legacyAppLockMigrationPending = migration.appLock.status === "failed";
    if (migration.backupPassword.status !== "failed") {
      backupStore.reconcileAutomaticSettings();
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
    console.error("Failed to initialize the native WinOTP migration.", error);
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
      return await getUpdateService().install();
    } catch (error) {
      console.error("Failed to launch the app update installer.", error);
      return updateUnavailableResult();
    }
  });
}

function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = new SettingsStore(app);
  }

  return settingsStore;
}

function settingsUnavailableResult() {
  return {
    success: false,
    message: "The settings service is unavailable.",
  };
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
        securityMigrationPending: legacyAppLockMigrationPending,
      };
    } catch (error) {
      console.error("Failed to read Electron settings.", error);
      return settingsUnavailableResult();
    }
  });

  ipcMain.handle("settings:save", (event, settings) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return settingsUnavailableResult();
    }

    try {
      return getSettingsStore().saveSettings(settings);
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

async function attachAutomaticBackupResult(result, options = {}) {
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
      return store.readAccounts();
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to load accounts from the local database.", error);
      return accountStoreUnavailableResult();
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

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      return attachAutomaticBackupResult(store.saveAccount(account));
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to save an account to the local database.", error);
      return { success: false, message: "Unable to save the account." };
    }
  });

  ipcMain.handle("accounts:delete", async (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
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

    try {
      const service = getBackupStore();
      const pickerResult = await dialog.showOpenDialog(mainWindow, {
        title: "Choose automatic backup folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
        return withBackupStatus(service, { success: false, cancelled: true });
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

    try {
      const pickerResult = await dialog.showOpenDialog(mainWindow, {
        title: "Import WinOTP backup",
        properties: ["openFile"],
        filters: [{ name: "WinOTP Backup", extensions: ["wotpbackup"] }],
      });
      if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
        return { success: false, cancelled: true };
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

function getSecurityStore() {
  if (!securityStore) {
    securityStore = new SecurityStore(app);
  }

  return securityStore;
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

    try {
      getSecurityStore().setCredential(kind, secret);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unable to save the security credential.",
      };
    }
  });

  ipcMain.handle("security:verify-credential", (event, kind, secret) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
    }

    try {
      return { success: true, ...getSecurityStore().verifyCredential(kind, secret) };
    } catch {
      return securityUnavailableResult();
    }
  });

  ipcMain.handle("security:remove-credential", (event, kind) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return securityUnavailableResult();
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

    return runWindowsHelloOperation(() =>
      verifyWindowsHello({ windowHandle: mainWindow.getNativeWindowHandle() }),
    );
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
    registerPowerSessionChangeMonitoring();
    ipcMain.handle("open-external", (event, url) => {
      if (!isTrustedRendererEvent(event, mainWindow)) {
        return false;
      }

      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return false;
      }

      shell.openExternal(url);
      return true;
    });
    ipcMain.handle("capture-screen", captureScreen);
    ipcMain.on("set-tray-state", updateTrayState);
    ipcMain.on("screen-capture-result", (event, result) => {
      if (!screenCaptureRequest || !screenCaptureRequest.webContents.has(event.sender)) {
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
      onExit: exitFromTray,
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

app.on("before-quit", () => {
  isQuitting = true;
  trayController?.dispose();
  accountStoreLoader.close();
});
