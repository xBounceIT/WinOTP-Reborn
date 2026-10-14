const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createBrowserQrImport } = require("./browser-qr-import.cjs");
const { dispatchBrowserBridgeRequest, createRateLimiter } = require("./browser-bridge.cjs");

const account = {
  id: "account-1",
  issuer: "Example",
  accountName: "alice",
  secret: "NEVER-RETURN",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};
const request = (requestId = "scan-1", fingerprint = "hash-1") => ({
  ok: true,
  method: "importQr",
  requestId,
  fingerprint,
  text: "otpauth://totp/NEVER-RETURN",
});
function deferred() {
  let resolve;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: any = {}) {
  let unlocked = true;
  let saves = 0;
  let parses = 0;
  let activations = 0;
  const states = [];
  const manager = createBrowserQrImport({
    isUnlocked: () => unlocked,
    parseQr: async () => {
      parses++;
      return { account: { ...account }, identity: `identity-${parses}` };
    },
    saveAccounts: async (accounts) => {
      saves++;
      return {
        results: accounts.map((item) => ({ success: true, account: { ...item, secret: "" } })),
      };
    },
    activate: () => {
      activations++;
    },
    onChanged: (state) => states.push(state),
    ...overrides,
  });
  return {
    manager,
    states,
    counts: () => ({ saves, parses, activations }),
    lock: () => {
      unlocked = false;
      manager.clear();
    },
    unlock: () => {
      unlocked = true;
    },
    isUnlocked: () => unlocked,
  };
}

test("acknowledges a queued review before asynchronous confirmation and exposes no sensitive data", async () => {
  const saving = deferred();
  let saves = 0;
  const h = setup({
    saveAccounts: () => {
      saves++;
      return saving.promise;
    },
  });
  const response = await dispatchBrowserBridgeRequest(
    request(),
    { isUnlocked: h.isUnlocked, importQr: h.manager.enqueue },
    createRateLimiter(),
  );
  assert.deepEqual(response, {
    version: 1,
    requestId: "scan-1",
    ok: true,
    result: { accepted: true },
  });
  assert.equal(saves, 0);
  assert.equal(JSON.stringify([response, h.states]).includes("NEVER-RETURN"), false);
  const id = h.manager.snapshot().review.id;
  let finished = false;
  const confirmation = h.manager.confirm(id).then((result) => {
    finished = true;
    return result;
  });
  await h.manager.confirm(id);
  assert.equal(saves, 1);
  assert.equal(finished, false);
  assert.equal(h.manager.snapshot().review.saving, true);
  saving.resolve({ results: [{ success: true, account: { ...account, secret: "" } }] });
  await confirmation;
  assert.equal(h.manager.snapshot().review, undefined);
  assert.deepEqual(await h.manager.enqueue(request()), { accepted: true });
  assert.deepEqual(await h.manager.enqueue(request("retry-new-id")), { accepted: true });
  assert.equal(h.manager.snapshot().review, undefined);
  assert.equal(h.counts().parses, 1);
});

test("coalesces concurrent payloads and request IDs while queuing distinct reviews", async () => {
  const parsing = deferred();
  let parseCount = 0;
  const h = setup({
    parseQr: () =>
      ++parseCount === 1 ? parsing.promise : { account: { ...account }, identity: "other-account" },
  });
  const first = h.manager.enqueue(request());
  const retry = h.manager.enqueue(request());
  const anotherId = h.manager.enqueue(request("retry"));
  assert.deepEqual(await h.manager.enqueue(request("scan-1", "different")), {
    accepted: false,
    errorCode: "INVALID_REQUEST",
  });
  parsing.resolve({ account: { ...account }, identity: "same-account" });
  assert.deepEqual(await Promise.all([first, retry, anotherId]), [
    { accepted: true },
    { accepted: true },
    { accepted: true },
  ]);
  await h.manager.enqueue(request("distinct", "hash-2"));
  assert.equal(h.manager.snapshot().review.queuedCount, 2);
  assert.equal(h.counts().activations, 2);
  const firstId = h.manager.snapshot().review.id;
  h.manager.cancel(firstId);
  assert.notEqual(h.manager.snapshot().review.id, firstId);
  h.manager.cancel(h.manager.snapshot().review.id);
  assert.equal(h.manager.snapshot().review, undefined);
  assert.equal(h.counts().saves, 0);
  await h.manager.enqueue(request());
  assert.equal(h.manager.snapshot().review, undefined);
});

test("rejects locked requests before parsing or activating and invalidates in-flight parsing across unlock", async () => {
  const h = setup();
  h.lock();
  const response = await dispatchBrowserBridgeRequest(
    request(),
    { isUnlocked: h.isUnlocked, importQr: h.manager.enqueue },
    createRateLimiter(),
  );
  assert.equal(response.error.code, "APP_LOCKED");
  assert.equal("result" in response, false);
  assert.deepEqual(h.counts(), { saves: 0, parses: 0, activations: 0 });
  const parsing = deferred();
  const second = setup({ parseQr: () => parsing.promise });
  const queued = second.manager.enqueue(request());
  second.lock();
  second.unlock();
  parsing.resolve({ account: { ...account }, identity: "same-account" });
  assert.deepEqual(await queued, { accepted: false, errorCode: "APP_LOCKED" });
  assert.equal(second.manager.snapshot().review, undefined);
  assert.equal(second.counts().activations, 0);
});

test("lock during review clears pending accounts and rejects a stale confirmation", async () => {
  const h = setup();
  await h.manager.enqueue(request());
  const id = h.manager.snapshot().review.id;
  h.lock();
  h.unlock();
  await h.manager.confirm(id);
  assert.equal(h.counts().saves, 0);
  assert.equal(h.manager.snapshot().review, undefined);
});

test("rechecks current protection on confirmation even before the lock notification", async () => {
  let unlocked = true;
  const h = setup({ isUnlocked: () => unlocked });
  await h.manager.enqueue(request());
  const id = h.manager.snapshot().review.id;
  unlocked = false;
  await h.manager.confirm(id);
  unlocked = true;
  assert.equal(h.manager.snapshot().review, undefined);
  assert.equal(h.counts().saves, 0);
});

test("save failure stays visible, allows an explicit retry and preserves the account ID", async () => {
  const saved = [];
  const h = setup({
    saveAccounts: async (accounts) => {
      saved.push(accounts[0].id);
      if (saved.length === 1) throw new Error("NEVER-RETURN");
      return { results: [{ success: true, account: { ...account, secret: "" } }] };
    },
  });
  await h.manager.enqueue(request());
  const id = h.manager.snapshot().review.id;
  await h.manager.confirm(id);
  assert.match(h.manager.snapshot().review.error, /Unable to save/);
  assert.equal(JSON.stringify(h.states).includes("NEVER-RETURN"), false);
  await h.manager.confirm(id);
  assert.deepEqual(saved, [account.id, account.id]);
  assert.equal(h.manager.snapshot().review, undefined);
});

test("lock while saving does not resurrect a failed review", async () => {
  const saving = deferred();
  const h = setup({ saveAccounts: () => saving.promise });
  await h.manager.enqueue(request());
  const confirmation = h.manager.confirm(h.manager.snapshot().review.id);
  h.lock();
  saving.resolve({ results: [{ success: false }] });
  await confirmation;
  h.unlock();
  assert.equal(h.manager.snapshot().review, undefined);
});

test("a new scan can be reviewed after cancellation while retries of the cancelled ID stay idempotent", async () => {
  const h = setup();
  await h.manager.enqueue(request());
  const id = h.manager.snapshot().review.id;
  h.manager.cancel(id);
  await h.manager.enqueue(request());
  assert.equal(h.manager.snapshot().review, undefined);
  await h.manager.enqueue(request("explicit-new-scan"));
  assert.notEqual(h.manager.snapshot().review.id, id);
});

test("a transient sidecar failure can be retried without consuming the request ID", async () => {
  let attempts = 0;
  const h = setup({
    parseQr: async () => {
      if (++attempts === 1) throw new Error("temporary failure");
      return { account: { ...account }, identity: "same-account" };
    },
  });
  assert.equal((await h.manager.enqueue(request())).errorCode, "INTERNAL_ERROR");
  assert.deepEqual(await h.manager.enqueue(request()), { accepted: true });
  assert.equal(h.manager.snapshot().review.queuedCount, 1);
});

test("queue saturation refuses new payloads but permits retries without adding reviews", async () => {
  const h = setup();
  for (let index = 0; index < 16; index++) {
    assert.deepEqual(await h.manager.enqueue(request(`scan-${index}`, `hash-${index}`)), {
      accepted: true,
    });
  }
  assert.equal(
    (await h.manager.enqueue(request("overflow", "overflow"))).errorCode,
    "INTERNAL_ERROR",
  );
  assert.deepEqual(await h.manager.enqueue(request("retry", "hash-0")), { accepted: true });
  assert.equal(h.manager.snapshot().review.queuedCount, 16);
});

test("semantic aliases share one review and cancellation permits a new explicit scan", async () => {
  const h = setup({ parseQr: async () => ({ account: { ...account }, identity: "same-account" }) });
  await Promise.all([
    h.manager.enqueue(request("first", "text-a")),
    h.manager.enqueue(request("alias", "text-b")),
  ]);
  assert.equal(h.manager.snapshot().review.queuedCount, 1);
  assert.equal(h.counts().activations, 1);
  h.manager.cancel(h.manager.snapshot().review.id);
  await h.manager.enqueue(request("after-cancel", "text-b"));
  assert.equal(h.manager.snapshot().review.queuedCount, 1);
});

test("unsupported payloads and parse failures yield fixed browser errors without logging", async () => {
  for (const parseQr of [
    async () => undefined,
    async () => {
      throw new Error("NEVER-RETURN");
    },
  ]) {
    const h = setup({ parseQr });
    const response = await dispatchBrowserBridgeRequest(
      request(),
      {
        isUnlocked: h.isUnlocked,
        importQr: h.manager.enqueue,
        onError: () => assert.fail("must not log secrets"),
      },
      createRateLimiter(),
    );
    assert.equal(response.ok, false);
    assert.equal(JSON.stringify(response).includes("NEVER-RETURN"), false);
    assert.equal(h.manager.snapshot().review, undefined);
    assert.equal(h.counts().activations, 0);
  }
});
