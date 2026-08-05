const automaticBackupFailure = {
  success: false,
  errorCode: "UnexpectedError",
  message: "Unable to create the automatic backup.",
};

async function saveAccountBatch(accounts, options) {
  const results: any[] = [];

  for (const account of accounts) {
    try {
      results.push(await options.saveAccount(account));
    } catch (error) {
      options.onSaveError?.(error);
      results.push({ success: false, message: "Unable to save the account." });
    }
  }

  if (!results.some((result) => result?.success && result.account)) {
    return { results };
  }

  try {
    const automaticBackup = await options.createAutomaticBackup();
    return automaticBackup.skipped ? { results } : { results, automaticBackup };
  } catch (error) {
    options.onBackupError?.(error);
    return { results, automaticBackup: automaticBackupFailure };
  }
}

module.exports = { saveAccountBatch };
