export function isPersistedSettingsValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function shouldHydrateMainSettings(
  _hasStoredSettings: boolean,
  userChangedSettings: boolean,
) {
  return !userChangedSettings;
}

export function shouldShowWebBridgeNotice(
  locked: boolean,
  settingsLoaded: boolean,
  settingsSourceAvailable: boolean,
  noticeDismissed: boolean,
  noticeShownThisSession: boolean,
) {
  return (
    !locked &&
    settingsLoaded &&
    settingsSourceAvailable &&
    !noticeDismissed &&
    !noticeShownThisSession
  );
}
