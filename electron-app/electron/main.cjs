const { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } = require("electron");
const path = require("node:path");
const { createDisplayCapturePlan, getThumbnailSize } = require("./screen-capture.cjs");

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

  loadRenderer(mainWindow);

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
  ipcMain.handle("capture-screen", captureScreen);
  ipcMain.on("screen-capture-result", (event, result) => {
    if (!screenCaptureRequest || !screenCaptureRequest.webContents.has(event.sender)) {
      return;
    }

    settleScreenCapture(result);
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
