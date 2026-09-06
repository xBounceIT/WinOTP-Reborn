const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const installerSource = fs.readFileSync(path.resolve(process.cwd(), "build/installer.nsh"), "utf8");
const linuxAfterRemoveSource = fs.readFileSync(
  path.resolve(process.cwd(), "build/linux-after-remove.sh"),
  "utf8",
);

function collectFiles(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .flatMap((entry) => (entry.isFile() ? [path.join(entry.parentPath, entry.name)] : []));
}

function installerMacro(name) {
  const match = installerSource.match(
    new RegExp(`^!macro ${name}\\s*\\r?\\n([\\s\\S]*?)^!macroend\\b`, "m"),
  );
  assert.ok(match, `Missing installer hook: ${name}`);
  return match[1].replace(/^\s*;.*$/gm, "");
}

test("main renderer wires crashes to authorization reset", () => {
  const mainSource = fs.readFileSync(path.resolve(process.cwd(), "electron/main.cts"), "utf8");
  assert.match(
    mainSource,
    /mainWindow\.webContents\.on\("render-process-gone", clearRendererUnlockState\)/,
  );
});

test("installer hooks retain the Windows update safety contracts", () => {
  // These source contracts guard native regressions; they do not execute NSIS.
  const preInit = installerMacro("preInit");
  const checkRunning = installerMacro("customCheckAppRunning");
  const customInstall = installerMacro("customInstall");

  assert.match(preInit, /SetSilent silent\s+StrCpy \$isWinOtpUpdate "1"/);
  assert.match(checkRunning, /StrCpy \$IsPowerShellAvailable 1[\s\S]*?!insertmacro FIND_PROCESS/);
  assert.match(
    checkRunning,
    /\$\{If\} \$isWinOtpUpdate == "1"[\s\S]*?!insertmacro FIND_PROCESS[\s\S]*?Sleep [1-9]\d*/,
  );
  assert.match(checkRunning, /IntOp \$R1 \$R1 \+ 1/);
  assert.match(checkRunning, /\$\{If\} \$R1 >= [1-9]\d*[\s\S]*?!insertmacro _CHECK_APP_RUNNING/);
  assert.match(
    customInstall,
    /\$\{If\} \$isWinOtpUpdate == "1"\s+\$\{StdUtils\.ExecShellAsUser\} \$0 "\$launchLink" "open" ""\s+\$\{EndIf\}/,
  );
});

test("application sources stay TypeScript-only and all CommonJS TypeScript stays checked", () => {
  const sourceDirectories = ["src", "electron", "scripts", "test"];
  const sourceFiles = sourceDirectories.flatMap((directory) =>
    collectFiles(path.resolve(process.cwd(), directory)),
  );
  const javascriptSources = sourceFiles.filter((filePath) =>
    /\.(?:cjs|mjs|js|jsx)$/i.test(filePath),
  );
  assert.deepEqual(javascriptSources, []);

  const uncheckedCommonJsSources = sourceFiles.filter(
    (filePath) =>
      filePath.endsWith(".cts") &&
      /(?:^|\n)\s*\/\/\s*@ts-nocheck\b/.test(fs.readFileSync(filePath, "utf8")),
  );
  assert.deepEqual(uncheckedCommonJsSources, []);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "vite.config.ts")), true);
});

test("Electron release packaging covers the supported desktop targets", () => {
  const build = packageJson.build;

  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(packageJson.engines.node, ">=24");
  assert.equal(build.appId, "com.xbounceit.winotp");
  assert.equal(build.productName, "WinOTP");
  assert.equal(packageJson.main, "electron-dist/electron/main.cjs");
  assert.equal(packageJson.scripts["build:electron"], "node scripts/build-electron.ts");
  assert.match(packageJson.scripts.electron, /^npm run build:core &&/);
  assert.equal(
    packageJson.scripts.dev,
    "npm run build:core && npm run build:electron && node scripts/dev.ts",
  );
  assert.match(packageJson.scripts.electron, /electron \./);
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
      filter: ["winotp-updater*", "winotp-core*", "winotp-browser-bridge*"],
    },
  ]);
  assert.equal(build.win.target, "nsis");
  assert.equal(build.nsis.oneClick, true);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.guid, "9C96A88A-8F18-4B57-9F59-AB4E2A8760D1");
  assert.equal(build.nsis.include, "build/installer.nsh");
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.allowToChangeInstallationDirectory, undefined);
  assert.match(installerSource, /!macro customUnInstall/);
  for (const browserRoot of ["Google\\Chrome", "Chromium", "Mozilla"]) {
    assert.ok(
      installerSource.includes(
        `Software\\${browserRoot}\\NativeMessagingHosts\\com.xbounceit.winotp`,
      ),
    );
  }
  assert.match(
    installerSource,
    /Delete "\$LOCALAPPDATA\\WinOTP_Reborn\\runtime\\browser-bridge\.json"/,
  );
  assert.doesNotMatch(installerSource, /RMDir \/r "\$LOCALAPPDATA\\WinOTP_Reborn"/);
  assert.match(installerSource, /\$\{GetOptions\} \$0 "\/CURRENTUSER" \$1/);
  assert.match(installerSource, /!macro customInit/);
  assert.match(
    installerSource,
    /!define WINOTP_LEGACY_INSTALL_DIRECTORY "\$LOCALAPPDATA\\Programs\\WinOTP_Reborn"/,
  );
  assert.match(
    installerSource,
    /!define WINOTP_LEGACY_UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\{9C96A88A-8F18-4B57-9F59-AB4E2A8760D1\}_is1"/,
  );
  assert.match(
    installerSource,
    /!define WINOTP_LEGACY_START_MENU_DIRECTORY "\$SMPROGRAMS\\WinOTP"/,
  );
  assert.match(installerSource, /\$\{FileExists\} "\$0\\WinOTP\.exe"/);
  assert.match(installerSource, /!include "getProcessInfo\.nsh"/);
  assert.match(installerSource, /DeleteRegKey HKCU "\$\{WINOTP_LEGACY_UNINSTALL_KEY\}"/);
  assert.match(installerSource, /Delete "\$INSTDIR\\unins000\.exe"/);
  assert.match(installerSource, /Delete "\$\{WINOTP_LEGACY_START_MENU_DIRECTORY\}\\WinOTP\.lnk"/);
  assert.match(
    installerSource,
    /Delete "\$\{WINOTP_LEGACY_START_MENU_DIRECTORY\}\\Uninstall WinOTP\.lnk"/,
  );
  assert.match(installerSource, /RMDir "\$\{WINOTP_LEGACY_START_MENU_DIRECTORY\}"/);
  assert.deepEqual(build.linux.target, ["AppImage", "deb", "rpm"]);
  assert.equal(build.linux.maintainer, "xBounceIT <xBounceIT@users.noreply.github.com>");
  assert.equal(build.linux.vendor, "xBounceIT");
  assert.deepEqual(build.linux.publish, {
    provider: "github",
    owner: "xBounceIT",
    repo: "WinOTP-Reborn",
  });
  assert.equal(build.linux.syncDesktopName, true);
  assert.equal(build.deb.afterRemove, "build/linux-after-remove.sh");
  assert.equal(build.rpm.afterRemove, "build/linux-after-remove.sh");
  assert.match(linuxAfterRemoveSource, /upgrade \| failed-upgrade/);
  assert.match(linuxAfterRemoveSource, /1\)\s+exit 0/);
  for (const directory of ["google-chrome", "chromium", ".mozilla"]) {
    assert.ok(linuxAfterRemoveSource.includes(directory));
  }
  assert.match(linuxAfterRemoveSource, /rm -f -- .*com\.xbounceit\.winotp\.json/);
  assert.match(linuxAfterRemoveSource, /\[ ! -L "\$manifest_directory" \]/);
  assert.doesNotMatch(linuxAfterRemoveSource, /\brm\s+-\S*r\S*/);
  assert.doesNotMatch(linuxAfterRemoveSource, /WinOTP_Reborn/);
  assert.equal(build.mac.target, "dmg");
});
