export function isPersistedSettingsValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function shouldHydrateMainSettings(
  hasStoredSettings: boolean,
  userChangedSettings: boolean,
) {
  return !hasStoredSettings && !userChangedSettings;
}
