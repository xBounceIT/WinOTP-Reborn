const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const profile = path.join(path.dirname(process.argv[2]), "test-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.disableHardwareAcceleration();

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 480,
    height: 650,
    useContentSize: true,
    show: false,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    await window.loadFile(process.argv[2]);
    await window.webContents.executeJavaScript(fs.readFileSync(process.argv[3], "utf8"));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
