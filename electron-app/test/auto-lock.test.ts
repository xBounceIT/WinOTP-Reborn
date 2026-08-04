import assert from "node:assert/strict";
import test from "node:test";

import {
  autoLockTimeoutMs,
  hasConfiguredProtection,
  normalizeAutoLockSetting,
  shouldMonitorAutoLock,
} from "../src/lib/auto-lock.ts";

const baseSettings = {
  autoLock: "5",
  pinProtection: false,
  passwordProtection: false,
  windowsHello: false,
};

test("normalizes persisted auto-lock values", () => {
  assert.equal(normalizeAutoLockSetting("10"), "10");
  assert.equal(normalizeAutoLockSetting("invalid"), "5");
  assert.equal(normalizeAutoLockSetting(10), "5");
});

test("converts an enabled timeout to milliseconds", () => {
  assert.equal(autoLockTimeoutMs("1"), 60_000);
  assert.equal(autoLockTimeoutMs("30"), 1_800_000);
  assert.equal(autoLockTimeoutMs("0"), 0);
  assert.equal(autoLockTimeoutMs("invalid"), 0);
});

test("monitors only when protection and a timeout are active", () => {
  assert.equal(hasConfiguredProtection({ ...baseSettings, pinProtection: true }), true);
  assert.equal(hasConfiguredProtection(baseSettings), false);
  assert.equal(
    shouldMonitorAutoLock({ ...baseSettings, pinProtection: true }, true, true, false),
    true,
  );
  assert.equal(
    shouldMonitorAutoLock(
      { ...baseSettings, pinProtection: true, autoLock: "0" },
      true,
      true,
      false,
    ),
    false,
  );
  assert.equal(
    shouldMonitorAutoLock({ ...baseSettings, pinProtection: true }, true, true, true),
    false,
  );
  assert.equal(
    shouldMonitorAutoLock({ ...baseSettings, pinProtection: true }, false, true, false),
    false,
  );
});
