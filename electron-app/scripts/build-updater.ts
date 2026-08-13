import { chmod, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(electronDirectory, "..");
const manifestPath = path.join(repositoryRoot, "rust", "Cargo.toml");
const nativeDirectory = path.join(electronDirectory, "native");
const runtimeBinaries = [
  { packageName: "winotp-core", binaryName: "winotp-core" },
  { packageName: "winotp-browser-bridge-host", binaryName: "winotp-browser-bridge" },
];
const binaries = process.argv.includes("--core-only")
  ? runtimeBinaries
  : [{ packageName: "winotp-updater", binaryName: "winotp-updater" }, ...runtimeBinaries];
const requestedTargetArchitecture = process.env.WINOTP_TARGET_ARCH?.trim().toLowerCase();

function binaryName(name: string, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

function rustTargetForArchitecture() {
  if (process.platform !== "win32" && process.platform !== "linux") {
    return undefined;
  }

  if (
    requestedTargetArchitecture === undefined ||
    requestedTargetArchitecture === "" ||
    requestedTargetArchitecture === "x64" ||
    requestedTargetArchitecture === "amd64"
  ) {
    return undefined;
  }

  if (requestedTargetArchitecture === "arm64") {
    return process.platform === "win32" ? "aarch64-pc-windows-msvc" : "aarch64-unknown-linux-gnu";
  }

  throw new Error(
    `Unsupported ${process.platform} target architecture: ${requestedTargetArchitecture}.`,
  );
}

async function makeExecutable(filePath: string) {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o755);
  }
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

async function buildUpdater() {
  await mkdir(nativeDirectory, { recursive: true });

  if (process.platform !== "darwin") {
    const target = rustTargetForArchitecture();
    if (target) {
      await runCommand("rustup", ["target", "add", target]);
    }
    const targetReleaseDirectory = target
      ? path.join(repositoryRoot, "rust", "target", target, "release")
      : path.join(repositoryRoot, "rust", "target", "release");

    for (const binary of binaries) {
      const cargoArguments = ["build", "--release"];
      if (target) {
        cargoArguments.push("--target", target);
      }
      cargoArguments.push("--manifest-path", manifestPath, "--package", binary.packageName);
      await runCommand("cargo", cargoArguments);
      const name = binaryName(binary.binaryName);
      const packagedBinaryPath = path.join(nativeDirectory, name);
      await copyFile(path.join(targetReleaseDirectory, name), packagedBinaryPath);
      await makeExecutable(packagedBinaryPath);
    }
    return;
  }

  const macTargets = ["x86_64-apple-darwin", "aarch64-apple-darwin"];
  await runCommand("rustup", ["target", "add", ...macTargets]);
  for (const target of macTargets) {
    for (const binary of binaries) {
      await runCommand("cargo", [
        "build",
        "--release",
        "--target",
        target,
        "--manifest-path",
        manifestPath,
        "--package",
        binary.packageName,
      ]);
    }
  }

  for (const binary of binaries) {
    const name = binaryName(binary.binaryName, "darwin");
    const packagedBinaryPath = path.join(nativeDirectory, name);
    await runCommand("lipo", [
      "-create",
      "-output",
      packagedBinaryPath,
      ...macTargets.map((target) =>
        path.join(repositoryRoot, "rust", "target", target, "release", name),
      ),
    ]);
    await makeExecutable(packagedBinaryPath);
  }
}

await buildUpdater();
console.log(
  `Copied ${binaries.map(({ binaryName: name }) => name).join(" and ")} to ${path.relative(repositoryRoot, nativeDirectory)}.`,
);
