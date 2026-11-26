import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Release builds take the app version from the pushed tag (RELEASE_TAG in the
// release workflow) instead of requiring a version-bump PR in package.json.
const releaseTag = process.env.RELEASE_TAG;
// Official semver pattern (semver.org) with a mandatory 'v' prefix.
const semverTag =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
if (typeof releaseTag !== "string" || !semverTag.test(releaseTag)) {
  throw new Error(
    "RELEASE_TAG must be a semantic version tag prefixed with 'v' (for example 'v2.3.0').",
  );
}

const packageJsonPath = path.resolve(process.argv[2] ?? "package.json");
const raw = await readFile(packageJsonPath, "utf8");
const packageJson: unknown = JSON.parse(raw);
if (packageJson === null || typeof packageJson !== "object" || Array.isArray(packageJson)) {
  throw new Error(`${packageJsonPath} does not contain a JSON object.`);
}

// Drop semver build metadata (`+...`): it is ignored in version precedence, the updater already
// truncates it (normalize_version_string), and installer file-version fields are numeric-only.
const version = releaseTag.slice(1).split("+")[0];

// Replace only the top-level "version" line (the shallowest indentation) so
// the rest of the file keeps its exact formatting.
const versionLine = /^([ \t]*)"version"[ \t]*:[ \t]*"[^"]*"/gm;
let bestMatch: RegExpExecArray | null = null;
let match: RegExpExecArray | null;
while ((match = versionLine.exec(raw)) !== null) {
  if (bestMatch === null || match[1].length < bestMatch[1].length) {
    bestMatch = match;
  }
}
if (bestMatch === null) {
  throw new Error(`${packageJsonPath} does not contain a "version" field.`);
}

const updated =
  raw.slice(0, bestMatch.index) +
  `${bestMatch[1]}"version": "${version}"` +
  raw.slice(bestMatch.index + bestMatch[0].length);
await writeFile(packageJsonPath, updated);
console.log(
  `Applied release tag '${releaseTag}' as app version '${version}' in ${packageJsonPath}.`,
);

// Keep the lockfile root version in sync so npm commands stay consistent.
const lockfilePath = path.join(path.dirname(packageJsonPath), "package-lock.json");
try {
  const lockfile: {
    version?: unknown;
    packages?: Record<string, { version?: unknown }>;
  } = JSON.parse(await readFile(lockfilePath, "utf8"));
  lockfile.version = version;
  if (lockfile.packages?.[""]) {
    lockfile.packages[""].version = version;
  }
  await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
  console.log(`Synced ${lockfilePath} to version '${version}'.`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}
