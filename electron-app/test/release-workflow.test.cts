const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { load } = require("js-yaml");

const workflow = load(fs.readFileSync("../.github/workflows/release.yml", "utf8"));
const { checks, package: packaging, release } = workflow.jobs;

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
test("both release jobs derive the app version from the release tag", () => {
  const steps = [...checks.steps, ...packaging.steps];
  const applySteps = steps.filter((step) =>
    String(step.run ?? "").includes("scripts/apply-release-tag.ts"),
  );
  assert.equal(applySteps.length, 2);
  assert.ok(
    applySteps.some((step) =>
      String(step.if ?? "").includes("github.event_name != 'pull_request'"),
    ),
  );
  assert.ok(!steps.some((step) => String(step.run ?? "").includes("verify-release-tag")));
});

test("package.json keeps a valid semver fallback version for development builds", () => {
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test("the release tag becomes the app version in package.json and the lockfile", (t) => {
  const scriptPath = path.resolve(process.cwd(), "scripts/apply-release-tag.ts");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "winotp-release-tag-"));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const fixturePath = path.join(fixtureDir, "package.json");
  const lockfilePath = path.join(fixtureDir, "package-lock.json");
  const writeFixture = () => {
    fs.writeFileSync(
      fixturePath,
      `${JSON.stringify({ name: "winotp-electron", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    fs.writeFileSync(
      lockfilePath,
      `${JSON.stringify(
        { name: "winotp-electron", version: "0.0.0", packages: { "": { version: "0.0.0" } } },
        null,
        2,
      )}\n`,
    );
  };
  const run = (releaseTag) => {
    const env = { ...process.env };
    if (releaseTag === undefined) {
      delete env.RELEASE_TAG;
    } else {
      env.RELEASE_TAG = releaseTag;
    }
    return spawnSync(process.execPath, [scriptPath, fixturePath], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      windowsHide: true,
    });
  };

  writeFixture();
  assert.equal(run("v3.1.4").status, 0);
  const applied = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.equal(applied.version, "3.1.4");
  assert.equal(applied.name, "winotp-electron");
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  assert.equal(lockfile.version, "3.1.4");
  assert.equal(lockfile.packages[""].version, "3.1.4");

  writeFixture();
  assert.equal(run("v3.2.0-beta.1").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(fixturePath, "utf8")).version, "3.2.0-beta.1");

  writeFixture();
  assert.equal(run("v3.0.0+build.7").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(fixturePath, "utf8")).version, "3.0.0");

  writeFixture();
  const missingTag = run(undefined);
  assert.notEqual(missingTag.status, 0);
  assert.match(missingTag.stderr, /RELEASE_TAG must be a semantic version tag/);

  const unprefixed = run("3.1.4");
  assert.notEqual(unprefixed.status, 0);
  assert.match(unprefixed.stderr, /prefixed with 'v'/);

  const malformed = run("v1.2");
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /RELEASE_TAG must be a semantic version tag/);

  const leadingZero = run("v01.2.3");
  assert.notEqual(leadingZero.status, 0);
  assert.match(leadingZero.stderr, /RELEASE_TAG must be a semantic version tag/);
  assert.equal(JSON.parse(fs.readFileSync(fixturePath, "utf8")).version, "0.0.0");
});
