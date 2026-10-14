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
    await window.webContents.executeJavaScript(`(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 20));
      const waitFor = async (condition, message) => {
        for (let attempt = 0; attempt < 250; attempt++) {
          if (condition()) return;
          await wait();
        }
        throw new Error(message);
      };
      await waitFor(() => document.querySelector('[role="alertdialog"]'), "Review did not mount");
      const dialog = document.querySelector('[role="alertdialog"]');
      // Wait for the opening transition before measuring the fixed-size desktop viewport.
      await new Promise(resolve => setTimeout(resolve, 250));
      const rect = dialog.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) throw new Error("Review exceeds viewport: " + JSON.stringify({top: rect.top, bottom: rect.bottom, height: innerHeight}));
      if (window.confirmations !== 0) throw new Error("Imported without confirmation");
      const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === "Confirm import");
      confirm.scrollIntoView({block: "center"});
      const buttonRect = confirm.getBoundingClientRect();
      if (buttonRect.top < 0 || buttonRect.bottom > innerHeight) throw new Error("Confirmation is unreachable");
      confirm.click(); confirm.click();
      await waitFor(() => window.confirmations > 0 && confirm.disabled, "Confirmation did not start");
      if (window.confirmations !== 1) throw new Error("Confirmation is not serialized");
      window.finishSave();
      await waitFor(() => !confirm.disabled, "Confirmation did not finish");
      const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === "Cancel");
      cancel.scrollIntoView({block: "center"});
      cancel.click();
      await waitFor(() => !document.querySelector('[role="alertdialog"]'), "Cancellation did not clear review");
    })()`);
    console.log("QR_UI_OK");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
