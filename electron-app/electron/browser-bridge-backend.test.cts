const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  BRIDGE_ACCOUNT_ID_PATTERN,
  createBrowserBridgeBackend,
} = require("./browser-bridge-backend.cjs");

function authenticatedRequest(request, token) {
  return {
    version: 1,
    requestId: request.requestId,
    auth: { scheme: "ephemeral-token", token },
    request,
  };
}

test("delegates browser authentication to the Rust backend", async () => {
  const backend = createBrowserBridgeBackend();
  const material = await backend.createAuthenticationMaterial();
  const request = { version: 1, requestId: "request-1", method: "getStatus" };
  assert.deepEqual(
    await backend.authenticateRequest(
      Buffer.from(JSON.stringify(authenticatedRequest(request, material.authToken))),
      material.authToken,
    ),
    { ok: true, requestId: "request-1", method: "getStatus" },
  );
  assert.equal(
    await backend.authenticateRequest(
      Buffer.from(JSON.stringify(authenticatedRequest(request, "b".repeat(43)))),
      material.authToken,
    ),
    undefined,
  );
  assert.deepEqual(
    await backend.authenticateRequest(
      Buffer.from(
        JSON.stringify(authenticatedRequest({ ...request, version: 2 }, material.authToken)),
      ),
      material.authToken,
    ),
    { ok: false, requestId: "request-1", errorCode: "UNSUPPORTED_PROTOCOL" },
  );
  assert.deepEqual(
    await backend.authenticateRequest(
      Buffer.from(
        JSON.stringify(
          authenticatedRequest(
            {
              version: 1,
              requestId: "request-2",
              method: "getTotp",
              params: { accountId: "account-1", secret: "never" },
            },
            material.authToken,
          ),
        ),
      ),
      material.authToken,
    ),
    { ok: false, requestId: "request-2" },
  );
  assert.deepEqual(
    await backend.authenticateRequest(
      Buffer.from(
        JSON.stringify({
          version: 1,
          requestId: "request-3",
          auth: { scheme: "ephemeral-token", token: material.authToken },
          request: "invalid",
        }),
      ),
      material.authToken,
    ),
    { ok: false, requestId: "request-3" },
  );
});

test("maps every backend-valid account id to a stable transport id", async () => {
  const backend = createBrowserBridgeBackend();
  const sourceId = ` migrated account 🔐 ${"x".repeat(200)} `;
  const [first] = await backend.projectAccountIds([sourceId]);
  const [second] = await backend.projectAccountIds([sourceId]);
  assert.match(first, BRIDGE_ACCOUNT_ID_PATTERN);
  assert.equal(second, first);
  assert.equal(await backend.resolveAccountId(first, [sourceId]), sourceId.trim());
  assert.equal(await backend.resolveAccountId(`${first}0`, [sourceId]), undefined);
});
