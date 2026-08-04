import type { AppSettings } from "./types";

const autoLockSettingValues = new Set(["0", "1", "2", "5", "10", "15", "30"]);

export function normalizeAutoLockSetting(value: unknown, fallback = "5") {
  if (typeof value === "string" && autoLockSettingValues.has(value)) {
    return value;
  }

  return fallback;
}

export function autoLockTimeoutMs(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }

  return minutes * 60 * 1000;
}

export function hasConfiguredProtection(
  settings: Pick<AppSettings, "pinProtection" | "passwordProtection" | "windowsHello">,
) {
  return settings.pinProtection || settings.passwordProtection || settings.windowsHello;
}

export function shouldMonitorAutoLock(
  settings: Pick<AppSettings, "autoLock" | "pinProtection" | "passwordProtection" | "windowsHello">,
  securityReady: boolean,
  securityStorageAvailable: boolean,
  locked: boolean,
) {
  return (
    !locked &&
    securityReady &&
    securityStorageAvailable &&
    autoLockTimeoutMs(settings.autoLock) > 0 &&
    hasConfiguredProtection(settings)
  );
}
