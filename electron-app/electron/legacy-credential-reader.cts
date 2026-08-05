const { runRustCore } = require("./rust-core.cjs");

const DEFAULT_LEGACY_RESOURCES = ["WinOTP"];

function isLegacyCredentialEntry(entry) {
  const hasPayload = typeof entry?.payload === "string";
  const hasIssue = typeof entry?.issue === "string" && entry.issue.trim().length > 0;
  return (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.resource === "string" &&
    entry.resource.trim().length > 0 &&
    typeof entry.id === "string" &&
    entry.id.trim().length > 0 &&
    (entry.payload === undefined || entry.payload === null || typeof entry.payload === "string") &&
    (entry.issue === undefined || entry.issue === null || typeof entry.issue === "string") &&
    hasPayload !== hasIssue
  );
}

function readLegacyCredentials(resources = DEFAULT_LEGACY_RESOURCES) {
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "Windows Credential Manager migration is only available on Windows.",
    };
  }

  const requestedResources = [
    ...new Set(resources.map((resource) => String(resource).trim())),
  ].filter(Boolean);
  if (requestedResources.length === 0) {
    return { ok: true, entries: [] };
  }

  let entries;
  try {
    entries = runRustCore(
      "read-legacy-credentials",
      { resources: requestedResources },
      { timeoutMs: 15_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    return {
      ok: false,
      error: "Windows Credential Manager migration failed.",
    };
  }

  if (!Array.isArray(entries) || !entries.every(isLegacyCredentialEntry)) {
    return {
      ok: false,
      error: "Windows Credential Manager returned invalid migration data.",
    };
  }

  return { ok: true, entries };
}

module.exports = {
  DEFAULT_LEGACY_RESOURCES,
  isLegacyCredentialEntry,
  readLegacyCredentials,
};
