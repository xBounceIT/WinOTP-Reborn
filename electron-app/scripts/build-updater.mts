import { chmod, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(electronDirectory, "..");
const manifestPath = path.join(repositoryRoot, "rust", "Cargo.toml");
const nativeDirectory = path.join(electronDirectory, "native");
const binaries = process.argv.includes("--core-only")
  ? ["winotp-core"]
  : ["winotp-updater", "winotp-core"];

function binaryName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

async function makeExecutable(filePath) {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o755);
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
    for (const binary of binaries) {
      await runCommand("cargo", [
        "build",
        "--release",
        "--manifest-path",
        manifestPath,
        "--package",
        binary,
      ]);
      const name = binaryName(binary);
      const packagedBinaryPath = path.join(nativeDirectory, name);
      await copyFile(
        path.join(repositoryRoot, "rust", "target", "release", name),
        packagedBinaryPath,
      );
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
        binary,
      ]);
    }
  }

  for (const binary of binaries) {
    const name = binaryName(binary, "darwin");
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
  `Copied ${binaries.join(" and ")} to ${path.relative(repositoryRoot, nativeDirectory)}.`,
);
