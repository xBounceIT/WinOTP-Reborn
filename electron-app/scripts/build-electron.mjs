import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "electron-dist");

async function copyMatchingFiles(sourceDirectory, destinationDirectory, predicate) {
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !predicate(entry.name)) {
      continue;
    }

    await copyFile(
      path.join(sourceDirectory, entry.name),
      path.join(destinationDirectory, entry.name),
    );
  }
}

await rm(outputDirectory, { recursive: true, force: true });
await copyMatchingFiles(
  path.join(projectDirectory, "electron"),
  path.join(outputDirectory, "electron"),
  (name) => name.endsWith(".cjs"),
);
await copyMatchingFiles(
  path.join(projectDirectory, "test"),
  path.join(outputDirectory, "test"),
  (name) => name.endsWith(".test.cjs"),
);
