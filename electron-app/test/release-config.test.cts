const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const mainSource = fs.readFileSync(path.resolve(process.cwd(), "electron/main.cts"), "utf8");

test("Electron release packaging covers the supported desktop targets", () => {
  const build = packageJson.build;

  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(build.appId, "com.xbounceit.winotp");
  assert.equal(build.productName, "WinOTP");
  assert.equal(packageJson.main, "electron-dist/electron/main.cjs");
  assert.equal(packageJson.scripts["build:electron"], "tsc -p tsconfig.electron.json");
  assert.match(packageJson.scripts.dev, /^npm run build:core &&/);
  assert.match(packageJson.scripts.electron, /^npm run build:core &&/);
  assert.equal(
    packageJson.scripts.dev,
    "npm run build:core && npm run build:electron && node --experimental-strip-types scripts/dev.mts",
  );
  assert.match(packageJson.scripts.electron, /electron \./);
  assert.doesNotMatch(mainSource, /registerSessionNotification/);
  assert.match(mainSource, /registerPowerSessionChangeMonitoring\(\)/);
  assert.match(mainSource, /isDevelopment\(\) \|\| app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /setAppUserModelId\("com\.xbounceit\.winotp"\)/);
  assert.equal(packageJson.desktopName, "WinOTP");
  assert.equal(packageJson.scripts.prepackage, "npm run build:updater && npm run build:electron");
  assert.equal(build.artifactName, "WinOTP-${version}-${os}-${arch}-setup.${ext}");
  assert.deepEqual(build.files, [
    "dist/**/*",
    "electron-dist/**/*.cjs",
    "!electron-dist/**/*.test.cjs",
    "package.json",
  ]);
  assert.deepEqual(build.extraResources, [
    {
      from: "native",
      to: "updater",
      filter: ["winotp-updater*", "winotp-core*"],
    },
  ]);
  assert.equal(build.win.target, "nsis");
  assert.equal(build.linux.target, "AppImage");
  assert.equal(build.linux.syncDesktopName, true);
  assert.equal(build.mac.target, "dmg");
});
