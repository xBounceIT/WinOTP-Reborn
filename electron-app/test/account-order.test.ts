import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyCustomOrder,
  isSortOption,
  moveAccountId,
  normalizeCustomOrderIds,
  pruneCustomOrderIds,
  reconcileCustomOrderIds,
  sortAccounts,
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

test("custom order follows saved ids and appends unlisted accounts newest-first", () => {
  const ordered = applyCustomOrder(accounts, ["acct-3", "missing", "acct-3", "acct-1"]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ["acct-3", "acct-1", "acct-2"],
  );
});

test("custom order is selected by the sort policy instead of newest-first", () => {
  const ordered = sortAccounts(accounts, "CustomOrder", ["acct-1", "acct-3"]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ["acct-1", "acct-3", "acct-2"],
  );
});

test("existing sort policies retain their ordering after custom-order extraction", () => {
  assert.deepEqual(
    sortAccounts(accounts, "DateAddedDesc").map((item) => item.id),
    ["acct-2", "acct-3", "acct-1"],
  );
  assert.deepEqual(
    sortAccounts(accounts, "DateAddedAsc").map((item) => item.id),
    ["acct-1", "acct-3", "acct-2"],
  );

  const namedAccounts = [
    { ...accounts[0], issuer: "Beta" },
    { ...accounts[1], issuer: "Alpha" },
    { ...accounts[2], issuer: "Gamma" },
  ];
  assert.deepEqual(
    sortAccounts(namedAccounts, "AlphabeticalAsc").map((item) => item.id),
    ["acct-2", "acct-1", "acct-3"],
  );
  assert.deepEqual(
    sortAccounts(namedAccounts, "AlphabeticalDesc").map((item) => item.id),
    ["acct-3", "acct-1", "acct-2"],
  );

  const usedAccounts = accounts.map((item, index) => ({
    ...item,
    usageCount: [1, 5, 2][index],
  }));
  assert.deepEqual(
    sortAccounts(usedAccounts, "UsageBased").map((item) => item.id),
    ["acct-2", "acct-3", "acct-1"],
  );
});

test("usage-based sorting uses last-used time to break usage-count ties", () => {
  const tiedAccounts = [
    { ...accounts[0], usageCount: 4, lastUsedAt: "2026-08-01T10:00:00.000Z" },
    { ...accounts[1], usageCount: 4, lastUsedAt: "2026-08-03T10:00:00.000Z" },
    { ...accounts[2], usageCount: 4 },
  ];

  assert.deepEqual(
    sortAccounts(tiedAccounts, "UsageBased").map((item) => item.id),
    ["acct-2", "acct-1", "acct-3"],
  );
});

test("moving an account before or after a target returns a persisted id list", () => {
  assert.deepEqual(moveAccountId(["acct-1", "acct-2", "acct-3"], "acct-3", "acct-1"), [
    "acct-3",
    "acct-1",
    "acct-2",
  ]);
  assert.deepEqual(moveAccountId(["acct-1", "acct-2", "acct-3"], "acct-1", "acct-2", true), [
    "acct-2",
    "acct-1",
    "acct-3",
  ]);
});

test("custom order ids are normalized and pruned against current accounts", () => {
  assert.deepEqual(normalizeCustomOrderIds([" acct-2 ", "", "acct-1", "acct-2", 4]), [
    "acct-2",
    "acct-1",
  ]);
  assert.deepEqual(pruneCustomOrderIds(["acct-3", "deleted", "acct-1"], accounts), [
    "acct-3",
    "acct-1",
  ]);
  assert.deepEqual(
    reconcileCustomOrderIds(["acct-1", "acct-2"], [], [{ code: "storage-unavailable" }]),
    ["acct-1", "acct-2"],
  );
  assert.deepEqual(
    reconcileCustomOrderIds(["acct-1", "acct-2"], [accounts[0]], [{ code: "decrypt-failed" }]),
    ["acct-1", "acct-2"],
  );
  assert.deepEqual(reconcileCustomOrderIds(["acct-1", "deleted"], accounts), ["acct-1"]);
  assert.equal(isSortOption("CustomOrder"), true);
  assert.equal(isSortOption("Unknown"), false);
});
