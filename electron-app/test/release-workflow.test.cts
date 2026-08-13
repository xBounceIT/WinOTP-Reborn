const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(
  path.resolve(process.cwd(), "../.github/workflows/release.yml"),
  "utf8",
);
const indexHtml = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const packageVersion = packageJson.version;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPngDimensions(relativePath) {
  const contents = fs.readFileSync(path.resolve(process.cwd(), relativePath));
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `${relativePath} is not a PNG`,
  );
  assert.equal(contents.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
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
    msvc_arch: "amd64",
    target_arch: "x64",
    artifact: "electron-app/release/WinOTP-*-win-x64-setup.exe",
  });
  assert.deepEqual(packageEntryBlock("windows-arm64"), {
    platform: "windows-arm64",
    runner: "windows-latest",
    builder_platform: "win",
    builder_arch: "arm64",
    msvc_arch: "amd64_arm64",
    target_arch: "arm64",
    artifact: "electron-app/release/WinOTP-*-win-arm64-setup.exe",
  });
  assert.deepEqual(packageEntryBlock("linux"), {
    platform: "linux",
    runner: "ubuntu-latest",
    builder_platform: "linux",
    builder_arch: "x64",
    target_arch: "x64",
    artifact: "electron-app/release/WinOTP-*-linux-x64-setup.*",
  });
  assert.deepEqual(packageEntryBlock("linux-arm64"), {
    platform: "linux-arm64",
    runner: "ubuntu-latest",
    builder_platform: "linux",
    builder_arch: "arm64",
    target_arch: "arm64",
    artifact: "electron-app/release/WinOTP-*-linux-arm64-setup.*",
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
  assert.doesNotMatch(
    workflow,
    /WINOTP_CHROME_EXTENSION_ID|secrets\.CHROME_EXTENSION_ID|Verify Chrome extension registration/,
  );
  assert.match(
    workflow,
    /^      CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: aarch64-linux-gnu-gcc/m,
  );
  assert.match(
    workflow,
    /- name: Set up MSVC developer environment\r?\n        if: matrix\.builder_platform == 'win'\r?\n        uses: ilammy\/msvc-dev-cmd@v1\r?\n        with:\r?\n          arch: \$\{\{ matrix\.msvc_arch \}\}/,
  );
  assert.match(
    workflow,
    /- name: Install Linux packaging tools\r?\n        if: matrix\.builder_platform == 'linux'[\s\S]*?sudo apt-get install --no-install-recommends -y rpm xz-utils/,
  );
  assert.match(
    workflow,
    /- name: Install Linux ARM64 toolchain\r?\n        if: matrix\.builder_platform == 'linux' && matrix\.builder_arch == 'arm64'[\s\S]*?gcc-aarch64-linux-gnu/,
  );
  assert.match(workflow, /g\+\+-aarch64-linux-gnu/);
  assert.match(workflow, /libc6-dev-arm64-cross/);
  assert.match(
    workflow,
    /run: npm run package -- --\$\{\{ matrix\.builder_platform \}\} --\$\{\{ matrix\.builder_arch \}\}/,
  );
  assert.match(
    workflow,
    /--config\.artifactName='WinOTP-\$\{version\}-\$\{os\}-\$\{env\.WINOTP_TARGET_ARCH\}-setup\.\$\{ext\}'/,
  );
});

test("Linux release jobs build and validate portable and native installers", () => {
  assert.deepEqual(packageJson.build.linux.target, ["AppImage", "deb", "rpm"]);
  assert.equal(packageJson.homepage, "https://github.com/xBounceIT/WinOTP-Reborn");
  assert.equal(
    packageJson.build.linux.maintainer,
    "xBounceIT <xBounceIT@users.noreply.github.com>",
  );
  assert.deepEqual(packageJson.build.linux.publish, {
    provider: "github",
    owner: "xBounceIT",
    repo: "WinOTP-Reborn",
  });
  assert.match(
    workflow,
    /- name: Verify Linux installer artifacts\r?\n        if: matrix\.builder_platform == 'linux'\r?\n        shell: bash/,
  );
  assert.match(workflow, /for extension in AppImage deb rpm; do/);
  assert.match(
    workflow,
    /compgen -G "release\/WinOTP-\*-linux-\$\{WINOTP_TARGET_ARCH\}-setup\.\$\{extension\}"/,
  );
  assert.match(workflow, /if \[\[ "\$\{#installers\[@\]\}" -ne 1 \]\]; then/);
  assert.match(workflow, /if \[\[ ! -s "\$\{installers\[0\]\}" \]\]; then/);
});

test("release packages and runtime use branded cross-platform icons", () => {
  assert.equal(packageJson.build.win.icon, "public/app.ico");
  assert.equal(packageJson.build.linux.icon, "public/app.png");
  assert.equal(packageJson.build.mac.icon, "public/app.png");
  assert.match(indexHtml, /<link rel="icon" href="\.\/app\.png" \/>/);

  for (const iconPath of [
    "public/app.png",
    "public/trayTemplate.png",
    "public/trayTemplate@2x.png",
  ]) {
    assert.equal(
      fs.existsSync(path.resolve(process.cwd(), iconPath)),
      true,
      `${iconPath} is missing`,
    );
  }

  assert.deepEqual(readPngDimensions("public/app.png"), { width: 1024, height: 1024 });
  assert.deepEqual(readPngDimensions("public/trayTemplate.png"), { width: 16, height: 16 });
  assert.deepEqual(readPngDimensions("public/trayTemplate@2x.png"), { width: 32, height: 32 });
});
