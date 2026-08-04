import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMPORT_FILE_SIZE_BYTES,
  MAX_IMPORTED_ACCOUNT_COUNT,
  parseLegacyWinOtpJson,
  parseWinAuthLine,
  parseWinAuthText,
} from "../src/lib/account-import.ts";

test("parses legacy WinOTP JSON with case-insensitive fields", () => {
  const result = parseLegacyWinOtpJson(
    JSON.stringify({
      "legacy-1": {
        ISSUER: "ACME",
        Name: "jdoe@example.com",
        Secret: " JBS WY3DP EHPK3PXP ",
        CREATED: "2026-02-27T09:29:59.318Z",
      },
    }),
  );

  const account = assertAccount(result.accounts[0]);
  assert.equal(result.skippedCount, 0);
  assert.equal(account.issuer, "ACME");
  assert.equal(account.accountName, "jdoe@example.com");
  assert.equal(account.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(account.algorithm, "SHA1");
  assert.equal(account.digits, 6);
  assert.equal(account.period, 30);
  assert.equal(account.createdAt, "2026-02-27T09:29:59.318Z");
});

test("accepts a UTF-8 BOM before legacy WinOTP JSON", () => {
  const result = parseLegacyWinOtpJson(
    `\uFEFF${JSON.stringify({ valid: { secret: "JBSWY3DPEHPK3PXP" } })}`,
  );

  assert.equal(result.accounts.length, 1);
  assert.equal(result.skippedCount, 0);
});

test("skips null and empty-secret legacy WinOTP entries", () => {
  const result = parseLegacyWinOtpJson(
    JSON.stringify({
      "empty-secret": { issuer: "ACME", name: "empty", secret: " " },
      "null-entry": null,
      valid: { issuer: "ACME", name: "valid", secret: "JBSWY3DPEHPK3PXP" },
    }),
  );

  assert.equal(result.accounts.length, 1);
  assert.equal(result.skippedCount, 2);
});

test("rejects malformed legacy WinOTP JSON", () => {
  assert.throws(() => parseLegacyWinOtpJson("not json"), /not a valid WinOTP backup JSON file/);
  assert.throws(() => parseLegacyWinOtpJson("[]"), /not a valid WinOTP backup JSON file/);
});

test("parses WinAuth plus-encoded spaces and preserves OTP settings", () => {
  const account = parseWinAuthLine(
    "otpauth://totp/AWS:admin+user?secret=GEZDGNBVGY3TQOJQ&issuer=AWS&algorithm=SHA512&digits=8&period=60",
  );

  assert.ok(account);
  assert.equal(account.issuer, "AWS");
  assert.equal(account.accountName, "admin user");
  assert.equal(account.secret, "GEZDGNBVGY3TQOJQ");
  assert.equal(account.algorithm, "SHA512");
  assert.equal(account.digits, 8);
  assert.equal(account.period, 60);
});

test("maps WinAuth issuer-only exports to the issuer field", () => {
  const account = parseWinAuthLine(
    "otpauth://totp/%5bDemo%5d+TestService?secret=JBSWY3DPEHPK3PXP&digits=6&icon=WinAuth",
  );

  assert.ok(account);
  assert.equal(account.issuer, "[Demo] TestService");
  assert.equal(account.accountName, "");
});

test("preserves generic WinAuth-compatible otpauth labels", () => {
  const account = parseWinAuthLine("otpauth://totp/user%40example.com?secret=JBSWY3DPEHPK3PXP");

  assert.ok(account);
  assert.equal(account.issuer, "");
  assert.equal(account.accountName, "user@example.com");
});

test("handles null WinAuth lines and text safely", () => {
  assert.equal(parseWinAuthLine(null), undefined);
  assert.equal(parseWinAuthLine(undefined), undefined);
  assert.deepEqual(parseWinAuthText(null), { accounts: [], skippedCount: 0 });
});

test("keeps the import size limit aligned with the backup size limit", () => {
  assert.equal(MAX_IMPORT_FILE_SIZE_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_IMPORTED_ACCOUNT_COUNT, 1_000);
});

test("rejects imports that exceed the account count limit before saving", () => {
  const entries = Object.fromEntries(
    Array.from({ length: MAX_IMPORTED_ACCOUNT_COUNT + 1 }, (_, index) => [
      `account-${index}`,
      { issuer: "Example", name: String(index), secret: "JBSWY3DPEHPK3PXP" },
    ]),
  );

  assert.throws(() => parseLegacyWinOtpJson(JSON.stringify(entries)), /more than 1,000 accounts/);
});

test("counts invalid non-empty WinAuth lines as skipped", () => {
  const result = parseWinAuthText(
    [
      "WinAuth export",
      "",
      "otpauth://totp/Valid?secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/Invalid?digits=6",
    ].join("\r\n"),
  );

  assert.equal(result.accounts.length, 1);
  assert.equal(result.skippedCount, 2);
});

function assertAccount(
  account: ReturnType<typeof parseLegacyWinOtpJson>["accounts"][number] | undefined,
) {
  assert.ok(account);
  return account;
}
