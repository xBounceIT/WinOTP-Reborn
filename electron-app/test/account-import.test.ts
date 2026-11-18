import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountImportFormatError,
  parseLegacyWinOtpJson,
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

test("preserves the selected file contents and exposes the parsed import summary", async () => {
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

test("converts malformed bridge responses into an import format error", async () => {
  installBridge({
    parseLegacyJson: async () => ({ accounts: [], skippedCount: -1 }),
    parseWinAuthText: async () => ({ accounts: null, skippedCount: 0 }),
  });

  for (const parseImport of [parseLegacyWinOtpJson, parseWinAuthText]) {
    await assert.rejects(
      parseImport("selected file"),
      (error) => error instanceof AccountImportFormatError && /invalid data/.test(error.message),
    );
  }
});
