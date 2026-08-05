const path = require("node:path");

const WINDOWS_SAFE_STORAGE_PROFILE_NAME = "Electron";

function getAppRoot(dirname) {
  return path.resolve(dirname, "..", "..");
}

function getIconPath(app, dirname) {
  return path.join(getAppRoot(dirname), app.isPackaged ? "dist" : "public", "app.ico");
}

function getRendererFilePath(dirname) {
  return path.join(getAppRoot(dirname), "dist", "index.html");
}

function configureUserDataPath(app, { platform = process.platform } = {}) {
  if (platform !== "win32") {
    return undefined;
  }

  // Existing Windows account ciphertext was created while Electron was
  // launched from its compiled entry point, which used this profile name.
  // Electron's Windows safeStorage key is profile-scoped, so changing the
  // profile silently makes every previously saved secret undecryptable.
  const userDataPath = path.join(app.getPath("appData"), WINDOWS_SAFE_STORAGE_PROFILE_NAME);
  app.setPath("userData", userDataPath);
  return userDataPath;
}

module.exports = {
  configureUserDataPath,
  getAppRoot,
  getIconPath,
  getRendererFilePath,
};
