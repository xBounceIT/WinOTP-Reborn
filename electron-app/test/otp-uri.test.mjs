import assert from "node:assert/strict";
import test from "node:test";

import { parseOtpUri } from "../src/lib/otp-uri.ts";
function account() {
  return {
    id: "bridge-account",
    issuer: "GitHub",
    accountName: "dan@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA512",
    digits: 8,
    period: 60,
    createdAt: "2026-08-05T00:00:00.000Z",
    usageCount: 0,
  };
}

function installBridge(parse) {
  globalThis.window = {
    winotp: { core: { parseOtpUri: parse } },
  };
}

test("delegates OTP URI parsing to the Rust bridge", async () => {
  let received = "";
  installBridge(async (uri) => {
    received = uri;
    return account();
  });

  assert.deepEqual(await parseOtpUri("otpauth://totp/GitHub:user?secret=..."), account());
  assert.equal(received, "otpauth://totp/GitHub:user?secret=...");
});

test("returns undefined when Rust rejects an unsupported URI", async () => {
  installBridge(async () => undefined);
  assert.equal(await parseOtpUri("otpauth://hotp/Example:user?secret=..."), undefined);
});

test("keeps bridge failures out of the renderer import flow", async () => {
  installBridge(async () => {
    throw new Error("Rust core unavailable");
  });
  assert.equal(await parseOtpUri("not a URI"), undefined);
});
