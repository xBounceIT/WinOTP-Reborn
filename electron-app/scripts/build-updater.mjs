import { chmod, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(electronDirectory, "..");
const manifestPath = path.join(repositoryRoot, "rust", "Cargo.toml");
const binaryName = process.platform === "win32" ? "winotp-updater.exe" : "winotp-updater";
const nativeDirectory = path.join(electronDirectory, "native");
const packagedBinaryPath = path.join(nativeDirectory, binaryName);

async function makeExecutable() {
  if (process.platform !== "win32") {
    await chmod(packagedBinaryPath, 0o755);
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
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
    await runCommand("cargo", [
      "build",
      "--release",
      "--manifest-path",
      manifestPath,
      "--bin",
      "winotp-updater",
    ]);
    await copyFile(
      path.join(repositoryRoot, "rust", "target", "release", binaryName),
      packagedBinaryPath,
    );
    await makeExecutable();
    return;
  }

  const macTargets = ["x86_64-apple-darwin", "aarch64-apple-darwin"];
  await runCommand("rustup", ["target", "add", ...macTargets]);
  for (const target of macTargets) {
    await runCommand("cargo", [
      "build",
      "--release",
      "--target",
      target,
      "--manifest-path",
      manifestPath,
      "--bin",
      "winotp-updater",
    ]);
  }

  await runCommand("lipo", [
    "-create",
    "-output",
    packagedBinaryPath,
    ...macTargets.map((target) =>
      path.join(repositoryRoot, "rust", "target", target, "release", binaryName),
    ),
  ]);
  await makeExecutable();
}

await buildUpdater();
console.log(`Copied ${binaryName} to ${path.relative(repositoryRoot, packagedBinaryPath)}.`);
