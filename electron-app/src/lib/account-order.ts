import type { OtpAccount, SortOption } from "./types";

export const sortOptions: readonly SortOption[] = [
  "DateAddedDesc",
  "DateAddedAsc",
  "AlphabeticalAsc",
  "AlphabeticalDesc",
  "CustomOrder",
  "UsageBased",
];

export function isSortOption(value: unknown): value is SortOption {
  return typeof value === "string" && sortOptions.includes(value as SortOption);
}

export function normalizeCustomOrderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string") {
      continue;
    }

    const normalized = id.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      ids.push(normalized);
    }
  }

  return ids;
}

function bridgeAccounts(accounts: readonly OtpAccount[]) {
  return accounts.map((account) => ({ ...account, secret: "" }));
}

function accountsFromCoreResult(
  accounts: readonly OtpAccount[],
  result: unknown,
): OtpAccount[] | undefined {
  if (!Array.isArray(result)) {
    return undefined;
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  if (accountById.size !== accounts.length) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const ordered = result
    .map((account) => {
      if (!account || typeof account !== "object" || Array.isArray(account)) {
        return undefined;
      }
      const id = (account as { id?: unknown }).id;
      if (typeof id !== "string" || seenIds.has(id)) {
        return undefined;
      }
      seenIds.add(id);
      return accountById.get(id);
    })
    .filter((account): account is OtpAccount => account !== undefined);
  return ordered.length === accounts.length && seenIds.size === accountById.size
    ? ordered
    : undefined;
}

export async function sortAccountsWithCore(
  accounts: readonly OtpAccount[],
  sort: SortOption,
  customOrderIds: readonly string[] = [],
): Promise<OtpAccount[]> {
  const bridge = window.winotp?.core;
  if (!bridge) {
    return [...accounts];
  }

  try {
    const result = await bridge.sortAccounts({
      accounts: bridgeAccounts(accounts),
      sortOption: sort,
      customOrderIds: normalizeCustomOrderIds(customOrderIds),
    });
    return accountsFromCoreResult(accounts, result) ?? [...accounts];
  } catch {
    return [...accounts];
  }
}

export async function pruneCustomOrderIdsWithCore(
  savedOrderIds: readonly string[],
  accounts: readonly OtpAccount[],
): Promise<string[]> {
  const normalizedOrderIds = normalizeCustomOrderIds(savedOrderIds);
  const bridge = window.winotp?.core;
  if (!bridge) {
    return normalizedOrderIds;
  }

  try {
    const result = await bridge.pruneCustomOrderIds({
      accounts: bridgeAccounts(accounts),
      orderIds: normalizedOrderIds,
    });
    return Array.isArray(result) ? normalizeCustomOrderIds(result) : normalizedOrderIds;
  } catch {
    return normalizedOrderIds;
  }
}

export async function projectOrderWithCore(
  orderIds: readonly string[],
  draggedId: string,
  insertionIndex: number,
): Promise<string[]> {
  const current = [...orderIds];
  const bridge = window.winotp?.core;
  if (!bridge) {
    return current;
  }

  try {
    const result = await bridge.orderProject({
      orderIds: current,
      draggedId,
      insertionIndex,
    });
    return Array.isArray(result) ? normalizeCustomOrderIds(result) : current;
  } catch {
    return current;
  }
}
