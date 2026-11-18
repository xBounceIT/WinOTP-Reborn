import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isSortOption,
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
        sortAccounts: async () => [{ id: "acct-2" }, { id: "acct-3" }, { id: "acct-1" }],
        pruneCustomOrderIds: async () => ["acct-3", "acct-1"],
        orderProject: async () => ["acct-2", "acct-1", "acct-3"],
      },
    },
  };
}

test("uses the Rust result to restore the original account objects", async () => {
  installBridge();
  const ordered = await sortAccountsWithCore(accounts, "DateAddedDesc");
  assert.deepEqual(ordered, [accounts[1], accounts[2], accounts[0]]);
});

test("rejects duplicate or incomplete Rust order results", async () => {
  for (const malformedOrder of [
    [{ id: "acct-3" }, { id: "acct-3" }, { id: "acct-1" }],
    [{ id: "acct-3" }, { id: "acct-1" }],
  ]) {
    (globalThis as any).window = {
      winotp: { core: { sortAccounts: async () => malformedOrder } },
    };
    assert.deepEqual(await sortAccountsWithCore(accounts, "DateAddedDesc"), accounts);
  }
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

test("passes custom-order ids to Rust without applying a second policy", async () => {
  let receivedOrderIds: readonly string[] | undefined;
  (globalThis as any).window = {
    winotp: {
      core: {
        sortAccounts: async ({ customOrderIds }: any) => {
          receivedOrderIds = customOrderIds;
          return accounts;
        },
      },
    },
  };

  await sortAccountsWithCore(accounts, "CustomOrder", [" acct-2 ", "", "acct-2"]);

  assert.deepEqual(receivedOrderIds, [" acct-2 ", "", "acct-2"]);
  assert.equal(isSortOption("CustomOrder"), true);
  assert.equal(isSortOption("Unknown"), false);
});
