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
});
