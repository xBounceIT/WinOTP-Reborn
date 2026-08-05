import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "electron-dist");
const typescriptEntry = path.join(projectDirectory, "node_modules", "typescript", "bin", "tsc");

function compileElectron(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [typescriptEntry, "-p", "tsconfig.electron.json"], {
      cwd: projectDirectory,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`TypeScript compilation exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

await rm(outputDirectory, { recursive: true, force: true });
await compileElectron();
