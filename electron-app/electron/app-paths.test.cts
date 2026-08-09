const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { configureUserDataPath, getIconPath, getRendererFilePath } = require("./app-paths.cjs");

function createApp(isPackaged) {
  return {
    isPackaged,
  };
}

test("keeps the Windows safe-storage profile compatible with migrated accounts", () => {
  const appDataPath = path.resolve("fixture-app-data");
  const expectedUserDataPath = path.join(appDataPath, "Electron");
  let configuredPath;
  const app = {
    getPath: (name) => (name === "appData" ? appDataPath : ""),
    setPath: (name, value) => {
      assert.equal(name, "userData");
      configuredPath = value;
    },
  };

  assert.equal(configureUserDataPath(app, { platform: "win32" }), expectedUserDataPath);
  assert.equal(configuredPath, expectedUserDataPath);
});

test("does not override the user-data profile on non-Windows platforms", () => {
  let setPathCalled = false;
  const app = {
    getPath: () => "",
    setPath: () => {
      setPathCalled = true;
    },
  };

  assert.equal(configureUserDataPath(app, { platform: "linux" }), undefined);
  assert.equal(setPathCalled, false);
});

test("resolves the development icon from Electron's app root", () => {
  const appRoot = path.resolve("fixture-app");
  const compiledElectronDir = path.join(appRoot, "electron-dist", "electron");

  assert.equal(
    getIconPath(createApp(false), compiledElectronDir),
    path.join(appRoot, "public", "app.ico"),
  );
});

test("resolves the packaged icon from Electron's app root", () => {
  const appRoot = path.resolve("fixture-app.asar");
  const compiledElectronDir = path.join(appRoot, "electron-dist", "electron");

  assert.equal(
    getIconPath(createApp(true), compiledElectronDir),
    path.join(appRoot, "dist", "app.ico"),
  );
});

test("resolves the renderer bundle from Electron's app root", () => {
  const appRoot = path.resolve("fixture-app");
  const compiledElectronDir = path.join(appRoot, "electron-dist", "electron");

  assert.equal(getRendererFilePath(compiledElectronDir), path.join(appRoot, "dist", "index.html"));
});
