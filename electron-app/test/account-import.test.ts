import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountImportFormatError,
  MAX_IMPORT_FILE_SIZE_BYTES,
  MAX_IMPORTED_ACCOUNT_COUNT,
  parseLegacyWinOtpJson,
  parseWinAuthLine,
  parseWinAuthText,
} from "../src/lib/account-import.ts";
import type { OtpAccount } from "../src/lib/types.ts";

function account(id: string): OtpAccount {
  return {
    id,
    issuer: "Example",
    accountName: "user@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "2026-08-05T00:00:00.000Z",
    usageCount: 0,
  };
}

function installBridge(core: any) {
  (globalThis as any).window = { winotp: { core } };
}

test("delegates legacy JSON parsing to Rust and validates the result shape", async () => {
  let received = "";
  installBridge({
    parseLegacyJson: async (content: string) => {
      received = content;
      return { accounts: [account("legacy")], skippedCount: 2 };
    },
  });

  const result = await parseLegacyWinOtpJson('{"legacy":{}}');
  assert.deepEqual(result.accounts, [account("legacy")]);
  assert.equal(result.skippedCount, 2);
  assert.equal(received, '{"legacy":{}}');
});

test("delegates WinAuth line and text parsing to Rust", async () => {
  installBridge({
    parseWinAuthLine: async () => account("line"),
    parseWinAuthText: async () => ({ accounts: [account("text")], skippedCount: 1 }),
  });

  assert.equal((await parseWinAuthLine("otpauth://totp/example"))?.id, "line");
  assert.deepEqual(await parseWinAuthText("export"), {
    accounts: [account("text")],
    skippedCount: 1,
  });
});

test("does not invoke Rust for blank WinAuth lines", async () => {
  let calls = 0;
  installBridge({
    parseWinAuthLine: async () => {
      calls += 1;
      return account("line");
    },
  });

  assert.equal(await parseWinAuthLine("  "), undefined);
  assert.equal(await parseWinAuthLine(null), undefined);
  assert.equal(calls, 0);
});

test("converts malformed bridge responses into an import format error", async () => {
  installBridge({
    parseLegacyJson: async () => ({ accounts: [], skippedCount: -1 }),
  });

  await assert.rejects(
    parseLegacyWinOtpJson("{}"),
    (error) => error instanceof AccountImportFormatError && /invalid data/.test(error.message),
  );
});

test("keeps import size and count limits explicit", () => {
  assert.equal(MAX_IMPORT_FILE_SIZE_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_IMPORTED_ACCOUNT_COUNT, 1_000);
});
