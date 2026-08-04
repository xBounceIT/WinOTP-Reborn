import { mergeUsageCount } from "./account-usage.ts";
import type { OtpAccount } from "./types.ts";

export function canApplyAccountLoad(loadVersion: number, currentVersion: number): boolean {
  return loadVersion === currentVersion;
}

export async function loadAccountsUntilCurrent<T>(
  load: () => Promise<T>,
  getCurrentVersion: () => number,
  isCancelled: () => boolean,
): Promise<T | undefined> {
  let loadVersion = getCurrentVersion();
  let result = await load();

  while (!isCancelled() && !canApplyAccountLoad(loadVersion, getCurrentVersion())) {
    loadVersion = getCurrentVersion();
    result = await load();
  }

  return isCancelled() ? undefined : result;
}

export function mergePersistedAccounts(
  currentAccounts: OtpAccount[],
  persistedAccounts: OtpAccount[],
): OtpAccount[] {
  const nextAccounts = [...currentAccounts];
  const accountIndexes = new Map(nextAccounts.map((account, index) => [account.id, index]));

  for (const account of persistedAccounts) {
    const existingIndex = accountIndexes.get(account.id);
    if (existingIndex === undefined) {
      accountIndexes.set(account.id, nextAccounts.length);
      nextAccounts.push(account);
      continue;
    }

    nextAccounts[existingIndex] = {
      ...account,
      usageCount: mergeUsageCount(nextAccounts[existingIndex].usageCount, account.usageCount),
    };
  }

  return nextAccounts;
}
