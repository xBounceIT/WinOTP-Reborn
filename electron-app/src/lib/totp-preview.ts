export function isTotpPreviewAvailable(code: string, digits: number): boolean {
  return code.length === digits && /^\d+$/.test(code);
}
