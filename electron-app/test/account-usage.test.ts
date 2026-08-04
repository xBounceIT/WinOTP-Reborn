import assert from "node:assert/strict";
import test from "node:test";

import { mergeUsageCount } from "../src/lib/account-usage.ts";

test("keeps the greatest usage count when updates arrive out of order", () => {
  assert.equal(mergeUsageCount(4, 7), 7);
  assert.equal(mergeUsageCount(7, 4), 7);
});

test("ignores invalid usage counts", () => {
  assert.equal(mergeUsageCount(4, -1), 4);
  assert.equal(mergeUsageCount(4, 1.5), 4);
  assert.equal(mergeUsageCount(4, "5"), 4);
  assert.equal(mergeUsageCount(undefined, 3), 3);
});
