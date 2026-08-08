const assert = require("node:assert/strict");
const { test } = require("node:test");

const { saveAccountBatch } = require("./account-batch-save.cjs");

test("saves an import batch and creates one automatic backup", async () => {
  const savedIds: string[] = [];
  let backupCount = 0;
  const accounts = [{ id: "first" }, { id: "second" }, { id: "third" }];

  const result = await saveAccountBatch(accounts, {
    saveAccount: (account) => {
      savedIds.push(account.id);
      return { success: true, account };
    },
    createAutomaticBackup: () => {
      backupCount += 1;
      return { success: true, filePath: "automatic.wotpbackup" };
    },
  });

  assert.deepEqual(savedIds, ["first", "second", "third"]);
  assert.equal(backupCount, 1);
  assert.deepEqual(
    result.results,
    accounts.map((account) => ({ success: true, account })),
  );
  assert.equal(result.automaticBackup.success, true);
});

test("keeps per-account failures and backs up successful imports once", async () => {
  let backupCount = 0;

  const result = await saveAccountBatch([{ id: "first" }, { id: "broken" }], {
    saveAccount: (account) => {
      if (account.id === "broken") {
        throw new Error("simulated save failure");
      }
      return { success: true, account };
    },
    createAutomaticBackup: () => {
      backupCount += 1;
      return { success: true };
    },
  });

  assert.equal(backupCount, 1);
  assert.equal(result.results[0].success, true);
  assert.deepEqual(result.results[1], {
    success: false,
    message: "Unable to save the account.",
  });
});

test("does not create an automatic backup when every save fails", async () => {
  let backupCount = 0;

  const result = await saveAccountBatch([{ id: "broken" }], {
    saveAccount: () => ({ success: false, message: "Invalid account." }),
    createAutomaticBackup: () => {
      backupCount += 1;
      return { success: true };
    },
  });

  assert.equal(backupCount, 0);
  assert.equal(result.automaticBackup, undefined);
});
