import { readFile } from "node:fs/promises";

const packageJson: unknown = JSON.parse(await readFile("package.json", "utf8"));
const packageVersion =
  packageJson && typeof packageJson === "object" && "version" in packageJson
    ? packageJson.version
    : undefined;
const releaseTag = process.env.RELEASE_TAG;

if (typeof packageVersion !== "string" || !packageVersion) {
  throw new Error("package.json does not contain a valid version.");
}
if (typeof releaseTag !== "string" || !/^v.+/.test(releaseTag)) {
  throw new Error("RELEASE_TAG must be a non-empty version tag prefixed with 'v'.");
}

const tagVersion = releaseTag.slice(1);
if (packageVersion !== tagVersion) {
  throw new Error(`Tag '${releaseTag}' does not match package.json version '${packageVersion}'.`);
}
