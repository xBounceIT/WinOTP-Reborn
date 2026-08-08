import assert from "node:assert/strict";
import test from "node:test";

import {
  canApplyAccountLoad,
  loadAccountsUntilCurrent,
  mergePersistedAccounts,
} from "../src/lib/account-state.ts";
import type { OtpAccount } from "../src/lib/types.ts";
test("does not apply an account load that started before a mutation", () => {
  assert.equal(canApplyAccountLoad(4, 4), true);
  assert.equal(canApplyAccountLoad(4, 5), false);
});

test("reloads account data after a mutation races the initial load", async () => {
  let version = 0;
  let calls = 0;
  const result = await loadAccountsUntilCurrent(
    async () => {
      calls += 1;
      if (calls === 1) {
        version = 1;
      }
      return calls === 1 ? "stale" : "current";
    },
    () => version,
    () => false,
  );

  assert.equal(result, "current");
  assert.equal(calls, 2);
});

test("does not return account data after cancellation", async () => {
  let cancelled = false;
  const result = await loadAccountsUntilCurrent(
    async () => {
      cancelled = true;
      return "ignored";
    },
    () => 0,
    () => cancelled,
  );

  assert.equal(result, undefined);
});

test("merges imported accounts without losing newer usage counts", () => {
  const current = [createAccount("existing", 3)];
  const persisted = [createAccount("existing", 1), createAccount("new", 0)];

  assert.deepEqual(mergePersistedAccounts(current, persisted), [
    createAccount("existing", 3),
    createAccount("new", 0),
  ]);
});

function createAccount(id: string, usageCount: number): OtpAccount {
  return {
    id,
    issuer: "Example",
    accountName: id,
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "2026-08-04T00:00:00.000Z",
    usageCount,
  };
}
