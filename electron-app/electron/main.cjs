const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { AccountStore } = require("./account-store.cjs");
const { createAccountStoreLoader } = require("./account-store-loader.cjs");
const {
  isAllowedRendererUrl,
  isLoopbackRendererUrl,
  isTrustedRendererEvent,
} = require("./security.cjs");

let mainWindow;
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

  ipcMain.handle("accounts:save", (event, account) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      return store.saveAccount(account);
    } catch (error) {
      accountStoreLoader.close();
      console.error("Failed to save an account to the local database.", error);
      return { success: false, message: "Unable to save the account." };
    }
  });

  ipcMain.handle("accounts:delete", (event, id) => {
    if (!isTrustedRendererEvent(event, mainWindow)) {
      return { success: false, message: "The renderer is not authorized." };
    }

    const store = accountStoreLoader.get();
    if (!store) {
      return { success: false, message: "The local account database is unavailable." };
    }

    try {
      return store.deleteAccount(id);
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

function createWindow() {
  const iconPath = path.join(__dirname, "..", app.isPackaged ? "dist" : "public", "app.ico");
  const devRequested =
    !app.isPackaged &&
    (process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL));
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
    app.setAppUserModelId("xBounceIT.WinOTP");

    accountStoreLoader.get();
    registerAccountIpc();
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
