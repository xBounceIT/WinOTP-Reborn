const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  CHROME_EXTENSION_ORIGIN,
  FIREFOX_EXTENSION_ID,
  NATIVE_HOST_NAME,
  createNativeMessagingRegistration,
  getBrowserBridgeBinaryCandidates,
  installPortableBrowserBridge,
  nativeHostManifest,
  registrationTargets,
  restrictWindowsPath,
  resolveBrowserBridgeBinary,
  writeJsonAtomically,
} = require("./browser-bridge-registration.cjs");

function createDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "winotp-browser-registration-"));
}

test("builds allow-listed Chrome and Firefox Native Messaging manifests", () => {
  const executablePath = path.resolve("fixture", "winotp-browser-bridge");
  assert.equal(CHROME_EXTENSION_ORIGIN, "chrome-extension://gomcpjbgmfdggpnbplajohjkjbbjijln/");
  assert.equal(FIREFOX_EXTENSION_ID, "{250f3c41-cf5e-4c20-a07c-e99a8532436b}");
  assert.deepEqual(nativeHostManifest("chrome", executablePath), {
    name: NATIVE_HOST_NAME,
    description: "WinOTP Reborn Browser Bridge",
    path: executablePath,
    type: "stdio",
    allowed_origins: [CHROME_EXTENSION_ORIGIN],
  });
  assert.deepEqual(nativeHostManifest("firefox", executablePath), {
    name: NATIVE_HOST_NAME,
    description: "WinOTP Reborn Browser Bridge",
    path: executablePath,
    type: "stdio",
    allowed_extensions: [FIREFOX_EXTENSION_ID],
  });
  assert.throws(() => nativeHostManifest("firefox", "relative-host"), /absolute/);
});

test("finds development and packaged browser bridge binaries", () => {
  const resourcesPath = path.resolve("fixture-resources");
  const candidates = getBrowserBridgeBinaryCandidates({
    platform: "win32",
    environment: { RESOURCES_PATH: resourcesPath },
    dirname: path.resolve("electron-dist", "electron"),
  });
  assert.ok(candidates.includes(path.join(resourcesPath, "updater", "winotp-browser-bridge.exe")));
  assert.ok(candidates.some((candidate) => candidate.endsWith("winotp-browser-bridge.exe")));
  const isolatedDirectory = createDirectory();
  try {
    assert.equal(
      resolveBrowserBridgeBinary({
        platform: "win32",
        environment: { WINOTP_BROWSER_BRIDGE_PATH: "package.json" },
        dirname: isolatedDirectory,
      }),
      undefined,
    );
  } finally {
    fs.rmSync(isolatedDirectory, { recursive: true, force: true });
  }
  assert.equal(
    getBrowserBridgeBinaryCandidates({
      platform: "win32",
      environment: { WINOTP_BROWSER_BRIDGE_PATH: "relative-host.exe" },
      dirname: path.resolve("electron-dist", "electron"),
    })[0],
    "relative-host.exe",
  );
});

test("applies a private Windows ACL before atomically publishing JSON", () => {
  const directoryPath = createDirectory();
  const filePath = path.join(directoryPath, "descriptor.json");
  const events = [];
  const fsModule = Object.create(fs);
  fsModule.renameSync = (sourcePath, destinationPath) => {
    events.push("rename");
    fs.renameSync(sourcePath, destinationPath);
  };
  const spawnProcess = () => {
    events.push("restrict-acl");
    return { status: 0 };
  };
  try {
    writeJsonAtomically(
      filePath,
      { token: "private" },
      {
        fsModule,
        platform: "win32",
        environment: { USERDOMAIN: "TEST", USERNAME: "tester" },
        spawnProcess,
      },
    );
    assert.deepEqual(events, ["restrict-acl", "rename"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { token: "private" });
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("replaces a Windows directory DACL in one native operation", () => {
  const calls = [];
  restrictWindowsPath("C:\\Users\\tester\\runtime", {
    platform: "win32",
    directory: true,
    environment: { USERDOMAIN: "TEST", USERNAME: "tester" },
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, environment: options.env });
      return { status: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.ok(calls[0].args.includes("-EncodedCommand"));
  assert.equal(calls[0].environment.WINOTP_ACL_TARGET, "C:\\Users\\tester\\runtime");
  assert.equal(calls[0].environment.WINOTP_ACL_PRINCIPAL, "TEST\\tester");
});

test("cleans a temporary portable host copy after a failed publish", () => {
  const directoryPath = createDirectory();
  const sourcePath = path.join(directoryPath, "source-host");
  const destinationPath = path.join(directoryPath, "host", "winotp-browser-bridge");
  const fsModule = Object.create(fs);
  fs.writeFileSync(sourcePath, "fixture");
  fsModule.renameSync = () => {
    throw new Error("rename failed");
  };
  try {
    assert.throws(
      () => installPortableBrowserBridge(sourcePath, destinationPath, { fsModule }),
      /rename failed/,
    );
    assert.equal(
      fs.readdirSync(path.dirname(destinationPath)).some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("uses the documented per-user registration locations on Unix", () => {
  const homeDirectory = path.resolve("fixture-home");
  const linux = registrationTargets("linux", homeDirectory);
  assert.ok(
    linux.chrome.includes(path.join(homeDirectory, ".config/google-chrome/NativeMessagingHosts")),
  );
  assert.deepEqual(linux.firefox, [path.join(homeDirectory, ".mozilla/native-messaging-hosts")]);

  const mac = registrationTargets("darwin", homeDirectory);
  assert.ok(
    mac.firefox.includes(
      path.join(homeDirectory, "Library/Application Support/Mozilla/NativeMessagingHosts"),
    ),
  );
});

test("installs and removes the allow-listed per-user manifests on Unix", () => {
  for (const platform of ["darwin", "linux"]) {
    const directoryPath = createDirectory();
    const homeDirectory = path.join(directoryPath, "home");
    const executablePath = path.join(directoryPath, "winotp-browser-bridge");
    try {
      fs.mkdirSync(homeDirectory, { recursive: true });
      fs.writeFileSync(executablePath, "fixture");
      const registration = createNativeMessagingRegistration({
        platform,
        environment: { HOME: homeDirectory, XDG_DATA_HOME: path.join(directoryPath, "data") },
        homeDirectory,
        executablePath,
      });
      registration.install();

      const targets = registrationTargets(platform, homeDirectory);
      for (const targetDirectory of targets.chrome) {
        const manifestPath = path.join(targetDirectory, `${NATIVE_HOST_NAME}.json`);
        assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")).allowed_origins, [
          CHROME_EXTENSION_ORIGIN,
        ]);
      }
      for (const targetDirectory of targets.firefox) {
        const manifestPath = path.join(targetDirectory, `${NATIVE_HOST_NAME}.json`);
        assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")).allowed_extensions, [
          FIREFOX_EXTENSION_ID,
        ]);
      }

      registration.uninstall();
      for (const targetDirectory of [...targets.chrome, ...targets.firefox]) {
        assert.equal(fs.existsSync(path.join(targetDirectory, `${NATIVE_HOST_NAME}.json`)), false);
      }
    } finally {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  }
});

test("keeps the AppImage Native Messaging host available after the app exits", () => {
  const directoryPath = createDirectory();
  const homeDirectory = path.join(directoryPath, "home");
  const dataDirectory = path.join(directoryPath, "data");
  const executablePath = path.join(directoryPath, "mounted-appimage-host");
  try {
    fs.mkdirSync(homeDirectory, { recursive: true });
    fs.writeFileSync(executablePath, "fixture", { mode: 0o700 });
    const registration = createNativeMessagingRegistration({
      platform: "linux",
      environment: {
        HOME: homeDirectory,
        XDG_DATA_HOME: dataDirectory,
        APPIMAGE: "/tmp/WinOTP.AppImage",
      },
      homeDirectory,
      executablePath,
    });
    const result = registration.install();
    const manifestPath = path.join(
      homeDirectory,
      ".mozilla/native-messaging-hosts",
      `${NATIVE_HOST_NAME}.json`,
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.notEqual(manifest.path, executablePath);
    assert.equal(manifest.path, result.executablePath);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(manifest.path).mode & 0o077, 0);
    }

    fs.rmSync(executablePath);
    assert.equal(fs.statSync(manifest.path).isFile(), true);

    registration.uninstall();
    assert.equal(fs.existsSync(manifest.path), false);
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

test("registers and removes only WinOTP Native Messaging keys on Windows", () => {
  const directoryPath = createDirectory();
  const executablePath = path.join(directoryPath, "winotp-browser-bridge.exe");
  const registryCalls = [];
  const spawnProcess = (command, args) => {
    if (command === "reg.exe") {
      registryCalls.push(args);
    }
    return { status: 0 };
  };
  try {
    fs.writeFileSync(executablePath, "fixture");
    const registration = createNativeMessagingRegistration({
      platform: "win32",
      environment: {
        LOCALAPPDATA: directoryPath,
        USERDOMAIN: "TEST",
        USERNAME: "tester",
      },
      executablePath,
      spawnProcess,
    });
    const result = registration.install();
    assert.equal(result.chromeConfigured, true);
    const manifestDirectory = path.join(directoryPath, "WinOTP_Reborn", "native-messaging");
    const chromeManifestPath = path.join(manifestDirectory, `${NATIVE_HOST_NAME}.chrome.json`);
    const firefoxManifestPath = path.join(manifestDirectory, `${NATIVE_HOST_NAME}.firefox.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(chromeManifestPath, "utf8")).allowed_origins, [
      CHROME_EXTENSION_ORIGIN,
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(firefoxManifestPath, "utf8")).allowed_extensions, [
      FIREFOX_EXTENSION_ID,
    ]);
    assert.deepEqual(
      registryCalls.filter((args) => args[0] === "add"),
      [
        [
          "add",
          `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          chromeManifestPath,
          "/f",
        ],
        [
          "add",
          `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          chromeManifestPath,
          "/f",
        ],
        [
          "add",
          `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          firefoxManifestPath,
          "/f",
        ],
      ],
    );

    registration.uninstall();
    assert.deepEqual(
      registryCalls.filter((args) => args[0] === "delete"),
      [
        [
          "delete",
          `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
          "/f",
        ],
        ["delete", `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, "/f"],
        ["delete", `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`, "/f"],
      ],
    );
  } finally {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});
