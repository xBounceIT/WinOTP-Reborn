const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const NATIVE_HOST_NAME = "com.xbounceit.winotp";
const CHROME_EXTENSION_ORIGIN = "chrome-extension://gomcpjbgmfdggpnbplajohjkjbbjijln/";
const FIREFOX_EXTENSION_ID = "{250f3c41-cf5e-4c20-a07c-e99a8532436b}";
const PRIVATE_DIRECTORY_ACL_SCRIPT = `
$targetPath = $env:WINOTP_ACL_TARGET
$identity = [System.Security.Principal.NTAccount]::new($env:WINOTP_ACL_PRINCIPAL)
$security = [System.Security.AccessControl.DirectorySecurity]::new()
$security.SetOwner($identity)
$security.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $identity,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$security.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($targetPath, $security)
`.trim();
const PRIVATE_DIRECTORY_ACL_COMMAND = Buffer.from(PRIVATE_DIRECTORY_ACL_SCRIPT, "utf16le").toString(
  "base64",
);

function browserBridgeBinaryName(platform = process.platform) {
  return platform === "win32" ? "winotp-browser-bridge.exe" : "winotp-browser-bridge";
}

function getBrowserBridgeBinaryCandidates({
  environment = process.env,
  platform = process.platform,
  dirname = __dirname,
}: any = {}) {
  const binaryName = browserBridgeBinaryName(platform);
  const candidates = [];
  if (environment.WINOTP_BROWSER_BRIDGE_PATH) {
    candidates.push(environment.WINOTP_BROWSER_BRIDGE_PATH);
  }

  candidates.push(path.join(dirname, "..", "native", binaryName));
  candidates.push(path.join(dirname, "..", "..", "native", binaryName));
  candidates.push(path.join(dirname, "..", "..", "rust", "target", "release", binaryName));
  candidates.push(path.join(dirname, "..", "..", "rust", "target", "debug", binaryName));

  if (environment.RESOURCES_PATH) {
    candidates.push(path.join(environment.RESOURCES_PATH, "updater", binaryName));
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath) {
    candidates.push(path.join(resourcesPath, "updater", binaryName));
  }
  return [...new Set(candidates)];
}

function resolveBrowserBridgeBinary(options: any = {}) {
  const platform = options.platform ?? process.platform;
  return getBrowserBridgeBinaryCandidates(options).find((candidate) => {
    try {
      if (!path.isAbsolute(candidate)) {
        return false;
      }
      const stats = fs.statSync(candidate);
      if (!stats.isFile()) {
        return false;
      }
      if (platform !== "win32") {
        fs.accessSync(candidate, fs.constants.X_OK);
      }
      return true;
    } catch {
      return false;
    }
  });
}

function nativeHostManifest(browser, executablePath) {
  if (!path.isAbsolute(executablePath)) {
    throw new Error("The Native Messaging host path must be absolute.");
  }
  const common = {
    name: NATIVE_HOST_NAME,
    description: "WinOTP Reborn Browser Bridge",
    path: executablePath,
    type: "stdio",
  };
  if (browser === "chrome") {
    return { ...common, allowed_origins: [CHROME_EXTENSION_ORIGIN] };
  }
  if (browser === "firefox") {
    return { ...common, allowed_extensions: [FIREFOX_EXTENSION_ID] };
  }
  throw new Error("The Native Messaging browser is unsupported.");
}

function localDataRoot(app, { environment = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    return environment.LOCALAPPDATA || app?.getPath?.("userData") || os.homedir();
  }
  const homeDirectory = environment.HOME || os.homedir();
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support");
  }
  return environment.XDG_DATA_HOME || path.join(homeDirectory, ".local", "share");
}

function windowsPrincipal(environment = process.env) {
  const userName = String(environment.USERNAME ?? "").trim();
  const domain = String(environment.USERDOMAIN ?? "").trim();
  if (!userName) {
    throw new Error("The current Windows account could not be identified.");
  }
  return domain ? `${domain}\\${userName}` : userName;
}

function restrictWindowsPath(filePath, options: any = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return;
  }
  const spawnProcess = options.spawnProcess ?? spawnSync;
  const environment = options.environment ?? process.env;
  const principal = windowsPrincipal(environment);
  if (options.directory === true) {
    const result = spawnProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        PRIVATE_DIRECTORY_ACL_COMMAND,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          ...environment,
          WINOTP_ACL_TARGET: filePath,
          WINOTP_ACL_PRINCIPAL: principal,
        },
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error("WinOTP could not restrict the browser bridge directory.");
    }
    return;
  }

  const restrictResult = spawnProcess(
    "icacls.exe",
    [filePath, "/inheritance:r", "/grant:r", `${principal}:F`],
    { encoding: "utf8", windowsHide: true },
  );
  if (restrictResult.error || restrictResult.status !== 0) {
    throw new Error("WinOTP could not restrict browser bridge access to the current user.");
  }
}

function writeJsonAtomically(filePath, value, options: any = {}) {
  const fsModule = options.fsModule ?? fs;
  const platform = options.platform ?? process.platform;
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsModule.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (platform !== "win32") {
    fsModule.chmodSync(path.dirname(filePath), 0o700);
  }
  try {
    const descriptor = fsModule.openSync(temporaryPath, "wx", 0o600);
    try {
      fsModule.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fsModule.fsyncSync(descriptor);
    } finally {
      fsModule.closeSync(descriptor);
    }
    if (platform === "win32") {
      restrictWindowsPath(temporaryPath, options);
    } else {
      fsModule.chmodSync(temporaryPath, 0o600);
    }
    fsModule.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fsModule.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write, permission, or rename failure.
    }
    throw error;
  }
}

function installPortableBrowserBridge(sourcePath, destinationPath, options: any = {}) {
  const fsModule = options.fsModule ?? fs;
  const directoryPath = path.dirname(destinationPath);
  const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  fsModule.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const metadata = fsModule.lstatSync(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The portable Native Messaging host directory is unsafe.");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("The portable Native Messaging host directory belongs to another user.");
  }
  fsModule.chmodSync(directoryPath, 0o700);
  try {
    fsModule.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    fsModule.chmodSync(temporaryPath, 0o700);
    fsModule.renameSync(temporaryPath, destinationPath);
  } catch (error) {
    try {
      fsModule.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original copy, permission, or rename failure.
    }
    throw error;
  }
  return destinationPath;
}

function runRegistry(spawnProcess, args, tolerateMissing = false) {
  const result = spawnProcess("reg.exe", args, { encoding: "utf8", windowsHide: true });
  if (result.error || (result.status !== 0 && !tolerateMissing)) {
    throw new Error("WinOTP could not update the Native Messaging registration.");
  }
}

function registrationTargets(platform, homeDirectory) {
  if (platform === "darwin") {
    return {
      chrome: [
        path.join(homeDirectory, "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        path.join(homeDirectory, "Library/Application Support/Chromium/NativeMessagingHosts"),
      ],
      firefox: [
        path.join(homeDirectory, "Library/Application Support/Mozilla/NativeMessagingHosts"),
      ],
    };
  }
  return {
    chrome: [
      path.join(homeDirectory, ".config/google-chrome/NativeMessagingHosts"),
      path.join(homeDirectory, ".config/chromium/NativeMessagingHosts"),
    ],
    firefox: [path.join(homeDirectory, ".mozilla/native-messaging-hosts")],
  };
}

function createNativeMessagingRegistration(options: any = {}) {
  const app = options.app;
  const fsModule = options.fsModule ?? fs;
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const spawnProcess = options.spawnProcess ?? spawnSync;
  const homeDirectory = options.homeDirectory ?? environment.HOME ?? os.homedir();
  const manifestDirectory = path.join(
    localDataRoot(app, { environment, platform }),
    "WinOTP_Reborn",
    "native-messaging",
  );
  const chromeManifestPath = path.join(manifestDirectory, `${NATIVE_HOST_NAME}.chrome.json`);
  const firefoxManifestPath = path.join(manifestDirectory, `${NATIVE_HOST_NAME}.firefox.json`);
  const portableExecutablePath = path.join(
    manifestDirectory,
    "host",
    browserBridgeBinaryName(platform),
  );

  function removeFile(filePath) {
    try {
      fsModule.rmSync(filePath, { force: true });
    } catch {
      // A stale registration is harmless when the endpoint is absent. Retry next time.
    }
  }

  function install() {
    const sourceExecutablePath =
      options.executablePath ??
      resolveBrowserBridgeBinary({ environment, platform, dirname: options.dirname ?? __dirname });
    if (!sourceExecutablePath) {
      throw new Error("The WinOTP Native Messaging host is unavailable.");
    }
    const executablePath =
      platform === "linux" && Boolean(environment.APPIMAGE)
        ? installPortableBrowserBridge(sourceExecutablePath, portableExecutablePath, { fsModule })
        : sourceExecutablePath;
    const firefoxManifest = nativeHostManifest("firefox", executablePath);
    const chromeManifest = nativeHostManifest("chrome", executablePath);

    if (platform === "win32") {
      fsModule.mkdirSync(manifestDirectory, { recursive: true });
      restrictWindowsPath(manifestDirectory, {
        platform,
        environment,
        spawnProcess,
        directory: true,
      });
      writeJsonAtomically(firefoxManifestPath, firefoxManifest, {
        fsModule,
        platform,
        environment,
        spawnProcess,
      });
      writeJsonAtomically(chromeManifestPath, chromeManifest, {
        fsModule,
        platform,
        environment,
        spawnProcess,
      });

      const chromeRoots = [
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
        "HKCU\\Software\\Chromium\\NativeMessagingHosts",
      ];
      for (const root of chromeRoots) {
        const key = `${root}\\${NATIVE_HOST_NAME}`;
        runRegistry(spawnProcess, [
          "add",
          key,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          chromeManifestPath,
          "/f",
        ]);
      }
      runRegistry(spawnProcess, [
        "add",
        `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        firefoxManifestPath,
        "/f",
      ]);
      return { executablePath, chromeConfigured: true };
    }

    const targets = registrationTargets(platform, homeDirectory);
    for (const directory of targets.firefox) {
      writeJsonAtomically(path.join(directory, `${NATIVE_HOST_NAME}.json`), firefoxManifest, {
        fsModule,
        platform,
      });
    }
    for (const directory of targets.chrome) {
      const manifestPath = path.join(directory, `${NATIVE_HOST_NAME}.json`);
      writeJsonAtomically(manifestPath, chromeManifest, { fsModule, platform });
    }
    return { executablePath, chromeConfigured: true };
  }

  function uninstall() {
    if (platform === "win32") {
      for (const root of [
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
        "HKCU\\Software\\Chromium\\NativeMessagingHosts",
        "HKCU\\Software\\Mozilla\\NativeMessagingHosts",
      ]) {
        runRegistry(spawnProcess, ["delete", `${root}\\${NATIVE_HOST_NAME}`, "/f"], true);
      }
      removeFile(chromeManifestPath);
      removeFile(firefoxManifestPath);
      removeFile(portableExecutablePath);
      return;
    }
    const targets = registrationTargets(platform, homeDirectory);
    for (const directory of [...targets.chrome, ...targets.firefox]) {
      removeFile(path.join(directory, `${NATIVE_HOST_NAME}.json`));
    }
    removeFile(portableExecutablePath);
  }

  return { install, uninstall };
}

module.exports = {
  CHROME_EXTENSION_ORIGIN,
  FIREFOX_EXTENSION_ID,
  NATIVE_HOST_NAME,
  browserBridgeBinaryName,
  createNativeMessagingRegistration,
  getBrowserBridgeBinaryCandidates,
  installPortableBrowserBridge,
  localDataRoot,
  nativeHostManifest,
  registrationTargets,
  resolveBrowserBridgeBinary,
  restrictWindowsPath,
  writeJsonAtomically,
};
