export function isTotpPreviewAvailable(code: string, digits: number): boolean {
  return code.length === digits && /^\d+$/.test(code);
}

export function areTotpPreviewsAvailable(
  accounts: readonly { id: string; digits: number }[],
  previews: Readonly<Record<string, { code: string } | undefined>>,
) {
  return accounts.every((account) =>
    isTotpPreviewAvailable(previews[account.id]?.code ?? "", account.digits),
  );
}
