const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

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

  const color = isHexColor(theme.color) ? theme.color : defaultTitleBarTheme.color;
  const symbolColor = isHexColor(theme.symbolColor)
    ? theme.symbolColor
    : defaultTitleBarTheme.symbolColor;

  mainWindow.setTitleBarOverlay({
    color,
    symbolColor,
    height: titleBarHeight,
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", app.isPackaged ? "dist" : "public", "app.ico");

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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const isDev = process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL);
  const rendererUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (isDev && !app.isPackaged) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

app.whenReady().then(() => {
  app.setName("WinOTP");
  app.setAppUserModelId("xBounceIT.WinOTP");
  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return false;
    }

    shell.openExternal(url);
    return true;
  });
  ipcMain.on("set-title-bar-theme", (event, theme) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return;
    }

    updateTitleBarTheme(theme);
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
