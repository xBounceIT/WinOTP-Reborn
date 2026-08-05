import type {
  AppSettings,
  SecurityCredentialKind,
  SecurityCredentialStatus,
  SecurityOperationResult,
  SecurityVerification,
} from "./types";

export const emptySecurityStatus: SecurityCredentialStatus = {
  pinSet: false,
  passwordSet: false,
  remotePinSet: false,
  remotePasswordSet: false,
};

export function isSecurityNormalizationReady(
  settingsLoaded: boolean,
  securityReady: boolean,
  securityStorageAvailable: boolean,
  securityMigrationPending = false,
) {
  return settingsLoaded && securityReady && securityStorageAvailable && !securityMigrationPending;
}

export function isPinCredential(kind: SecurityCredentialKind) {
  return kind === "pin" || kind === "remotePin";
}

export function credentialLabel(kind: SecurityCredentialKind) {
  switch (kind) {
    case "pin":
      return "PIN";
    case "password":
      return "password";
    case "remotePin":
      return "Remote Desktop PIN";
    case "remotePassword":
      return "Remote Desktop password";
  }
}

export function securityStatusKey(kind: SecurityCredentialKind): keyof SecurityCredentialStatus {
  switch (kind) {
    case "pin":
      return "pinSet";
    case "password":
      return "passwordSet";
    case "remotePin":
      return "remotePinSet";
    case "remotePassword":
      return "remotePasswordSet";
  }
}

export function settingForCredential(kind: SecurityCredentialKind): keyof AppSettings {
  switch (kind) {
    case "pin":
      return "pinProtection";
    case "password":
      return "passwordProtection";
    case "remotePin":
      return "remotePin";
    case "remotePassword":
      return "remotePassword";
  }
}

export function directCredentialKind(settings: AppSettings): SecurityCredentialKind | undefined {
  if (settings.pinProtection) {
    return "pin";
  }

  if (settings.passwordProtection) {
    return "password";
  }

  return undefined;
}

export function hasConfiguredProtection(settings: AppSettings) {
  return Boolean(settings.pinProtection || settings.passwordProtection || settings.windowsHello);
}

export function shouldReleaseFailedLock(lockApplied: boolean, protectionConfigured: boolean) {
  return lockApplied || !protectionConfigured;
}

export function remoteCredentialKind(settings: AppSettings): SecurityCredentialKind | undefined {
  if (settings.remotePin) {
    return "remotePin";
  }

  if (settings.remotePassword) {
    return "remotePassword";
  }

  return undefined;
}

export function canApplyProtectionReconciliation(
  settingsAtStart: AppSettings,
  statusAtStart: SecurityCredentialStatus,
  currentSettings: AppSettings,
  currentStatus: SecurityCredentialStatus,
) {
  return settingsAtStart === currentSettings && statusAtStart === currentStatus;
}

export function securityVerificationFromResult(
  result: SecurityOperationResult | undefined,
): SecurityVerification {
  if (!result) {
    return {
      verified: false,
      available: false,
      error: "The secure storage bridge is unavailable.",
    };
  }

  if (!result.success) {
    return {
      verified: false,
      available: false,
      error: result.message ?? "Secure storage is unavailable.",
    };
  }

  return {
    verified: result.verified === true,
    available: result.credentialAvailable === true,
  };
}
