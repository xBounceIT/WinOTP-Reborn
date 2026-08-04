const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  shell,
} = require("electron");
const path = require("node:path");
const { createDisplayCapturePlan, getThumbnailSize } = require("./screen-capture.cjs");
const { AccountStore } = require("./account-store.cjs");
const { createAccountStoreLoader } = require("./account-store-loader.cjs");
const { BackupStore } = require("./backup-store.cjs");
const {
  isAllowedRendererUrl,
  isLoopbackRendererUrl,
  isTrustedRendererEvent,
} = require("./security.cjs");

let mainWindow;
let screenCaptureRequest;
let screenCaptureInProgress = false;
const titleBarHeight = 32;
const defaultTitleBarTheme = {
  color: "#000000",
  symbolColor: "#ffffff",
};

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

function loadRenderer(window, query = {}) {
  if (isDevelopment() && !app.isPackaged) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
    Object.entries(query).forEach(([key, value]) => {
      rendererUrl.searchParams.set(key, value);
    });
    return window.loadURL(rendererUrl.toString());
  }

  return window.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });
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

function getBackupStore() {
  if (!backupStore) {
    backupStore = new BackupStore(app, () => accountStoreLoader.get(), {
      encryption: safeStorage,
    });
  }
  return backupStore;
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
  const {
    shouldCreate = true,
    context = "an account mutation",
    service,
  } = options;
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
      return withBackupStatus(
        service,
        await service.enableAutomatic(password, customFolderPath),
      );
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

      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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

function createWindow() {
  const iconPath = path.join(__dirname, "..", app.isPackaged ? "dist" : "public", "app.ico");
  const devRequested =
    !app.isPackaged && (process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL));
  const rendererUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const rendererFilePath = path.join(__dirname, "..", "dist", "index.html");
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

  if (isDev && !app.isPackaged) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(rendererFilePath);
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setName("WinOTP");
    app.setAppUserModelId("com.xbounceit.winotp");

    accountStoreLoader.get();
    registerAccountIpc();
    registerBackupIpc();
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

    createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  accountStoreLoader.close();
});
