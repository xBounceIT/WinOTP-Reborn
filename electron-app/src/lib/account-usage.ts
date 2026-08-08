export function mergeUsageCount(current: number | undefined, next: unknown) {
  if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) {
    return current;
  }

  return Math.max(current ?? 0, next);
}

export function mergeLastUsedAt(current: string | undefined, next: unknown) {
  if (typeof next !== "string" || !next.trim()) {
    return current;
  }

  const nextDate = new Date(next);
  if (Number.isNaN(nextDate.getTime()) || nextDate.getUTCFullYear() < 1970) {
    return current;
  }

  const nextValue = nextDate.toISOString();
  if (typeof current !== "string" || !current.trim()) {
    return nextValue;
  }

  const currentDate = new Date(current);
  if (Number.isNaN(currentDate.getTime()) || currentDate.getUTCFullYear() < 1970) {
    return nextValue;
  }

  return currentDate.getTime() >= nextDate.getTime() ? currentDate.toISOString() : nextValue;
}
