const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { build } = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("application source is TypeScript and the CommonJS source is checked", () => {
  const sources = ["src", "electron", "scripts", "test"].flatMap((directory) =>
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name)),
  );
  assert.deepEqual(
    sources.filter((filename) => /\.(?:cjs|mjs|js|jsx)$/i.test(filename)),
    [],
  );
  assert.deepEqual(
    sources.filter(
      (filename) =>
        filename.endsWith(".cts") &&
        /(?:^|\n)\s*\/\/\s*@ts-nocheck\b/.test(fs.readFileSync(filename, "utf8")),
    ),
    [],
  );
});

test("Electron Builder configures the installer formats consumed by the updater", () => {
  assert.equal(build.win.target, "nsis");
  assert.deepEqual([...build.linux.target].sort(), ["AppImage", "deb", "rpm"]);
  assert.equal(build.mac.target, "dmg");
});

test("the Windows installer keeps the per-user upgrade identity and preserves app data", () => {
  assert.equal(build.appId, "com.xbounceit.winotp");
  assert.equal(build.nsis.guid, "9C96A88A-8F18-4B57-9F59-AB4E2A8760D1");
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
});

test("native installers include the configured install and uninstall hooks", () => {
  for (const hook of [build.nsis.include, build.deb.afterRemove, build.rpm.afterRemove]) {
    assert.equal(typeof hook, "string");
    assert.ok(fs.statSync(hook).isFile(), hook);
  }
});
