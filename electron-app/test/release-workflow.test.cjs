const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(
  path.resolve(process.cwd(), "../.github/workflows/release.yml"),
  "utf8",
);

test("release build jobs use read-only contents permissions", () => {
  assert.match(workflow, /^permissions:\r?\n  contents: read\r?\n/m);
  assert.match(workflow, /release:\r?\n(?:.*\r?\n)*?    permissions:\r?\n      contents: write/m);
});

test("release publication is tag-verified and rerunnable", () => {
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh release create[\s\S]*--verify-tag/);
  assert.match(workflow, /gh release edit[\s\S]*--verify-tag/);
});
