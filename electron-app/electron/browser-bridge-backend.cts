const { runRustCoreAsync } = require("./rust-core.cjs");

const CORE_TIMEOUT_MS = 2_500;
const BRIDGE_ACCOUNT_ID_PATTERN = /^account-[a-f0-9]{64}$/;

function normalizeAccountIds(accountIds) {
  return accountIds.map((accountId) => String(accountId ?? "").trim());
}

function createBrowserBridgeBackend(options: any = {}) {
  const runCore = options.runCore ?? runRustCoreAsync;
  const coreOptions = options.coreOptions ?? {};

  async function invoke(operation, input) {
    return runCore(operation, input, {
      timeoutMs: CORE_TIMEOUT_MS,
      ...coreOptions,
    });
  }

  async function createAuthenticationMaterial() {
    const result = await invoke("browser-bridge-create-authentication", {});
    if (
      typeof result?.authToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(result.authToken) ||
      typeof result?.endpointId !== "string" ||
      !/^[a-f0-9]{32}$/.test(result.endpointId)
    ) {
      throw new Error("The Rust core returned invalid browser bridge authentication material.");
    }
    return result;
  }

  async function authenticateRequest(body, authToken) {
    const result = await invoke("browser-bridge-authenticate", {
      body: Buffer.from(body).toString("base64"),
      authToken,
    });
    if (result === null) {
      return undefined;
    }
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.ok !== "boolean" ||
      typeof result.requestId !== "string"
    ) {
      throw new Error("The Rust core returned an invalid authenticated browser request.");
    }
    return result;
  }

  async function projectAccountIds(accountIds) {
    const sourceIds = normalizeAccountIds(accountIds);
    const result = await invoke("browser-bridge-project-account-ids", {
      accountIds: sourceIds,
    });
    if (
      !Array.isArray(result) ||
      result.length !== sourceIds.length ||
      result.some((accountId) => !BRIDGE_ACCOUNT_ID_PATTERN.test(accountId))
    ) {
      throw new Error("The Rust core returned invalid browser bridge account ids.");
    }
    return result;
  }

  async function resolveAccountId(bridgeAccountId, accountIds) {
    const sourceIds = normalizeAccountIds(accountIds);
    const result = await invoke("browser-bridge-resolve-account-id", {
      bridgeAccountId,
      accountIds: sourceIds,
    });
    if (result === null) {
      return undefined;
    }
    if (typeof result !== "string" || !sourceIds.includes(result)) {
      throw new Error("The Rust core returned an invalid browser bridge account mapping.");
    }
    return result;
  }

  return {
    authenticateRequest,
    createAuthenticationMaterial,
    projectAccountIds,
    resolveAccountId,
  };
}

module.exports = {
  BRIDGE_ACCOUNT_ID_PATTERN,
  createBrowserBridgeBackend,
};
