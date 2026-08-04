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

export function applyCustomOrder(
  accounts: readonly OtpAccount[],
  savedOrderIds: readonly string[] = [],
): OtpAccount[] {
  const accountById = new Map<string, OtpAccount>();
  for (const account of accounts) {
    if (account.id && !accountById.has(account.id)) {
      accountById.set(account.id, account);
    }
  }

  const ordered: OtpAccount[] = [];
  const usedIds = new Set<string>();
  for (const id of normalizeCustomOrderIds(savedOrderIds)) {
    const account = accountById.get(id);
    if (account && !usedIds.has(id)) {
      usedIds.add(id);
      ordered.push(account);
    }
  }

  const unlisted = accounts
    .filter((account) => !usedIds.has(account.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return [...ordered, ...unlisted];
}

export function sortAccounts(
  accounts: readonly OtpAccount[],
  sort: SortOption,
  customOrderIds: readonly string[] = [],
): OtpAccount[] {
  if (sort === "CustomOrder") {
    return applyCustomOrder(accounts, customOrderIds);
  }

  return [...accounts].sort((left, right) => {
    if (sort === "AlphabeticalAsc") {
      return `${left.issuer}${left.accountName}`.localeCompare(
        `${right.issuer}${right.accountName}`,
      );
    }
    if (sort === "AlphabeticalDesc") {
      return `${right.issuer}${right.accountName}`.localeCompare(
        `${left.issuer}${left.accountName}`,
      );
    }
    if (sort === "DateAddedAsc") {
      return left.createdAt.localeCompare(right.createdAt);
    }
    if (sort === "UsageBased") {
      const usageDifference = (right.usageCount ?? 0) - (left.usageCount ?? 0);
      if (usageDifference !== 0) {
        return usageDifference;
      }

      const lastUsedDifference = (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "");
      return lastUsedDifference || right.createdAt.localeCompare(left.createdAt);
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function moveAccountId(
  orderIds: readonly string[],
  draggedId: string,
  targetId: string,
  after = false,
): string[] {
  const next = [...orderIds];
  const draggedIndex = next.indexOf(draggedId);
  if (draggedIndex < 0 || draggedId === targetId) {
    return next;
  }

  next.splice(draggedIndex, 1);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) {
    return [...orderIds];
  }

  next.splice(targetIndex + (after ? 1 : 0), 0, draggedId);
  return next;
}

export function pruneCustomOrderIds(
  savedOrderIds: readonly string[],
  accounts: readonly OtpAccount[],
): string[] {
  const existingIds = new Set(accounts.map((account) => account.id));
  return normalizeCustomOrderIds(savedOrderIds).filter((id) => existingIds.has(id));
}

export function reconcileCustomOrderIds(
  savedOrderIds: readonly string[],
  accounts: readonly OtpAccount[],
  issues: readonly { code: string }[] = [],
): string[] {
  const normalizedOrderIds = normalizeCustomOrderIds(savedOrderIds);
  if (issues.length > 0) {
    return normalizedOrderIds;
  }

  return pruneCustomOrderIds(normalizedOrderIds, accounts);
}
