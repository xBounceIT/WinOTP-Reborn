const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(
  path.resolve(process.cwd(), "../.github/workflows/release.yml"),
  "utf8",
);
const packageVersion = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
).version;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function packageEntryBlock(platform) {
  const match = workflow.match(
    new RegExp(
      `^          - platform: ${escapeRegExp(platform)}\\r?\\n((?:            .+\\r?\\n)*)`,
      "m",
    ),
  );
  assert.ok(match, `missing package matrix entry for ${platform}`);

  return Object.fromEntries(
    [`platform: ${platform}`, ...match[1].trimEnd().split(/\r?\n/)].map((line) => {
      const parts = line.trim().match(/^([a-z_]+): (.+)$/);
      assert.ok(parts, `invalid matrix line: ${line}`);
      return [parts[1], parts[2]];
    }),
  );
}

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

test("release tag verification uses the checked TypeScript script", () => {
  assert.match(
    workflow,
    /- name: Verify tag matches package version[\s\S]*?run: node scripts\/verify-release-tag\.ts/,
  );
  assert.doesNotMatch(workflow, /node --input-type|<<['"]?NODE/);
});

test("release tag verification accepts only the current prefixed package version", () => {
  const scriptPath = path.resolve(process.cwd(), "scripts/verify-release-tag.ts");
  const run = (releaseTag) =>
    spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(releaseTag === undefined ? { RELEASE_TAG: undefined } : { RELEASE_TAG: releaseTag }),
      },
      encoding: "utf8",
      windowsHide: true,
    });

  assert.equal(run(`v${packageVersion}`).status, 0);

  const wrongTag = run("v0.0.0-invalid");
  assert.notEqual(wrongTag.status, 0);
  assert.match(wrongTag.stderr, /does not match package\.json version/);

  const missingTag = run(undefined);
  assert.notEqual(missingTag.status, 0);
  assert.match(missingTag.stderr, /RELEASE_TAG must be a non-empty version tag/);
});

test("release packaging verifies Rust and ships both Windows architectures", () => {
  assert.match(
    workflow,
    /- name: Test Rust workspace\r?\n        working-directory: \$\{\{ github\.workspace \}\}\r?\n        run: cargo test --manifest-path rust\/Cargo\.toml --workspace/,
  );
  assert.match(
    workflow,
    /- name: Check Rust formatting\r?\n        working-directory: \$\{\{ github\.workspace \}\}\r?\n        run: cargo fmt --manifest-path rust\/Cargo\.toml --all -- --check/,
  );

  assert.deepEqual(packageEntryBlock("windows"), {
    platform: "windows",
    runner: "windows-latest",
    builder_platform: "win",
    builder_arch: "x64",
    target_arch: "x64",
    artifact: "electron-app/release/WinOTP-*-win-x64-setup.exe",
  });
  assert.deepEqual(packageEntryBlock("windows-arm64"), {
    platform: "windows-arm64",
    runner: "windows-latest",
    builder_platform: "win",
    builder_arch: "arm64",
    target_arch: "arm64",
    artifact: "electron-app/release/WinOTP-*-win-arm64-setup.exe",
  });
  assert.deepEqual(packageEntryBlock("linux"), {
    platform: "linux",
    runner: "ubuntu-latest",
    builder_platform: "linux",
    builder_arch: "x64",
    target_arch: "x64",
    artifact: "electron-app/release/WinOTP-*-linux-x64-setup.AppImage",
  });
  assert.deepEqual(packageEntryBlock("linux-arm64"), {
    platform: "linux-arm64",
    runner: "ubuntu-latest",
    builder_platform: "linux",
    builder_arch: "arm64",
    target_arch: "arm64",
    artifact: "electron-app/release/WinOTP-*-linux-arm64-setup.AppImage",
  });
  assert.deepEqual(packageEntryBlock("macos"), {
    platform: "macos",
    runner: "macos-latest",
    builder_platform: "mac",
    builder_arch: "universal",
    target_arch: "universal",
    artifact: "electron-app/release/WinOTP-*-mac-universal-setup.dmg",
  });

  assert.match(workflow, /^      WINOTP_TARGET_ARCH: \$\{\{ matrix\.target_arch \}\}/m);
  assert.match(
    workflow,
    /^      CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: aarch64-linux-gnu-gcc/m,
  );
  assert.match(
    workflow,
    /- name: Set up MSVC developer environment\r?\n        if: matrix\.builder_platform == 'win'\r?\n        uses: ilammy\/msvc-dev-cmd@v1/,
  );
  assert.match(
    workflow,
    /- name: Install Linux ARM64 toolchain\r?\n        if: matrix\.builder_platform == 'linux' && matrix\.builder_arch == 'arm64'[\s\S]*?gcc-aarch64-linux-gnu/,
  );
  assert.match(
    workflow,
    /run: npm run package -- --\$\{\{ matrix\.builder_platform \}\} --\$\{\{ matrix\.builder_arch \}\}/,
  );
});
