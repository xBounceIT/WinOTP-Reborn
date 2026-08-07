const { contextBridge, ipcRenderer } = require("electron");

let latestScreenCapture;
const screenCaptureListeners = new Set<(capture: any) => void>();
const trayUsageListeners = new Set<(usage: any) => void>();
const sessionChangeListeners = new Set<(change: any) => void>();

ipcRenderer.on("screen-capture-ready", (_event, capture) => {
  latestScreenCapture = capture;
  screenCaptureListeners.forEach((listener) => listener(capture));
});

ipcRenderer.on("tray-usage-recorded", (_event, usage) => {
  trayUsageListeners.forEach((listener) => {
    try {
      listener(usage);
    } catch {
      // A renderer listener must not break delivery to other listeners.
    }
  });
});

ipcRenderer.on("session-changed", (_event, change) => {
  sessionChangeListeners.forEach((listener) => {
    try {
      listener(change);
    } catch {
      // A renderer listener must not break delivery to other listeners.
    }
  });
});

contextBridge.exposeInMainWorld("winotp", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setTitleBarTheme: (theme) => ipcRenderer.send("set-title-bar-theme", theme),
  setTrayState: (state) => ipcRenderer.send("set-tray-state", state),
  autoStart: {
    status: () => ipcRenderer.invoke("auto-start:status"),
    set: (enabled) => ipcRenderer.invoke("auto-start:set", enabled),
  },
  onTrayUsageRecorded: (listener) => {
    if (typeof listener !== "function") {
      return () => undefined;
    }

    trayUsageListeners.add(listener);
    return () => trayUsageListeners.delete(listener);
  },
  onSessionChanged: (listener) => {
    if (typeof listener !== "function") {
      return () => undefined;
    }

    sessionChangeListeners.add(listener);
    return () => sessionChangeListeners.delete(listener);
  },
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
  core: {
    parseOtpUri: (uri) =>
      ipcRenderer.invoke("core:parse-otp-uri", uri).then((result) => result ?? undefined),
    parseWinAuthLine: (line) => ipcRenderer.invoke("core:parse-winauth-line", line),
    parseLegacyJson: (content) => ipcRenderer.invoke("core:parse-legacy-json", content),
    parseWinAuthText: (content) => ipcRenderer.invoke("core:parse-winauth-text", content),
    sortAccounts: (input) => ipcRenderer.invoke("core:sort-accounts", input),
    pruneCustomOrderIds: (input) => ipcRenderer.invoke("core:prune-custom-order-ids", input),
    orderDropIndex: (input) => ipcRenderer.invoke("core:order-drop-index", input),
    orderProject: (input) => ipcRenderer.invoke("core:order-project", input),
    reconcileProtection: (input) => ipcRenderer.invoke("core:reconcile-protection", input),
    transitionProtection: (input) => ipcRenderer.invoke("core:transition-protection", input),
    screenCaptureMap: (input) => ipcRenderer.invoke("core:screen-capture-map", input),
    screenCaptureExpand: (input) => ipcRenderer.invoke("core:screen-capture-expand", input),
    screenCapturePadding: (input) => ipcRenderer.invoke("core:screen-capture-padding", input),
  },
  totp: {
    previews: (ids, timestamp) => ipcRenderer.invoke("totp:previews", ids, timestamp),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    recover: (authorization) => ipcRenderer.invoke("settings:recover", authorization),
    save: (settings) => ipcRenderer.invoke("settings:save", settings),
  },
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    get: (id) => ipcRenderer.invoke("accounts:get", id),
    acknowledgeMigration: () => ipcRenderer.invoke("accounts:ack-migration"),
    save: (account) => ipcRenderer.invoke("accounts:save", account),
    saveBatch: (accounts) => ipcRenderer.invoke("accounts:save-batch", accounts),
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
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: (channel, automaticCheckEnabled) =>
      ipcRenderer.invoke("updates:check", channel, automaticCheckEnabled),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
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
