import assert from "node:assert/strict";
import test from "node:test";

import { areTotpPreviewsAvailable, isTotpPreviewAvailable } from "../src/lib/totp-preview.ts";

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

test("waits until every account has a populated TOTP preview", () => {
  const accounts = [
    { id: "six-digit", digits: 6 },
    { id: "eight-digit", digits: 8 },
  ];

  assert.equal(areTotpPreviewsAvailable(accounts, {}), false);
  assert.equal(
    areTotpPreviewsAvailable(accounts, {
      "six-digit": { code: "——————" },
      "eight-digit": { code: "12345678" },
    }),
    false,
  );
  assert.equal(
    areTotpPreviewsAvailable(accounts, {
      "six-digit": { code: "123456" },
      "eight-digit": { code: "12345678" },
    }),
    true,
  );
});
