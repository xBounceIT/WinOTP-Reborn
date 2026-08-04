const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../package.json");
const mainSource = fs.readFileSync(path.resolve(__dirname, "../electron/main.cjs"), "utf8");

test("Electron release packaging covers the supported desktop targets", () => {
  const build = packageJson.build;

  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(build.appId, "com.xbounceit.winotp");
  assert.equal(build.productName, "WinOTP");
  assert.match(mainSource, /setAppUserModelId\("com\.xbounceit\.winotp"\)/);
  assert.equal(packageJson.desktopName, "WinOTP");
  assert.equal(build.artifactName, "WinOTP-${version}-${os}-${arch}-setup.${ext}");
  assert.deepEqual(build.files, [
    "dist/**/*",
    "electron/**/*.cjs",
    "!electron/**/*.test.cjs",
    "package.json",
  ]);
  assert.equal(build.win.target, "nsis");
  assert.equal(build.linux.target, "AppImage");
  assert.equal(build.linux.syncDesktopName, true);
  assert.equal(build.mac.target, "dmg");
});
