const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test } = require("node:test");

test(
  "QR review fits the desktop window and waits for explicit asynchronous confirmation",
  {
    skip: process.platform === "linux" && !process.env.DISPLAY,
    timeout: 60_000,
  },
  async () => {
    const { build } = await import("vite");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winotp-qr-ui-"));
    const input = "virtual:qr-review.tsx";
    try {
      await build({
        logLevel: "error",
        plugins: [
          {
            name: "qr-review-test-fixture",
            resolveId: (id) => (id === input ? input : undefined),
            load: (id) =>
              id === input
                ? `
          import { createElement } from "react";
          import { createRoot } from "react-dom/client";
          import { BrowserQrReviewDialog } from "@/pages/ImportPage";
          import "@/index.css";
          const root = createRoot(document.getElementById("root"));
          window.confirmations = 0;
          root.render(createElement(BrowserQrReviewDialog, {
            review: { id: "review", issuer: "Issuer".repeat(650), accountName: "Account".repeat(550),
              algorithm: "SHA1", digits: 6, period: 30, saving: false, queuedCount: 1 },
            onConfirm: () => { window.confirmations++; return new Promise(resolve => { window.finishSave = resolve; }); },
            onCancel: async () => root.unmount(),
          }));
        `
                : undefined,
          },
        ],
        build: {
          outDir: directory,
          emptyOutDir: false,
          rollupOptions: { input, output: { entryFileNames: "review.js" } },
        },
      });
      const styles = (await fs.readdir(path.join(directory, "assets"))).filter((name) =>
        name.endsWith(".css"),
      );
      await fs.writeFile(
        path.join(directory, "index.html"),
        `<!doctype html><html><head>${styles.map((name) => `<link rel="stylesheet" href="./assets/${name}">`).join("")}</head><body><div id="root"></div><script type="module" src="./review.js"></script></body></html>`,
      );
      const result = await new Promise<any>((resolve, reject) => {
        const child = spawn(
          require("electron"),
          [
            path.join(__dirname, "browser-qr-review-driver.cjs"),
            path.join(directory, "index.html"),
          ],
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
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /QR_UI_OK/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
