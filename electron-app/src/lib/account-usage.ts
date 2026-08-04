export function mergeUsageCount(current: number | undefined, next: unknown) {
  if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) {
    return current;
  }

  return Math.max(current ?? 0, next);
}
