const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  isAllowedRendererUrl,
  isLoopbackRendererUrl,
  isTrustedRendererEvent,
} = require("./security.cjs");

test("only the main renderer frame can use privileged IPC", () => {
  const mainFrame = {};
  const subFrame = {};
  const webContents = { mainFrame };
  const mainWindow = { webContents };

  assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, mainWindow), true);
  assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: subFrame }, mainWindow), false);
  assert.equal(isTrustedRendererEvent({ sender: {}, senderFrame: mainFrame }, mainWindow), false);
  assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: null }, mainWindow), false);
});

test("renderer navigation is limited to the expected local origin", () => {
  const devOptions = { isDev: true, rendererUrl: "http://127.0.0.1:5173" };
  assert.equal(isLoopbackRendererUrl("http://127.0.0.1:5173"), true);
  assert.equal(isLoopbackRendererUrl("https://localhost:4173"), true);
  assert.equal(isLoopbackRendererUrl("https://evil.example/"), false);
  assert.equal(isLoopbackRendererUrl("http://user@127.0.0.1:5173"), false);
  assert.equal(isAllowedRendererUrl("http://127.0.0.1:5173/", devOptions), true);
  assert.equal(isAllowedRendererUrl("http://127.0.0.1:5173/other", devOptions), true);
  assert.equal(isAllowedRendererUrl("http://evil.example/", devOptions), false);
  assert.equal(isAllowedRendererUrl("file:///tmp/evil.html", devOptions), false);
  assert.equal(
    isAllowedRendererUrl("file:///C:/Program%20Files/WinOTP/dist/index.html", {
      isDev: false,
      rendererUrl: "not a dev URL",
      rendererFilePath: "C:\\Program Files\\WinOTP\\dist\\index.html",
    }),
    true,
  );
  assert.equal(
    isAllowedRendererUrl("file:///C:/Program%20Files/WinOTP/evil.html", {
      isDev: false,
      rendererUrl: "http://127.0.0.1:5173",
      rendererFilePath: "C:\\Program Files\\WinOTP\\dist\\index.html",
    }),
    false,
  );
  assert.equal(
    isAllowedRendererUrl("https://evil.example/", {
      isDev: false,
      rendererUrl: "http://127.0.0.1:5173",
      rendererFilePath: "C:\\Program Files\\WinOTP\\dist\\index.html",
    }),
    false,
  );
});
