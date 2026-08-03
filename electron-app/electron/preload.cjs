const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winotp", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setTitleBarTheme: (theme) => ipcRenderer.send("set-title-bar-theme", theme),
});
