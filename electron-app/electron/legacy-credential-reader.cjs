const { spawnSync } = require("node:child_process");
const path = require("node:path");

const DEFAULT_LEGACY_RESOURCES = ["WinOTP"];

function getWindowsPowerShellPath() {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  return windowsDirectory
    ? path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : undefined;
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createLegacyCredentialScript(resources) {
  const resourceList = resources.map(quotePowerShellString).join(", ");

  return String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$legacyResources = @(${resourceList})
$vaultType = [Windows.Security.Credentials.PasswordVault,Windows,ContentType=WindowsRuntime]
$vault = [Activator]::CreateInstance($vaultType)
$credentials = $vault.RetrieveAll()
$items = New-Object 'System.Collections.Generic.List[object]'

foreach ($credential in $credentials) {
    if ($legacyResources -notcontains $credential.Resource) {
        continue
    }

    $credentialId = if ([string]::IsNullOrWhiteSpace($credential.UserName)) { "(unknown)" } else { $credential.UserName }
    try {
        $credential.RetrievePassword()
        $items.Add([pscustomobject]@{
            resource = $credential.Resource
            id = $credentialId
            payload = $credential.Password
            issue = $null
        })
    }
    catch {
        $items.Add([pscustomobject]@{
            resource = $credential.Resource
            id = $credentialId
            payload = $null
            issue = "retrieve-failed"
        })
    }
}

if ($items.Count -eq 0) {
    Write-Output "[]"
}
else {
    $items | ConvertTo-Json -Compress -Depth 4
}
`;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

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

  const requestedResources = [...new Set(resources.map((resource) => String(resource).trim()))].filter(
    Boolean,
  );
  if (requestedResources.length === 0) {
    return { ok: true, entries: [] };
  }

  const powershellPath = getWindowsPowerShellPath();
  if (!powershellPath) {
    return {
      ok: false,
      error: "Unable to locate Windows PowerShell for the Credential Manager migration.",
    };
  }

  let result;
  try {
    result = spawnSync(
      powershellPath,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        createLegacyCredentialScript(requestedResources),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch {
    return {
      ok: false,
      error: "Unable to start the Windows Credential Manager migration.",
    };
  }

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: "Windows Credential Manager migration failed.",
    };
  }

  const parsed = safeJsonParse(String(result.stdout ?? "").trim() || "[]");
  if (parsed === undefined) {
    return {
      ok: false,
      error: "Windows Credential Manager returned invalid migration data.",
    };
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (!entries.every(isLegacyCredentialEntry)) {
    return {
      ok: false,
      error: "Windows Credential Manager returned invalid migration data.",
    };
  }

  return {
    ok: true,
    entries,
  };
}

module.exports = {
  DEFAULT_LEGACY_RESOURCES,
  getWindowsPowerShellPath,
  isLegacyCredentialEntry,
  readLegacyCredentials,
};
