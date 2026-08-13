import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPersistedSettingsValue,
  shouldHydrateMainSettings,
  shouldShowWebBridgeNotice,
} from "../src/lib/settings-storage.ts";

test("recognizes only object-shaped persisted settings", () => {
  assert.equal(isPersistedSettingsValue({}), true);
  assert.equal(isPersistedSettingsValue({ theme: "dark" }), true);
  assert.equal(isPersistedSettingsValue(null), false);
  assert.equal(isPersistedSettingsValue([]), false);
  assert.equal(isPersistedSettingsValue("{}"), false);
  assert.equal(isPersistedSettingsValue(42), false);
});

test("shows the WebBridge notice once, after the first completed unlock", () => {
  assert.equal(shouldShowWebBridgeNotice(false, true, true, false, false), true);
  assert.equal(shouldShowWebBridgeNotice(true, true, true, false, false), false);
  assert.equal(shouldShowWebBridgeNotice(false, false, true, false, false), false);
  assert.equal(shouldShowWebBridgeNotice(false, true, false, false, false), false);
  assert.equal(shouldShowWebBridgeNotice(false, true, true, true, false), false);
  assert.equal(shouldShowWebBridgeNotice(false, true, true, false, true), false);
});

test("hydrates main settings unless the user changed settings first", () => {
  assert.equal(shouldHydrateMainSettings(false, false), true);
  assert.equal(shouldHydrateMainSettings(true, false), true);
  assert.equal(shouldHydrateMainSettings(false, true), false);
});
