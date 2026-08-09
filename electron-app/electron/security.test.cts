const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  hasConfiguredProtection,
  isSecurityMigrationPending,
  isUnprotectedProfile,
  isAllowedExternalUrl,
  isAllowedRendererUrl,
  isLoopbackRendererUrl,
  isRendererUnlockedState,
  shouldUseDevelopmentRenderer,
  isTrustedScreenCaptureEvent,
  isTrustedRendererEvent,
} = require("./security.cjs");

test("only the main renderer frame can use privileged IPC", () => {
  const mainFrame = {};
  const subFrame = {};
  const webContents = { mainFrame };
  const mainWindow = { webContents };

  assert.equal(
    isTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, mainWindow),
    true,
  );
  assert.equal(
    isTrustedRendererEvent({ sender: webContents, senderFrame: subFrame }, mainWindow),
    false,
  );
  assert.equal(isTrustedRendererEvent({ sender: {}, senderFrame: mainFrame }, mainWindow), false);
  assert.equal(
    isTrustedRendererEvent({ sender: webContents, senderFrame: null }, mainWindow),
    false,
  );
});

test("requires both an authenticated unlock signal and an unlocked tray state", () => {
  assert.equal(isRendererUnlockedState(false, { locked: false }), false);
  assert.equal(isRendererUnlockedState(true, { locked: true }), false);
  assert.equal(isRendererUnlockedState(true, { locked: false }), true);
  assert.equal(isRendererUnlockedState(true, undefined), false);
});

test("does not treat remote fallback flags as protection by themselves", () => {
  assert.equal(hasConfiguredProtection({ remotePin: true, remotePassword: true }), false);
  assert.equal(hasConfiguredProtection({ windowsHello: true, remotePin: true }), true);
  assert.equal(hasConfiguredProtection({ pinProtection: true }), true);
});

test("does not treat a profile with incomplete app-lock migration as unprotected", () => {
  assert.equal(isUnprotectedProfile({}, false), true);
  assert.equal(isUnprotectedProfile({ pinProtection: true }, false), false);
  assert.equal(isUnprotectedProfile({}, true), false);
});

test("treats settings migration failure as security-pending", () => {
  assert.equal(isSecurityMigrationPending(false, false), false);
  assert.equal(isSecurityMigrationPending(true, false), true);
  assert.equal(isSecurityMigrationPending(false, true), true);
});

test("only the active screen-capture overlay main frame can submit capture IPC", () => {
  const mainFrame = {};
  const subFrame = {};
  const webContents = { mainFrame };
  const captureWebContents = new Set([webContents]);

  assert.equal(
    isTrustedScreenCaptureEvent(
      { sender: webContents, senderFrame: mainFrame },
      captureWebContents,
    ),
    true,
  );
  assert.equal(
    isTrustedScreenCaptureEvent({ sender: webContents, senderFrame: subFrame }, captureWebContents),
    false,
  );
  assert.equal(
    isTrustedScreenCaptureEvent({ sender: {}, senderFrame: mainFrame }, captureWebContents),
    false,
  );
});

test("renderer navigation is limited to the expected local origin", () => {
  const devOptions = { isDev: true, rendererUrl: "http://127.0.0.1:5173" };
  const rendererFilePath = path.resolve("fixture app", "dist", "index.html");
  const unexpectedRendererFilePath = path.resolve("fixture app", "evil.html");
  assert.equal(isLoopbackRendererUrl("http://127.0.0.1:5173"), true);
  assert.equal(isLoopbackRendererUrl("https://localhost:4173"), true);
  assert.equal(isLoopbackRendererUrl("https://evil.example/"), false);
  assert.equal(isLoopbackRendererUrl("http://user@127.0.0.1:5173"), false);
  assert.equal(isAllowedRendererUrl("http://127.0.0.1:5173/", devOptions), true);
  assert.equal(isAllowedRendererUrl("http://127.0.0.1:5173/other", devOptions), true);
  assert.equal(isAllowedRendererUrl("http://evil.example/", devOptions), false);
  assert.equal(isAllowedRendererUrl("file:///tmp/evil.html", devOptions), false);
  assert.equal(
    isAllowedRendererUrl(pathToFileURL(rendererFilePath).href, {
      isDev: false,
      rendererUrl: "not a dev URL",
      rendererFilePath,
    }),
    true,
  );
  assert.equal(
    isAllowedRendererUrl(pathToFileURL(unexpectedRendererFilePath).href, {
      isDev: false,
      rendererUrl: "http://127.0.0.1:5173",
      rendererFilePath,
    }),
    false,
  );
  assert.equal(
    isAllowedRendererUrl("https://evil.example/", {
      isDev: false,
      rendererUrl: "http://127.0.0.1:5173",
      rendererFilePath,
    }),
    false,
  );
});

test("development renderer loading never accepts a remote URL", () => {
  assert.equal(
    shouldUseDevelopmentRenderer({
      isPackaged: false,
      isDevelopment: true,
      rendererUrl: "http://127.0.0.1:5173",
    }),
    true,
  );
  assert.equal(
    shouldUseDevelopmentRenderer({
      isPackaged: false,
      isDevelopment: true,
      rendererUrl: "https://example.com/winotp",
    }),
    false,
  );
  assert.equal(
    shouldUseDevelopmentRenderer({
      isPackaged: true,
      isDevelopment: true,
      rendererUrl: "http://127.0.0.1:5173",
    }),
    false,
  );
});

test("external links are limited to credential-free HTTP(S) URLs", () => {
  assert.equal(isAllowedExternalUrl("https://example.com/docs"), true);
  assert.equal(isAllowedExternalUrl("http://localhost:5173/help"), true);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("https://user:password@example.com"), false);
  assert.equal(isAllowedExternalUrl("not a URL"), false);
});
