import assert from "node:assert/strict";
import test from "node:test";

import { parseOtpUri } from "../src/lib/otp-uri.ts";

test("parses a TOTP URI with encoded labels and supported options", () => {
  const account = parseOtpUri(
    "otpauth://totp/GitHub%3Adan%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA512&digits=8&period=60",
  );

  assert.ok(account);
  assert.equal(account.issuer, "GitHub");
  assert.equal(account.accountName, "dan@example.com");
  assert.equal(account.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(account.algorithm, "SHA512");
  assert.equal(account.digits, 8);
  assert.equal(account.period, 60);
});

test("uses safe defaults for malformed optional values", () => {
  const account = parseOtpUri(
    "otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&algorithm=MD5&digits=8e0&period=1e3",
  );

  assert.ok(account);
  assert.equal(account.algorithm, "SHA1");
  assert.equal(account.digits, 6);
  assert.equal(account.period, 30);
});

test("treats plus signs as literal in generic OTP URI query values", () => {
  const account = parseOtpUri(
    "otpauth://totp/My+Service?secret=JBSWY3DPEHPK3PXP&issuer=My+Service",
  );

  assert.ok(account);
  assert.equal(account.accountName, "My+Service");
  assert.equal(account.issuer, "My+Service");
});

test("rejects non-TOTP and malformed secret payloads", () => {
  assert.equal(parseOtpUri("otpauth://hotp/Example:user?secret=JBSWY3DPEHPK3PXP"), undefined);
  assert.equal(parseOtpUri("otpauth://totp/Example:user?secret=not-base32-!"), undefined);
  assert.equal(parseOtpUri("not a URI"), undefined);
});
