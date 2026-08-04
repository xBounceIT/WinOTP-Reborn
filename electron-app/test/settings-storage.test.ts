import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPersistedSettingsValue,
  shouldHydrateMainSettings,
} from "../src/lib/settings-storage.ts";

test("recognizes only object-shaped persisted settings", () => {
  assert.equal(isPersistedSettingsValue({}), true);
  assert.equal(isPersistedSettingsValue({ theme: "dark" }), true);
  assert.equal(isPersistedSettingsValue(null), false);
  assert.equal(isPersistedSettingsValue([]), false);
  assert.equal(isPersistedSettingsValue("{}"), false);
  assert.equal(isPersistedSettingsValue(42), false);
});

test("does not replace settings changed before main-process hydration", () => {
  assert.equal(shouldHydrateMainSettings(false, false), true);
  assert.equal(shouldHydrateMainSettings(true, false), false);
  assert.equal(shouldHydrateMainSettings(false, true), false);
});
