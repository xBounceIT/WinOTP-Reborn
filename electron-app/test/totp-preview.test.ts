import assert from "node:assert/strict";
import test from "node:test";

import { isTotpPreviewAvailable } from "../src/lib/totp-preview.ts";

test("accepts numeric TOTP previews with the configured length", () => {
  assert.equal(isTotpPreviewAvailable("123456", 6), true);
  assert.equal(isTotpPreviewAvailable("12345678", 8), true);
});

test("rejects placeholders and malformed TOTP previews", () => {
  assert.equal(isTotpPreviewAvailable("——————", 6), false);
  assert.equal(isTotpPreviewAvailable("12345", 6), false);
  assert.equal(isTotpPreviewAvailable("12345a", 6), false);
  assert.equal(isTotpPreviewAvailable("", 6), false);
});
