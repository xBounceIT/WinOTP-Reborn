import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(electronDirectory, "..");
const manifestPath = path.join(repositoryRoot, "rust", "Cargo.toml");
const binaryName = process.platform === "win32" ? "winotp-updater.exe" : "winotp-updater";
const builtBinaryPath = path.join(repositoryRoot, "rust", "target", "release", binaryName);
const nativeDirectory = path.join(electronDirectory, "native");
const packagedBinaryPath = path.join(nativeDirectory, binaryName);

function runCargo() {
  return new Promise((resolve, reject) => {
    const cargo = spawn(
      "cargo",
      ["build", "--release", "--manifest-path", manifestPath, "--bin", "winotp-updater"],
      { cwd: repositoryRoot, stdio: "inherit", windowsHide: true },
    );
    cargo.once("error", reject);
    cargo.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`cargo build exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

await runCargo();
await mkdir(nativeDirectory, { recursive: true });
await copyFile(builtBinaryPath, packagedBinaryPath);
console.log(`Copied ${binaryName} to ${path.relative(repositoryRoot, packagedBinaryPath)}.`);
