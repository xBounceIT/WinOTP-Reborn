const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winotp", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  setTitleBarTheme: (theme) => ipcRenderer.send("set-title-bar-theme", theme),
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    acknowledgeMigration: () => ipcRenderer.invoke("accounts:ack-migration"),
    save: (account) => ipcRenderer.invoke("accounts:save", account),
    delete: (id) => ipcRenderer.invoke("accounts:delete", id),
    recordUsage: (id) => ipcRenderer.invoke("accounts:record-usage", id),
  },
});
