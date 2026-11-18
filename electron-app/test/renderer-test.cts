const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const rendererTestOptions = {
  skip: process.platform === "linux" && !process.env.DISPLAY,
  timeout: 60_000,
};

async function runRendererTest(
  fixture: string,
  exercise: (
    waitFor: (condition: () => unknown, message: string) => Promise<void>,
  ) => Promise<void>,
) {
  const { build } = await import("vite");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winotp-renderer-test-"));
  const input = "virtual:renderer-test.tsx";
  try {
    await build({
      logLevel: "error",
      plugins: [
        {
          name: "renderer-test-fixture",
          resolveId: (id) => (id === input ? input : undefined),
          load: (id) => (id === input ? fixture : undefined),
        },
      ],
      build: {
        outDir: directory,
        emptyOutDir: false,
        rollupOptions: { input, output: { entryFileNames: "renderer.js" } },
      },
    });
    const styles = (await fs.readdir(path.join(directory, "assets"))).filter((name) =>
      name.endsWith(".css"),
    );
    const links = styles.map((name) => `<link rel="stylesheet" href="./assets/${name}">`);
    const indexPath = path.join(directory, "index.html");
    const exercisePath = path.join(directory, "exercise.js");
    await fs.writeFile(
      indexPath,
      `<!doctype html><html><head>${links.join("")}</head><body><div id="root"></div><script type="module" src="./renderer.js"></script></body></html>`,
    );
    await fs.writeFile(exercisePath, `(${exercise.toString()})(${waitFor.toString()})`);

    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        require("electron"),
        [path.join(__dirname, "renderer-test-driver.cjs"), indexPath, exercisePath],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const timer = setTimeout(() => child.kill(), 30_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
    assert.equal(result.code, 0, result.output);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function waitFor(condition: () => unknown, message: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

module.exports = { rendererTestOptions, runRendererTest };
