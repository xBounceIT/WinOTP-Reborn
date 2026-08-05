import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isSortOption,
  normalizeCustomOrderIds,
  projectOrderWithCore,
  pruneCustomOrderIdsWithCore,
  sortAccountsWithCore,
} from "../src/lib/account-order.ts";
import type { OtpAccount } from "../src/lib/types.ts";

function account(id: string, createdAt: string, usageCount = 0): OtpAccount {
  return {
    id,
    issuer: id,
    accountName: "user@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt,
    usageCount,
  };
}

const accounts = [
  account("acct-1", "2026-08-01T10:00:00.000Z"),
  account("acct-2", "2026-08-03T10:00:00.000Z"),
  account("acct-3", "2026-08-02T10:00:00.000Z"),
];

function installBridge() {
  (globalThis as any).window = {
    winotp: {
      core: {
        sortAccounts: async ({ accounts: input }: any) =>
          [...input].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        pruneCustomOrderIds: async () => ["acct-3", "acct-1"],
        orderProject: async () => ["acct-2", "acct-1", "acct-3"],
      },
    },
  };
}

test("uses the Rust result to restore the original account objects", async () => {
  installBridge();
  const ordered = await sortAccountsWithCore(accounts, "DateAddedDesc");
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["acct-2", "acct-3", "acct-1"],
  );
  assert.equal(ordered[0].secret, accounts[1].secret);
});

test("rejects duplicate or incomplete Rust order results", async () => {
  (globalThis as any).window = {
    winotp: {
      core: {
        sortAccounts: async () => [accounts[0], accounts[0], accounts[2]],
      },
    },
  };

  const ordered = await sortAccountsWithCore(accounts, "DateAddedDesc");

  assert.deepEqual(
    ordered.map((item) => item.id),
    accounts.map((item) => item.id),
  );
});

test("delegates persisted order projection and pruning to Rust", async () => {
  installBridge();
  assert.deepEqual(await projectOrderWithCore(["acct-1", "acct-2", "acct-3"], "acct-1", 2), [
    "acct-2",
    "acct-1",
    "acct-3",
  ]);
  assert.deepEqual(await pruneCustomOrderIdsWithCore(["acct-3", "deleted"], accounts), [
    "acct-3",
    "acct-1",
  ]);
});

test("normalizes settings order ids before crossing the bridge", () => {
  assert.deepEqual(normalizeCustomOrderIds([" acct-2 ", "", "acct-1", "acct-2", 4]), [
    "acct-2",
    "acct-1",
  ]);
  assert.equal(isSortOption("CustomOrder"), true);
  assert.equal(isSortOption("Unknown"), false);
});
