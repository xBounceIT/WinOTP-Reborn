const { contextBridge, ipcRenderer } = require("electron");

let latestScreenCapture;
const screenCaptureListeners = new Set();

ipcRenderer.on("screen-capture-ready", (_event, capture) => {
  latestScreenCapture = capture;
  screenCaptureListeners.forEach((listener) => listener(capture));
});

contextBridge.exposeInMainWorld("winotp", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setTitleBarTheme: (theme) => ipcRenderer.send("set-title-bar-theme", theme),
  captureScreen: () => ipcRenderer.invoke("capture-screen"),
  onScreenCaptureReady: (listener) => {
    screenCaptureListeners.add(listener);
    if (latestScreenCapture) {
      queueMicrotask(() => {
        if (screenCaptureListeners.has(listener)) {
          listener(latestScreenCapture);
        }
      });
    }
    return () => screenCaptureListeners.delete(listener);
  },
  completeScreenCapture: (result) => ipcRenderer.send("screen-capture-result", result),
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    acknowledgeMigration: () => ipcRenderer.invoke("accounts:ack-migration"),
    save: (account) => ipcRenderer.invoke("accounts:save", account),
    delete: (id) => ipcRenderer.invoke("accounts:delete", id),
    recordUsage: (id) => ipcRenderer.invoke("accounts:record-usage", id),
  },
  backup: {
    status: () => ipcRenderer.invoke("backup:status"),
    configure: (settings) => ipcRenderer.invoke("backup:configure", settings),
    enableAutomatic: (password, customFolderPath) =>
      ipcRenderer.invoke("backup:enable-automatic", password, customFolderPath),
    disableAutomatic: () => ipcRenderer.invoke("backup:disable-automatic"),
    chooseFolder: () => ipcRenderer.invoke("backup:choose-folder"),
    resetFolder: () => ipcRenderer.invoke("backup:reset-folder"),
    import: (password) => ipcRenderer.invoke("backup:import", password),
    export: (passwordOverride) => ipcRenderer.invoke("backup:export", passwordOverride),
  },
  security: {
    getStatus: () => ipcRenderer.invoke("security:status"),
    setCredential: (kind, secret) => ipcRenderer.invoke("security:set-credential", kind, secret),
    verifyCredential: (kind, secret) =>
      ipcRenderer.invoke("security:verify-credential", kind, secret),
    removeCredential: (kind) => ipcRenderer.invoke("security:remove-credential", kind),
    getWindowsHelloAvailability: () => ipcRenderer.invoke("security:windows-hello-availability"),
    verifyWindowsHello: () => ipcRenderer.invoke("security:windows-hello-verify"),
  },
});
