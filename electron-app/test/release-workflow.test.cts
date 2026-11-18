const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { load } = require("js-yaml");

const workflow = load(fs.readFileSync("../.github/workflows/release.yml", "utf8"));
const { checks, package: packaging, release } = workflow.jobs;
const { version: packageVersion } = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("only the publishing job can write repository contents", () => {
  assert.equal((checks.permissions ?? workflow.permissions).contents, "read");
  assert.equal((packaging.permissions ?? workflow.permissions).contents, "read");
  assert.equal((release.permissions ?? workflow.permissions).contents, "write");
});

test("pull requests verify all three desktop platforms without publishing installers", () => {
  assert.ok(workflow.on.pull_request.branches.includes("main"));
  assert.deepEqual([...checks.strategy.matrix.os].sort(), [
    "macos-latest",
    "ubuntu-latest",
    "windows-latest",
  ]);
  const packageCondition = packaging.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
  assert.match(packageCondition, /^github\.event_name\s*!=\s*'pull_request'$/);
  assert.ok([release.needs].flat().includes("package"));
});

test("the release matrix builds both Windows and Linux architectures and universal macOS", () => {
  const targets = packaging.strategy.matrix.include.map(
    ({ builder_platform, builder_arch, target_arch }) => {
      assert.equal(target_arch, builder_arch);
      return [builder_platform, builder_arch].join("-");
    },
  );
  assert.deepEqual(targets.sort(), [
    "linux-arm64",
    "linux-x64",
    "mac-universal",
    "win-arm64",
    "win-x64",
  ]);
});

test("release tag verification accepts only the current prefixed package version", () => {
  const scriptPath = path.resolve(process.cwd(), "scripts/verify-release-tag.ts");
  const run = (releaseTag) =>
    spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: releaseTag },
      encoding: "utf8",
      windowsHide: true,
    });

  assert.equal(run(`v${packageVersion}`).status, 0);
  assert.notEqual(run(packageVersion).status, 0);

  const wrongTag = run("v0.0.0-invalid");
  assert.notEqual(wrongTag.status, 0);
  assert.match(wrongTag.stderr, /does not match package\.json version/);

  const missingTag = run(undefined);
  assert.notEqual(missingTag.status, 0);
  assert.match(missingTag.stderr, /RELEASE_TAG must be a non-empty version tag/);
});
