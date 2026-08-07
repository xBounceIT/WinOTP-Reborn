import { LockKeyhole, ScanFace } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NavigationRail } from "@/components/NavigationRail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AddAccountPage } from "@/pages/AddAccountPage";
import { HomePage } from "@/pages/HomePage";
import { ImportPage } from "@/pages/ImportPage";
import { ManualEntryPage } from "@/pages/ManualEntryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import {
  isSortOption,
  pruneCustomOrderIdsWithCore,
  sortAccountsWithCore,
} from "@/lib/account-order";
import { mergeLastUsedAt, mergeUsageCount } from "@/lib/account-usage";
import { isTotpPreviewAvailable } from "@/lib/totp-preview";
import { loadAccountsUntilCurrent, mergePersistedAccounts } from "@/lib/account-state";
import {
  autoLockTimeoutMs,
  normalizeAutoLockSetting,
  shouldMonitorAutoLock,
} from "@/lib/auto-lock";
import { useTotp } from "@/lib/use-totp";
import {
  canApplyProtectionReconciliation,
  directCredentialKind,
  emptySecurityStatus,
  credentialLabel,
  hasConfiguredProtection,
  isPinCredential,
  isSecurityNormalizationReady,
  remoteCredentialKind,
  securityVerificationFromResult,
  settingForCredential,
  securityStatusKey,
  shouldReleaseFailedLock,
} from "@/lib/security-settings";
import { isPersistedSettingsValue, shouldHydrateMainSettings } from "@/lib/settings-storage";
import type {
  AppSettings,
  AutoStartResult,
  AccountImportResult,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  OtpAccount,
  ProtectionCoreInput,
  ProtectionTransitionInput,
  ProtectionTransitionKind,
  ProtectionViewState,
  Route,
  SecurityCredentialKind,
  SecurityCredentialStatus,
  SecurityOperationResult,
  SecurityVerification,
  UpdateOperationResult,
  UpdateState,
  WindowsHelloAvailabilityStatus,
  WindowsHelloVerificationResult,
} from "@/lib/types";
import { defaultSettings } from "@/lib/types";

const settingsStorageKey = "winotp-electron.settings";
type LockRequestReason = "manual" | "startup" | "inactivity" | "session";

function initialUpdateState(settings: AppSettings): UpdateState {
  const enabled = settings.updateOnStartup;
  return {
    currentVersion: "",
    selectedChannel: settings.updateChannel,
    status: enabled ? "idle" : "disabled",
    isUpdateAvailable: false,
    isBusy: false,
    isAutomaticCheckEnabled: enabled,
    statusMessage: enabled ? "Ready to check for updates." : "Automatic checks are off.",
    lastCheckedUtc: undefined,
    availableUpdate: undefined,
    downloadedInstallerPath: undefined,
    isDownloadedAssetDigestVerified: false,
    lastError: undefined,
  };
}

function getTrayAccountLabel(account: OtpAccount) {
  const issuer = account.issuer.trim();
  const accountName = account.accountName.trim();
  if (issuer && accountName) {
    return `${issuer} (${accountName})`;
  }

  return issuer || accountName || "Account";
}

function sanitizeAccountForRenderer(account: OtpAccount): OtpAccount {
  return { ...account, secret: "" };
}

function resolveThemeColor(variable: "--background" | "--foreground") {
  const probe = document.createElement("span");
  probe.style.color = `color-mix(in srgb, var(${variable}) 100%, transparent)`;
  document.body.append(probe);
  const computedColor = getComputedStyle(probe).color;
  probe.remove();

  const srgbMatch = computedColor.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/i,
  );
  if (srgbMatch) {
    return `#${srgbMatch
      .slice(1, 4)
      .map((channel) =>
        Math.round(Number(channel) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }

  return computedColor;
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readAppSettings(): AppSettings {
  const stored = readStorage<unknown>(settingsStorageKey, undefined);
  const savedSettings = isPersistedSettingsValue(stored) ? (stored as Partial<AppSettings>) : {};

  return {
    ...defaultSettings,
    ...savedSettings,
    accountSortOption: isSortOption(savedSettings.accountSortOption)
      ? savedSettings.accountSortOption
      : defaultSettings.accountSortOption,
    accountCustomOrderIds: Array.isArray(savedSettings.accountCustomOrderIds)
      ? savedSettings.accountCustomOrderIds.filter((id): id is string => typeof id === "string")
      : [],
    autoLock: normalizeAutoLockSetting(savedSettings.autoLock, defaultSettings.autoLock),
    minimizeOnClose:
      savedSettings.minimizeOnClose === true && savedSettings.minimizeToTray !== true,
    minimizeToTray: savedSettings.minimizeToTray === true,
    showTotpInTray: savedSettings.showTotpInTray === true,
    automaticBackup: savedSettings.automaticBackup === true,
    customBackupFolderPath:
      typeof savedSettings.customBackupFolderPath === "string"
        ? savedSettings.customBackupFolderPath
        : "",
  };
}

function hasStoredAppSettings() {
  try {
    const stored = window.localStorage.getItem(settingsStorageKey);
    return stored !== null && isPersistedSettingsValue(JSON.parse(stored));
  } catch {
    return false;
  }
}

function credentialStatusForCore(isSet: boolean): "NotSet" | "Set" {
  return isSet ? "Set" : "NotSet";
}

function recoveryCredentialKind(
  status: SecurityCredentialStatus,
): SecurityCredentialKind | undefined {
  if (status.pinSet) {
    return "pin";
  }
  if (status.passwordSet) {
    return "password";
  }
  if (status.remotePinSet) {
    return "remotePin";
  }
  if (status.remotePasswordSet) {
    return "remotePassword";
  }
  return undefined;
}

function helloAvailabilityForCore(
  status: WindowsHelloAvailabilityStatus,
): ProtectionCoreInput["windowsHelloAvailability"] {
  switch (status) {
    case "available":
      return "Available";
    case "remote-session":
      return "RemoteSession";
    case "unavailable":
      return "Unavailable";
    default:
      return "Error";
  }
}

function protectionInputForCore(
  settings: AppSettings,
  status: SecurityCredentialStatus,
  helloAvailability: WindowsHelloAvailabilityStatus,
): ProtectionCoreInput {
  return {
    pinEnabled: settings.pinProtection,
    passwordEnabled: settings.passwordProtection,
    windowsHelloEnabled: settings.windowsHello,
    remotePinEnabled: settings.remotePin,
    remotePasswordEnabled: settings.remotePassword,
    pinStatus: credentialStatusForCore(status.pinSet),
    passwordStatus: credentialStatusForCore(status.passwordSet),
    windowsHelloAvailability: helloAvailabilityForCore(helloAvailability),
    remotePinStatus: credentialStatusForCore(status.remotePinSet),
    remotePasswordStatus: credentialStatusForCore(status.remotePasswordSet),
  };
}

function applyProtectionState(
  settings: AppSettings,
  state: Pick<
    ProtectionViewState,
    | "pinEnabled"
    | "passwordEnabled"
    | "windowsHelloEnabled"
    | "remotePinEnabled"
    | "remotePasswordEnabled"
  >,
): AppSettings {
  return {
    ...settings,
    pinProtection: state.pinEnabled,
    passwordProtection: state.passwordEnabled,
    windowsHello: state.windowsHelloEnabled,
    remotePin: state.remotePinEnabled,
    remotePassword: state.remotePasswordEnabled,
  };
}

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [accounts, setAccounts] = useState<OtpAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [settings, setSettings] = useState<AppSettings>(readAppSettings);
  const [backupStatus, setBackupStatus] = useState<BackupConfigurationResult>();
  const [updateState, setUpdateState] = useState<UpdateState>(() => initialUpdateState(settings));
  const [editingAccount, setEditingAccount] = useState<OtpAccount>();
  const [toast, setToast] = useState("");
  const [locked, setLocked] = useState(true);
  const [remoteFallbackActive, setRemoteFallbackActive] = useState(false);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [lockRequestBusy, setLockRequestBusy] = useState(false);
  const [securityReady, setSecurityReady] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSourceAvailable, setSettingsSourceAvailable] = useState(false);
  const [settingsPersistenceReady, setSettingsPersistenceReady] = useState(false);
  const [securityMigrationPending, setSecurityMigrationPending] = useState(false);
  const [settingsRecoveryRequired, setSettingsRecoveryRequired] = useState(false);
  const [securityStorageAvailable, setSecurityStorageAvailable] = useState(true);
  const [securityStatus, setSecurityStatus] =
    useState<SecurityCredentialStatus>(emptySecurityStatus);
  const accountMutationVersion = useRef(0);
  const routeRef = useRef(route);
  const settingsRef = useRef(settings);
  const lockedRef = useRef(locked);
  const securityReadyRef = useRef(securityReady);
  const securityStorageAvailableRef = useRef(securityStorageAvailable);
  const securityStatusRef = useRef(securityStatus);
  const settingsHydrationTouchedRef = useRef(false);
  const unlockBusyRef = useRef(false);
  const lockBusyRef = useRef(false);
  const lockOverlayRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const settingsSaveQueueRef = useRef(Promise.resolve(true));
  const autoLockTimer = useRef<number | undefined>(undefined);
  const autoLockMonitoring = useRef(false);
  const lastActivityAt = useRef(Date.now());
  const startupLockHandled = useRef(false);
  const customOrderPruneVersion = useRef(0);
  const pendingSessionLock = useRef(false);
  const sessionChangeVersion = useRef(0);
  const protectionReconciliationVersion = useRef(0);
  const requestLockRef = useRef<((reason: LockRequestReason) => Promise<boolean>) | undefined>(
    undefined,
  );
  const backupMutationVersion = useRef(0);
  const autoStartMutationVersion = useRef(0);
  const updateSettingsVersion = useRef(0);
  routeRef.current = route;
  settingsRef.current = settings;
  lockedRef.current = locked;
  securityReadyRef.current = securityReady;
  securityStorageAvailableRef.current = securityStorageAvailable;
  securityStatusRef.current = securityStatus;
  requestLockRef.current = requestLock;
  const { accountTiming, codes } = useTotp(
    accounts,
    settingsLoaded && settingsSourceAvailable && securityReady && !locked,
  );
  const [orderedAccounts, setOrderedAccounts] = useState<OtpAccount[]>(accounts);

  useEffect(() => {
    let cancelled = false;
    void sortAccountsWithCore(
      accounts,
      settings.accountSortOption,
      settings.accountCustomOrderIds,
    ).then((result) => {
      if (!cancelled) {
        setOrderedAccounts(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, settings.accountCustomOrderIds, settings.accountSortOption]);

  async function resolveProtectionViewState(
    settingsValue: AppSettings,
    status: SecurityCredentialStatus,
  ): Promise<ProtectionViewState | undefined> {
    const core = window.winotp?.core;
    if (!core) {
      return undefined;
    }

    try {
      const helloResult = await window.winotp?.security.getWindowsHelloAvailability();
      const availability = helloResult?.success ? helloResult.status : "error";
      return await core.reconcileProtection(
        protectionInputForCore(settingsValue, status, availability),
      );
    } catch {
      return undefined;
    }
  }

  async function disableUnavailableProtectionIfSafe(
    settingsValue: AppSettings,
    status: SecurityCredentialStatus,
  ) {
    if (securityMigrationPending) {
      return false;
    }

    const reconciliationVersion = ++protectionReconciliationVersion.current;
    const state = await resolveProtectionViewState(settingsValue, status);
    if (
      !state ||
      reconciliationVersion !== protectionReconciliationVersion.current ||
      !canApplyProtectionReconciliation(
        settingsValue,
        status,
        settingsRef.current,
        securityStatusRef.current,
      )
    ) {
      return false;
    }

    const nextSettings = applyProtectionState(settingsValue, state);
    if (!(await persistProtectionSettings(nextSettings))) {
      return false;
    }
    return !hasConfiguredProtection(nextSettings);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAccounts() {
      setAccountsLoading(true);
      setAccountsError("");

      const accountsBridge = window.winotp?.accounts;
      if (!accountsBridge) {
        if (!cancelled) {
          setAccountsLoading(false);
          setAccountsError("The Electron storage bridge is unavailable.");
        }
        return;
      }

      try {
        const result = await loadAccountsUntilCurrent(
          () => accountsBridge.list(),
          () => accountMutationVersion.current,
          () => cancelled,
        );
        if (result === undefined) {
          return;
        }

        setAccounts(result.accounts);
        pruneStoredCustomOrderIds(result.accounts, result.issues);
        setAccountsLoading(false);
        const storageIssue = result.issues.find((issue) => issue.code === "storage-unavailable");
        if (storageIssue) {
          setAccountsError(storageIssue.message);
        } else if (result.migration.status === "failed") {
          showToast(
            result.migration.message ??
              "WinOTP could not migrate all existing Windows Credential Manager accounts.",
          );
        } else if (result.migration.justCompleted) {
          const importedCount = result.migration.importedCount;
          const skippedCount = result.migration.skippedCount;
          const importedLabel = `${importedCount} account${importedCount === 1 ? "" : "s"}`;
          const skippedLabel = `${skippedCount} account${skippedCount === 1 ? "" : "s"}`;
          showToast(
            skippedCount > 0
              ? `Imported ${importedLabel}; skipped ${skippedLabel} from Windows Credential Manager`
              : `Imported ${importedLabel} from Windows Credential Manager`,
          );
          void accountsBridge.acknowledgeMigration().catch(() => undefined);
        } else if (result.issues.length > 0) {
          console.error("Some stored WinOTP accounts could not be loaded.", result.issues);
          showToast("Some stored accounts could not be loaded.");
        }
      } catch (error) {
        console.error("Failed to load stored WinOTP accounts.", error);
        if (!cancelled) {
          setAccountsLoading(false);
          setAccountsError("Unable to load accounts from the local SQLite database.");
        }
      }
    }

    void loadAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const activityEvents = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"];

    const handleActivity = () => {
      if (lockedRef.current) {
        return;
      }

      lastActivityAt.current = Date.now();
      if (autoLockMonitoring.current && autoLockTimer.current === undefined) {
        scheduleAutoLockTimer();
      }
    };

    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, handleActivity, true);
    });

    if (locked) {
      stopAutoLockTimer();
    } else {
      lastActivityAt.current = Date.now();
      scheduleAutoLockTimer();
    }

    return () => {
      activityEvents.forEach((eventName) => {
        document.removeEventListener(eventName, handleActivity, true);
      });
      stopAutoLockTimer();
    };
  }, [
    locked,
    securityReady,
    securityStorageAvailable,
    securityStatus.passwordSet,
    securityStatus.pinSet,
    securityStatus.remotePasswordSet,
    securityStatus.remotePinSet,
    settings.autoLock,
    settings.passwordProtection,
    settings.pinProtection,
    settings.windowsHello,
  ]);

  useEffect(() => {
    if (
      !securityReady ||
      !settingsLoaded ||
      !settingsSourceAvailable ||
      settingsRecoveryRequired ||
      startupLockHandled.current
    ) {
      return;
    }

    startupLockHandled.current = true;
    void requestLock("startup");
  }, [securityReady, settingsLoaded, settingsSourceAvailable, settingsRecoveryRequired]);

  useEffect(() => {
    if (!securityReady) {
      return;
    }

    const unsubscribe = window.winotp?.onSessionChanged(() => {
      sessionChangeVersion.current += 1;
      setRemoteFallbackActive(false);
      setUnlockValue("");
      setUnlockError("");
      void requestLockRef.current?.("session");
    });

    return unsubscribe;
  }, [securityReady]);

  useEffect(() => {
    if (!settingsLoaded || !settingsSourceAvailable) {
      return;
    }

    let cancelled = false;
    const statusVersion = autoStartMutationVersion.current;

    async function loadAutoStartStatus() {
      const autoStartBridge = window.winotp?.autoStart;
      if (!autoStartBridge) {
        return;
      }

      try {
        const result = await autoStartBridge.status();
        if (cancelled || statusVersion !== autoStartMutationVersion.current || !result.success) {
          return;
        }

        setSettings((current) => ({ ...current, autoStart: result.enabled }));
      } catch {
        // Keep the saved renderer value as a fallback when the OS bridge is unavailable.
      }
    }

    void loadAutoStartStatus();
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, settingsSourceAvailable]);

  useEffect(() => {
    if (!settingsLoaded || !settingsSourceAvailable) {
      return;
    }

    let cancelled = false;

    async function loadUpdateStatus() {
      const updateBridge = window.winotp?.updates;
      if (!updateBridge) {
        if (!cancelled) {
          setUpdateState((current) => ({
            ...current,
            currentVersion: current.currentVersion || "Unavailable",
            status: "error",
            statusMessage: "The Rust update bridge is unavailable.",
            lastError: "The Rust update bridge is unavailable.",
          }));
        }
        return;
      }

      try {
        const status = await updateBridge.status();
        if (cancelled) {
          return;
        }
        if (!status?.success || !status.state) {
          const message = status?.message ?? "The Rust update bridge is unavailable.";
          setUpdateState((current) => ({
            ...(status?.state ?? current),
            status: "error",
            isBusy: false,
            statusMessage: message,
            lastError: message,
          }));
          return;
        }

        const currentSettings = settingsRef.current;
        const currentSettingsVersion = updateSettingsVersion.current;
        setUpdateState({
          ...status.state,
          selectedChannel: currentSettings.updateChannel,
          isAutomaticCheckEnabled: currentSettings.updateOnStartup,
          status:
            currentSettings.updateOnStartup || status.state.status !== "idle"
              ? status.state.status
              : "disabled",
          statusMessage:
            !currentSettings.updateOnStartup && status.state.lastCheckedUtc == null
              ? "Automatic checks are off."
              : status.state.statusMessage,
        });

        if (!currentSettings.updateOnStartup) {
          return;
        }

        const result = await updateBridge.check(currentSettings.updateChannel, true);
        if (
          !cancelled &&
          updateSettingsVersion.current === currentSettingsVersion &&
          result?.state
        ) {
          setUpdateState(result.state);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to check for updates.";
          setUpdateState((current) => ({
            ...current,
            status: "error",
            statusMessage: "Couldn't check for updates.",
            lastError: message,
          }));
        }
      }
    }

    void loadUpdateStatus();
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, settingsSourceAvailable]);

  useEffect(() => {
    let cancelled = false;

    async function loadSecurityStatus() {
      try {
        const result = await window.winotp?.security.getStatus();
        if (cancelled) {
          return;
        }

        if (!result?.success) {
          setSecurityStorageAvailable(false);
          setSecurityStatus(emptySecurityStatus);
          showToast("Secure storage is unavailable; saved protection remains enabled.");
          return;
        }

        const status: SecurityCredentialStatus = {
          pinSet: result.pinSet,
          passwordSet: result.passwordSet,
          remotePinSet: result.remotePinSet,
          remotePasswordSet: result.remotePasswordSet,
        };
        setSecurityStorageAvailable(true);
        setSecurityStatus(status);
      } catch {
        if (!cancelled) {
          setSecurityStorageAvailable(false);
          setSecurityStatus(emptySecurityStatus);
          showToast("Secure storage is unavailable; saved protection remains enabled.");
        }
      } finally {
        if (!cancelled) {
          setSecurityReady(true);
        }
      }
    }

    void loadSecurityStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hasStoredSettings = hasStoredAppSettings();

    async function loadSettings() {
      const settingsBridge = window.winotp?.settings;
      if (!settingsBridge) {
        if (!cancelled) {
          setSettingsSourceAvailable(false);
          setSettingsRecoveryRequired(false);
          setSettingsLoaded(true);
          setSettingsPersistenceReady(true);
          setSecurityMigrationPending(false);
        }
        return;
      }

      try {
        const result = await settingsBridge.get();
        if (!cancelled) {
          const settingsChanged = settingsHydrationTouchedRef.current;
          setSettingsSourceAvailable(result.success);
          setSettingsRecoveryRequired(result.success && result.settingsRecoveryRequired === true);
          setSecurityMigrationPending(
            result.success ? result.securityMigrationPending === true : true,
          );
          if (result.success && shouldHydrateMainSettings(hasStoredSettings, settingsChanged)) {
            setSettings(result.settings);
          }
          setSettingsPersistenceReady(
            settingsChanged ||
              (result.success &&
                result.persistable !== false &&
                result.settingsRecoveryRequired !== true),
          );
        }
      } catch {
        if (!cancelled) {
          setSettingsSourceAvailable(false);
          setSettingsRecoveryRequired(false);
          setSecurityMigrationPending(true);
          setSettingsPersistenceReady(settingsHydrationTouchedRef.current || hasStoredSettings);
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !settingsSourceAvailable || !settingsPersistenceReady) {
      return;
    }

    try {
      window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    } catch {
      // Keep the main-process copy authoritative when localStorage is unavailable.
    }

    const settingsBridge = window.winotp?.settings;
    if (settingsBridge) {
      void persistSettingsValue(settings);
    }
  }, [settings, settingsLoaded, settingsPersistenceReady, settingsSourceAvailable]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  useEffect(() => {
    if (
      !isSecurityNormalizationReady(
        settingsLoaded,
        securityReady,
        securityStorageAvailable,
        securityMigrationPending,
      )
    ) {
      return;
    }

    let cancelled = false;
    const reconciliationVersion = ++protectionReconciliationVersion.current;
    async function reconcileProtection() {
      const state = await resolveProtectionViewState(settings, securityStatus);
      if (
        !cancelled &&
        reconciliationVersion === protectionReconciliationVersion.current &&
        state &&
        canApplyProtectionReconciliation(
          settings,
          securityStatus,
          settingsRef.current,
          securityStatusRef.current,
        )
      ) {
        setSettings((current) => applyProtectionState(current, state));
      }
    }

    void reconcileProtection();
    return () => {
      cancelled = true;
    };
  }, [
    securityMigrationPending,
    securityReady,
    securityStatus,
    securityStorageAvailable,
    settingsLoaded,
    settings.passwordProtection,
    settings.pinProtection,
    settings.remotePassword,
    settings.remotePin,
    settings.windowsHello,
  ]);

  useEffect(() => {
    window.winotp?.setTitleBarTheme({
      color: resolveThemeColor("--background"),
      symbolColor: resolveThemeColor("--foreground"),
    });
  }, [settings.theme]);

  useEffect(() => {
    let cancelled = false;
    const statusVersion = backupMutationVersion.current;

    async function loadBackupStatus() {
      const backupBridge = window.winotp?.backup;
      if (!backupBridge) {
        return;
      }

      try {
        const result = await backupBridge.status();
        if (cancelled || statusVersion !== backupMutationVersion.current || !result.success) {
          return;
        }

        setBackupStatus(result);
      } catch {
        // Backup actions surface their own bridge errors when requested.
      }
    }

    void loadBackupStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !backupStatus) {
      return;
    }

    setSettings((current) => {
      if (
        current.automaticBackup === backupStatus.automaticEnabled &&
        current.customBackupFolderPath === backupStatus.customFolderPath
      ) {
        return current;
      }

      return {
        ...current,
        automaticBackup: backupStatus.automaticEnabled,
        customBackupFolderPath: backupStatus.customFolderPath,
      };
    });
  }, [backupStatus, settingsLoaded]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!locked) {
      return;
    }

    const overlay = lockOverlayRef.current;
    if (!overlay) {
      return;
    }

    const getFocusableElements = () =>
      Array.from(
        overlay.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])"),
      );

    const focusableElements = getFocusableElements();
    focusableElements[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const currentFocusableElements = getFocusableElements();
      if (currentFocusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = currentFocusableElements[0];
      const last = currentFocusableElements[currentFocusableElements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !overlay.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !overlay.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    overlay.addEventListener("keydown", handleKeyDown);
    return () => overlay.removeEventListener("keydown", handleKeyDown);
  }, [locked]);

  useEffect(() => {
    const unsubscribe = window.winotp?.onTrayUsageRecorded(({ id, usageCount, lastUsedAt }) => {
      updateAccountUsage(id, usageCount, lastUsedAt);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    window.winotp?.setTrayState({
      minimizeOnClose: settings.minimizeOnClose,
      minimizeToTray: settings.minimizeToTray,
      showTotpInTray: settings.showTotpInTray,
      locked,
      accounts:
        settings.showTotpInTray && !locked
          ? orderedAccounts.map((account) => ({
              id: account.id,
              label: getTrayAccountLabel(account),
              code: codes[account.id]?.code ?? "—".repeat(account.digits),
            }))
          : [],
    });
  }, [
    codes,
    locked,
    orderedAccounts,
    settings.minimizeOnClose,
    settings.minimizeToTray,
    settings.showTotpInTray,
  ]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function setAppLocked(nextLocked: boolean) {
    lockedRef.current = nextLocked;
    if (nextLocked) {
      window.winotp?.setTrayState({
        minimizeOnClose: settings.minimizeOnClose,
        minimizeToTray: settings.minimizeToTray,
        showTotpInTray: settings.showTotpInTray,
        locked: true,
        accounts: [],
      });
      setEditingAccount(undefined);
      setUnlockValue("");
      setUnlockError("");
    }
    setLocked(nextLocked);
  }

  function updateAccountUsage(id: string, usageCount: unknown, lastUsedAt: unknown) {
    accountMutationVersion.current += 1;
    setAccounts((current) =>
      current.map((account) =>
        account.id === id
          ? {
              ...account,
              usageCount: mergeUsageCount(account.usageCount, usageCount),
              lastUsedAt: mergeLastUsedAt(account.lastUsedAt, lastUsedAt),
            }
          : account,
      ),
    );
  }

  function pruneStoredCustomOrderIds(
    nextAccounts: OtpAccount[],
    issues: readonly { code: string }[] = [],
  ) {
    const pruneVersion = ++customOrderPruneVersion.current;
    const savedOrderIds = [...settingsRef.current.accountCustomOrderIds];
    if (issues.length > 0) {
      return;
    }

    void pruneCustomOrderIdsWithCore(savedOrderIds, nextAccounts).then((nextOrderIds) => {
      if (pruneVersion !== customOrderPruneVersion.current) {
        return;
      }

      setSettings((current) => {
        if (
          current.accountCustomOrderIds.length !== savedOrderIds.length ||
          current.accountCustomOrderIds.some((id, index) => id !== savedOrderIds[index])
        ) {
          return current;
        }

        if (
          nextOrderIds.length === current.accountCustomOrderIds.length &&
          nextOrderIds.every((id, index) => id === current.accountCustomOrderIds[index])
        ) {
          return current;
        }
        return { ...current, accountCustomOrderIds: nextOrderIds };
      });
    });
  }

  function navigate(nextRoute: Route) {
    setRoute(nextRoute);
    if (nextRoute !== "manual") {
      setEditingAccount(undefined);
    }
  }

  async function editAccount(account: OtpAccount) {
    try {
      const editableAccount = await window.winotp?.accounts.get(account.id);
      if (!editableAccount) {
        showToast("Unable to load the account for editing.");
        return;
      }
      setEditingAccount(editableAccount);
      setRoute("manual");
    } catch {
      showToast("Unable to load the account for editing.");
    }
  }

  async function saveAccount(account: OtpAccount) {
    try {
      const result = await window.winotp?.accounts.save(account);
      if (!result?.success || !result.account) {
        showToast(result?.message ?? "Unable to save the account.");
        return;
      }

      const persistedAccount = sanitizeAccountForRenderer(result.account);
      accountMutationVersion.current += 1;
      const wasEditing = Boolean(editingAccount);
      setAccounts((current) => mergePersistedAccounts(current, [persistedAccount]));
      if (routeRef.current === "add" || routeRef.current === "manual") {
        setEditingAccount(undefined);
        setRoute("home");
      }
      const operationLabel = wasEditing ? "Account updated" : "Account added";
      showToast(
        result.automaticBackup?.success === false
          ? `${operationLabel}; automatic backup failed: ${result.automaticBackup.message ?? "unknown error"}`
          : operationLabel,
      );
    } catch {
      showToast("Unable to save the account.");
    }
  }

  async function importAccounts(accountsToImport: OtpAccount[]): Promise<AccountImportResult> {
    const accountsBridge = window.winotp?.accounts;
    if (!accountsBridge) {
      return {
        importedCount: 0,
        failedCount: accountsToImport.length,
        automaticBackupFailed: false,
      };
    }

    let batchResult;
    try {
      batchResult = await accountsBridge.saveBatch(accountsToImport);
    } catch {
      return {
        importedCount: 0,
        failedCount: accountsToImport.length,
        automaticBackupFailed: false,
      };
    }

    const persistedAccounts = batchResult.results.flatMap((result) =>
      result.success && result.account ? [sanitizeAccountForRenderer(result.account)] : [],
    );
    const importedCount = persistedAccounts.length;
    const failedCount = accountsToImport.length - importedCount;
    const automaticBackupFailed = batchResult.automaticBackup?.success === false;

    if (persistedAccounts.length > 0) {
      accountMutationVersion.current += 1;
      setAccounts((current) => mergePersistedAccounts(current, persistedAccounts));
      if (routeRef.current === "import") {
        setEditingAccount(undefined);
        setRoute("home");
      }
    }

    return { importedCount, failedCount, automaticBackupFailed };
  }

  async function copyCode(account: OtpAccount): Promise<boolean> {
    let code: string;
    try {
      const result = await window.winotp?.totp.code(account.id);
      if (!result?.success) {
        showToast(result?.message ?? "The TOTP code is unavailable");
        return false;
      }
      if (!isTotpPreviewAvailable(result.code, account.digits)) {
        showToast("The TOTP code is unavailable");
        return false;
      }
      code = result.code;
    } catch {
      showToast("The TOTP code is unavailable");
      return false;
    }

    try {
      await navigator.clipboard.writeText(code);
    } catch {
      showToast("Clipboard access is unavailable");
      return false;
    }

    let usageSaved = true;
    try {
      const result = await window.winotp?.accounts.recordUsage(account.id);
      if (result?.success) {
        updateAccountUsage(account.id, result.usageCount, result.lastUsedAt);
      } else {
        usageSaved = false;
      }
    } catch {
      usageSaved = false;
    }

    const label = account.issuer || account.accountName;
    showToast(usageSaved ? `${label} code copied` : `${label} code copied; usage not saved`);
    return true;
  }

  async function deleteAccount(account: OtpAccount) {
    const label = account.issuer || account.accountName;
    if (window.confirm(`Are you sure you want to delete '${label}'?`)) {
      try {
        const result = await window.winotp?.accounts.delete(account.id);
        if (!result?.success) {
          showToast(result?.message ?? "Unable to delete the account.");
          return;
        }

        setAccounts((current) => current.filter((item) => item.id !== account.id));
        markSettingsChanged();
        setSettings((current) => ({
          ...current,
          accountCustomOrderIds: current.accountCustomOrderIds.filter((id) => id !== account.id),
        }));
        accountMutationVersion.current += 1;
        showToast(
          result.automaticBackup?.success === false
            ? `${label} removed; automatic backup failed: ${result.automaticBackup.message ?? "unknown error"}`
            : `${label} removed`,
        );
      } catch {
        showToast("Unable to delete the account.");
      }
    }
  }

  function changeSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    markSettingsChanged();
    if (key === "accountCustomOrderIds") {
      customOrderPruneVersion.current += 1;
    }

    setSettings((current) => {
      const next = { ...current, [key]: value };
      if (key === "minimizeOnClose" && value === true) {
        next.minimizeToTray = false;
      }
      if (key === "minimizeToTray" && value === true) {
        next.minimizeOnClose = false;
      }
      return next;
    });

    if (key === "updateChannel") {
      updateSettingsVersion.current += 1;
      setUpdateState((current) => ({
        ...current,
        selectedChannel: value as AppSettings["updateChannel"],
      }));
    }
    if (key === "updateOnStartup") {
      updateSettingsVersion.current += 1;
      const enabled = value === true;
      setUpdateState((current) => ({
        ...current,
        isAutomaticCheckEnabled: enabled,
        status:
          !enabled && current.lastCheckedUtc == null && !current.availableUpdate
            ? "disabled"
            : current.status,
        statusMessage:
          !enabled && current.lastCheckedUtc == null && !current.availableUpdate
            ? "Automatic checks are off."
            : current.statusMessage,
      }));
    }
  }

  async function recoverSettings(kind?: SecurityCredentialKind | "windowsHello") {
    const settingsBridge = window.winotp?.settings;
    if (!settingsBridge) {
      setUnlockError("The settings recovery bridge is unavailable.");
      return;
    }

    if (unlockBusyRef.current) {
      return;
    }

    unlockBusyRef.current = true;
    setUnlockBusy(true);
    try {
      const recoveryKind = kind ?? recoveryCredentialKind(securityStatus) ?? "windowsHello";
      const authorization =
        recoveryKind === "windowsHello"
          ? { kind: recoveryKind }
          : { kind: recoveryKind, secret: unlockValue };
      const result = await settingsBridge.recover(authorization);
      if (!result?.success) {
        setUnlockError(result?.message ?? "Unable to recover the settings file.");
        return;
      }

      setSettings(result.settings);
      setSettingsSourceAvailable(true);
      setSettingsRecoveryRequired(false);
      setSecurityMigrationPending(result.securityMigrationPending === true);
      setSettingsPersistenceReady(true);
      setUnlockValue("");
      setUnlockError("");
    } catch {
      setUnlockError("Unable to recover the settings file.");
    } finally {
      unlockBusyRef.current = false;
      setUnlockBusy(false);
    }
  }

  function unavailableUpdateResult(message = "The Rust update bridge is unavailable.") {
    const state: UpdateState = {
      ...updateState,
      status: "error",
      isBusy: false,
      statusMessage: message,
      lastError: message,
    };
    setUpdateState(state);
    return { success: false, state, message } satisfies UpdateOperationResult;
  }

  async function checkForUpdates(): Promise<UpdateOperationResult> {
    const updateBridge = window.winotp?.updates;
    if (!updateBridge) {
      return unavailableUpdateResult();
    }

    try {
      const result = await updateBridge.check(settings.updateChannel, settings.updateOnStartup);
      if (result?.state) {
        setUpdateState(result.state);
      }
      return result;
    } catch (error) {
      return unavailableUpdateResult(
        error instanceof Error ? error.message : "Unable to check for updates.",
      );
    }
  }

  async function installUpdate(): Promise<UpdateOperationResult> {
    const updateBridge = window.winotp?.updates;
    if (!updateBridge) {
      return unavailableUpdateResult();
    }

    try {
      const result = await updateBridge.install();
      if (result?.state) {
        setUpdateState(result.state);
      }
      return result;
    } catch (error) {
      return unavailableUpdateResult(
        error instanceof Error ? error.message : "Unable to launch the update installer.",
      );
    }
  }

  function unavailableAutoStartResult(): AutoStartResult {
    return {
      success: false,
      enabled: settingsRef.current.autoStart,
      message: "The Electron auto-start bridge is unavailable.",
    };
  }

  async function changeAutoStart(enabled: boolean): Promise<AutoStartResult> {
    autoStartMutationVersion.current += 1;
    const autoStartBridge = window.winotp?.autoStart;
    if (!autoStartBridge) {
      return unavailableAutoStartResult();
    }

    try {
      const result = await autoStartBridge.set(enabled);
      if (result.success) {
        markSettingsChanged();
        setSettings((current) => ({ ...current, autoStart: result.enabled }));
      }
      return result;
    } catch {
      return unavailableAutoStartResult();
    }
  }

  function markSettingsChanged() {
    settingsHydrationTouchedRef.current = true;
    setSettingsPersistenceReady(true);
  }

  function persistSettingsValue(settingsValue: AppSettings): Promise<boolean> {
    const settingsBridge = window.winotp?.settings;
    if (!settingsBridge) {
      return Promise.resolve(false);
    }

    const saveOperation = settingsSaveQueueRef.current.then(async () => {
      try {
        const result = await settingsBridge.save(settingsValue);
        return result?.success === true;
      } catch {
        return false;
      }
    });
    settingsSaveQueueRef.current = saveOperation.catch(() => false);
    return saveOperation;
  }

  async function persistProtectionSettings(nextSettings: AppSettings) {
    if (!(await persistSettingsValue(nextSettings))) {
      showToast("Protection settings could not be saved; no protection was enabled.");
      return false;
    }

    markSettingsChanged();
    setSettings(nextSettings);
    return true;
  }

  async function transitionProtectionSettings(
    settingsValue: AppSettings,
    kind: ProtectionTransitionKind,
    enabled: boolean,
  ): Promise<AppSettings | undefined> {
    const core = window.winotp?.core;
    if (!core) {
      showToast("The protection policy bridge is unavailable.");
      return undefined;
    }

    const input: ProtectionTransitionInput = {
      pinEnabled: settingsValue.pinProtection,
      passwordEnabled: settingsValue.passwordProtection,
      windowsHelloEnabled: settingsValue.windowsHello,
      remotePinEnabled: settingsValue.remotePin,
      remotePasswordEnabled: settingsValue.remotePassword,
      kind,
      enabled,
    };

    try {
      return applyProtectionState(settingsValue, await core.transitionProtection(input));
    } catch {
      showToast("The protection policy could not be applied.");
      return undefined;
    }
  }

  function unavailableBackupResult(): BackupConfigurationResult {
    return {
      success: false,
      errorCode: "UnexpectedError",
      message: "The Electron backup bridge is unavailable.",
      automaticEnabled: settings.automaticBackup,
      customFolderPath: settings.customBackupFolderPath,
      defaultFolderPath: "",
      effectiveFolderPath: settings.customBackupFolderPath,
      hasStoredPassword: false,
    };
  }

  function unavailableBackupOperation(message = "The Electron backup bridge is unavailable.") {
    return {
      success: false,
      errorCode: "UnexpectedError",
      message,
    } satisfies BackupOperationResult;
  }

  async function changeAutomaticBackup(enabled: boolean, password?: string) {
    backupMutationVersion.current += 1;
    const backupBridge = window.winotp?.backup;
    if (!backupBridge) {
      return unavailableBackupResult();
    }

    try {
      const result = enabled
        ? await backupBridge.enableAutomatic(password ?? "", settings.customBackupFolderPath)
        : await backupBridge.disableAutomatic();
      if (result.success) {
        markSettingsChanged();
        setSettings((current) => ({
          ...current,
          automaticBackup: enabled,
          customBackupFolderPath: result.customFolderPath,
        }));
        setBackupStatus(result);
      }
      return result;
    } catch {
      return unavailableBackupResult();
    }
  }

  async function browseBackupFolder() {
    backupMutationVersion.current += 1;
    const backupBridge = window.winotp?.backup;
    if (!backupBridge) {
      return unavailableBackupResult();
    }

    try {
      const result = await backupBridge.chooseFolder();
      if (result.success) {
        markSettingsChanged();
        setSettings((current) => ({
          ...current,
          customBackupFolderPath: result.customFolderPath,
        }));
        setBackupStatus(result);
      }
      return result;
    } catch {
      return unavailableBackupResult();
    }
  }

  async function resetBackupFolder() {
    backupMutationVersion.current += 1;
    const backupBridge = window.winotp?.backup;
    if (!backupBridge) {
      return unavailableBackupResult();
    }

    try {
      const result = await backupBridge.resetFolder();
      if (result.success) {
        markSettingsChanged();
        setSettings((current) => ({ ...current, customBackupFolderPath: "" }));
        setBackupStatus(result);
      }
      return result;
    } catch {
      return unavailableBackupResult();
    }
  }

  async function importBackup(password: string): Promise<BackupImportResult> {
    const backupBridge = window.winotp?.backup;
    if (!backupBridge) {
      return unavailableBackupOperation() as BackupImportResult;
    }

    try {
      const result = await backupBridge.import(password);
      if (result.success) {
        accountMutationVersion.current += 1;
        const accountsBridge = window.winotp?.accounts;
        try {
          const loadResult = accountsBridge
            ? await loadAccountsUntilCurrent(
                () => accountsBridge.list(),
                () => accountMutationVersion.current,
                () => false,
              )
            : undefined;
          if (loadResult) {
            setAccounts(loadResult.accounts);
            pruneStoredCustomOrderIds(loadResult.accounts, loadResult.issues);
            setAccountsError(
              loadResult.issues.find((issue) => issue.code === "storage-unavailable")?.message ??
                "",
            );
          } else {
            showToast("Backup imported, but the account list could not be refreshed.");
          }
        } catch {
          showToast("Backup imported, but the account list could not be refreshed.");
        }
      }
      return result;
    } catch {
      return unavailableBackupOperation("Unable to import the backup.") as BackupImportResult;
    }
  }

  async function exportBackup(passwordOverride?: string): Promise<BackupOperationResult> {
    const backupBridge = window.winotp?.backup;
    if (!backupBridge) {
      return unavailableBackupOperation();
    }

    try {
      return await backupBridge.export(passwordOverride);
    } catch {
      return unavailableBackupOperation("Unable to export the backup.");
    }
  }

  async function setSecurityCredential(
    kind: SecurityCredentialKind,
    secret: string,
  ): Promise<SecurityOperationResult> {
    try {
      const result = await window.winotp?.security.setCredential(kind, secret);
      if (!result?.success) {
        return {
          success: false,
          message: result?.message ?? "The security credential could not be saved.",
        };
      }

      setSecurityStorageAvailable(true);
      setSecurityStatus((current) => ({ ...current, [securityStatusKey(kind)]: true }));
      return result;
    } catch {
      return {
        success: false,
        message: "The security credential could not be saved.",
      };
    }
  }

  async function verifySecurityCredential(
    kind: SecurityCredentialKind,
    secret: string,
  ): Promise<SecurityVerification> {
    try {
      const result = await window.winotp?.security.verifyCredential(kind, secret);
      const verification = securityVerificationFromResult(result);
      if (!verification.error) {
        setSecurityStorageAvailable(true);
      }
      return verification;
    } catch {
      return securityVerificationFromResult(undefined);
    }
  }

  async function removeSecurityCredential(kind: SecurityCredentialKind) {
    try {
      const result = await window.winotp?.security.removeCredential(kind);
      if (!result?.success) {
        showToast(result?.message ?? "The security credential could not be removed.");
        return false;
      }

      setSecurityStorageAvailable(true);
      setSecurityStatus((current) => ({ ...current, [securityStatusKey(kind)]: false }));
      return true;
    } catch {
      showToast("The security credential could not be removed.");
      return false;
    }
  }

  async function checkWindowsHelloAvailability(): Promise<WindowsHelloAvailabilityStatus> {
    try {
      const result = await window.winotp?.security.getWindowsHelloAvailability();
      return result?.success ? result.status : "error";
    } catch {
      return "error";
    }
  }

  async function requestWindowsHelloVerification(): Promise<WindowsHelloVerificationResult> {
    try {
      const result = await window.winotp?.security.verifyWindowsHello();
      return (
        result ?? {
          success: false,
          message: "The Windows Hello bridge is unavailable.",
        }
      );
    } catch {
      return {
        success: false,
        message: "The Windows Hello bridge is unavailable.",
      };
    }
  }

  function windowsHelloAvailabilityMessage(status: WindowsHelloAvailabilityStatus) {
    switch (status) {
      case "unavailable":
        return "Windows Hello is not available or is not configured on this device.";
      case "remote-session":
        return "Windows Hello is unavailable over Remote Desktop. Configure a fallback credential first.";
      default:
        return "Windows Hello is temporarily unavailable.";
    }
  }

  function windowsHelloVerificationMessage(status: string) {
    switch (status) {
      case "canceled":
        return "Windows Hello verification was canceled.";
      case "failed":
        return "Windows Hello verification failed. Please try again.";
      case "remote-session":
        return "Windows Hello is unavailable over Remote Desktop.";
      case "unavailable":
        return "Windows Hello is no longer available on this device.";
      default:
        return "Windows Hello is temporarily unavailable.";
    }
  }

  async function removeConfiguredCredential(kind: SecurityCredentialKind, updateSetting = false) {
    if (!securityStatus[securityStatusKey(kind)]) {
      return true;
    }

    const removed = await removeSecurityCredential(kind);
    if (removed && updateSetting) {
      changeSetting(settingForCredential(kind), false);
    }
    return removed;
  }

  async function clearWindowsHelloFallbackCredentials(updateSetting = false) {
    let removed = true;
    for (const kind of ["remotePin", "remotePassword"] as const) {
      if (!(await removeConfiguredCredential(kind, updateSetting))) {
        removed = false;
      }
    }
    return removed;
  }

  async function enableWindowsHelloProtection() {
    const availability = await checkWindowsHelloAvailability();
    if (availability !== "available") {
      showToast(windowsHelloAvailabilityMessage(availability));
      return false;
    }

    const verification = await requestWindowsHelloVerification();
    if (!verification.success || verification.status !== "verified") {
      showToast(
        verification.success
          ? windowsHelloVerificationMessage(verification.status)
          : (verification.message ?? "The Windows Hello bridge is unavailable."),
      );
      return false;
    }

    return true;
  }

  async function disableWindowsHelloProtection() {
    const verification = await requestWindowsHelloVerification();
    if (!verification.success) {
      showToast(verification.message ?? "The Windows Hello bridge is unavailable.");
      return false;
    }

    if (verification.status === "unavailable" || verification.status === "remote-session") {
      showToast(
        verification.status === "remote-session"
          ? "Windows Hello is unavailable over Remote Desktop; the protection will be disabled."
          : "Windows Hello is no longer available; the protection will be disabled.",
      );
      return true;
    } else if (verification.status !== "verified") {
      showToast(windowsHelloVerificationMessage(verification.status));
      return false;
    }

    return true;
  }

  async function clearWindowsHelloFallbacks() {
    const removed = await clearWindowsHelloFallbackCredentials();
    if (!removed) {
      showToast("A Remote Desktop fallback credential could not be cleared.");
    }
    return removed;
  }

  async function disableUnavailableWindowsHello() {
    if (securityMigrationPending) {
      setUnlockError("Security credential migration is incomplete; the app remains locked.");
      return;
    }

    const nextSettings = {
      ...settingsRef.current,
      windowsHello: false,
      remotePin: false,
      remotePassword: false,
    };
    if (!(await persistProtectionSettings(nextSettings))) {
      setUnlockError("Protection settings could not be saved; the app remains locked.");
      return;
    }

    setAppLocked(false);
    setRemoteFallbackActive(false);
    setUnlockValue("");
    setUnlockError("");
    await clearWindowsHelloFallbacks();

    showToast("Windows Hello was unavailable and has been disabled.");
  }

  function stopAutoLockTimer() {
    autoLockMonitoring.current = false;
    if (autoLockTimer.current !== undefined) {
      window.clearTimeout(autoLockTimer.current);
      autoLockTimer.current = undefined;
    }
  }

  function scheduleAutoLockTimer() {
    stopAutoLockTimer();

    const currentSettings = settingsRef.current;
    const timeout = autoLockTimeoutMs(currentSettings.autoLock);
    if (
      !shouldMonitorAutoLock(
        currentSettings,
        securityReadyRef.current,
        securityStorageAvailableRef.current,
        lockedRef.current,
      )
    ) {
      return;
    }

    autoLockMonitoring.current = true;
    const elapsed = Date.now() - lastActivityAt.current;
    const remaining = timeout - elapsed;
    const delay = Math.max(100, Math.min(remaining, 10_000));
    autoLockTimer.current = window.setTimeout(() => {
      autoLockTimer.current = undefined;

      if (Date.now() - lastActivityAt.current >= timeout) {
        void requestLock("inactivity").finally(() => {
          if (!lockedRef.current) {
            scheduleAutoLockTimer();
          }
        });
        return;
      }

      scheduleAutoLockTimer();
    }, delay);
  }

  function showManualLockError(message: string, reason: LockRequestReason) {
    if (reason === "manual") {
      showToast(message);
    }
  }

  async function requestLock(reason: LockRequestReason) {
    if (lockedRef.current && reason !== "startup" && reason !== "session") {
      return true;
    }

    if (lockBusyRef.current) {
      if (reason === "session") {
        pendingSessionLock.current = true;
      }
      return false;
    }

    lockBusyRef.current = true;
    setLockRequestBusy(true);
    const settingsAtStart = settingsRef.current;
    const securityStatusAtStart = securityStatusRef.current;
    const kind = directCredentialKind(settingsAtStart);
    const protectionConfigured = hasConfiguredProtection(settingsAtStart);
    let lockApplied = false;
    const applyLock = () => {
      lockApplied = !lockedRef.current;
      setAppLocked(true);
      setUnlockValue("");
      setUnlockError("");
    };
    const releaseFailedLock = () => {
      if (shouldReleaseFailedLock(lockApplied, protectionConfigured)) {
        setAppLocked(false);
      }
    };
    try {
      if (securityMigrationPending) {
        showManualLockError(
          "Security credential migration is incomplete; the app remains locked.",
          reason,
        );
        setAppLocked(true);
        return false;
      }

      if (!kind && !settingsAtStart.windowsHello) {
        releaseFailedLock();
        return false;
      }

      if (kind && !securityReadyRef.current) {
        showManualLockError("Secure storage is still loading. Try again shortly.", reason);
        releaseFailedLock();
        return false;
      }

      if (kind && !securityStorageAvailableRef.current) {
        showManualLockError(
          "Secure storage is unavailable; saved protection remains enabled.",
          reason,
        );
        releaseFailedLock();
        return false;
      }

      if (kind && !securityStatusAtStart[securityStatusKey(kind)]) {
        const disabled = await disableUnavailableProtectionIfSafe(
          settingsAtStart,
          securityStatusAtStart,
        );
        showManualLockError(
          disabled
            ? `Your ${kind === "pin" ? "PIN" : "password"} protection was disabled because no credential is saved.`
            : `Your ${kind === "pin" ? "PIN" : "password"} protection could not be reconciled; the app remains locked.`,
          reason,
        );
        if (disabled) {
          setAppLocked(false);
        }
        return false;
      }

      if (settingsRef.current !== settingsAtStart) {
        showManualLockError("Security settings changed; try locking again.", reason);
        releaseFailedLock();
        return false;
      }

      if (settingsAtStart.windowsHello) {
        applyLock();
        const availability = await checkWindowsHelloAvailability();
        if (
          settingsRef.current !== settingsAtStart ||
          securityStatusRef.current !== securityStatusAtStart
        ) {
          showManualLockError("Security settings changed; try locking again.", reason);
          return false;
        }

        if (availability === "remote-session") {
          const remoteKind = remoteCredentialKind(settingsAtStart);
          if (remoteKind && securityStatusAtStart[securityStatusKey(remoteKind)]) {
            setRemoteFallbackActive(true);
          } else {
            showManualLockError(windowsHelloAvailabilityMessage(availability), reason);
            return false;
          }
        } else if (availability === "unavailable") {
          await disableUnavailableWindowsHello();
          return false;
        } else if (availability === "error") {
          showManualLockError(windowsHelloAvailabilityMessage(availability), reason);
          return false;
        } else {
          setRemoteFallbackActive(false);
        }
      } else {
        applyLock();
      }

      return true;
    } finally {
      lockBusyRef.current = false;
      setLockRequestBusy(false);
      const shouldRetrySessionLock = pendingSessionLock.current;
      pendingSessionLock.current = false;
      if (shouldRetrySessionLock) {
        queueMicrotask(() => void requestLock("session"));
      }
    }
  }

  async function lockPreview() {
    await requestLock("manual");
  }

  async function unlock() {
    if (lockBusyRef.current) {
      return;
    }

    const kind = remoteFallbackActive
      ? remoteCredentialKind(settings)
      : directCredentialKind(settings);
    if (!kind) {
      setUnlockError("Use Windows Hello to unlock this app.");
      return;
    }

    if (!securityReady) {
      setUnlockError("Secure storage is still loading. Try again shortly.");
      return;
    }

    if (!securityStorageAvailable) {
      setUnlockError("Secure storage is unavailable; the app remains locked.");
      return;
    }

    if (!securityStatus[securityStatusKey(kind)]) {
      const disabled = await disableUnavailableProtectionIfSafe(
        settingsRef.current,
        securityStatusRef.current,
      );
      setUnlockValue("");
      if (disabled) {
        setAppLocked(false);
        setUnlockError("");
        showToast("This protection has no saved credential and was disabled.");
      } else {
        setUnlockError("This protection could not be reconciled; the app remains locked.");
      }
      return;
    }

    if (!unlockValue.trim()) {
      setUnlockError(`Enter your ${credentialLabel(kind)} to unlock.`);
      return;
    }

    if (unlockBusyRef.current) {
      return;
    }

    unlockBusyRef.current = true;
    setUnlockBusy(true);
    const sessionChangeVersionAtStart = sessionChangeVersion.current;
    try {
      const verification = await verifySecurityCredential(kind, unlockValue);
      if (sessionChangeVersion.current !== sessionChangeVersionAtStart) {
        setUnlockValue("");
        setUnlockError("The app was locked because your session changed.");
        return;
      }

      if (verification.error) {
        setUnlockError(verification.error);
        return;
      }

      if (!verification.available) {
        const unavailableStatus = {
          ...securityStatusRef.current,
          [securityStatusKey(kind)]: false,
        };
        securityStatusRef.current = unavailableStatus;
        setSecurityStatus(unavailableStatus);
        const disabled = await disableUnavailableProtectionIfSafe(
          settingsRef.current,
          unavailableStatus,
        );
        setUnlockValue("");
        if (disabled) {
          setAppLocked(false);
          setUnlockError("");
          showToast("This protection could not be verified and was disabled.");
        } else {
          setUnlockError("This protection could not be reconciled; the app remains locked.");
        }
        return;
      }

      if (!verification.verified) {
        setUnlockError(`Incorrect ${credentialLabel(kind)}. Try again.`);
        setUnlockValue("");
        return;
      }

      setAppLocked(false);
      setRemoteFallbackActive(false);
      setUnlockValue("");
      setUnlockError("");
      showToast("WinOTP unlocked");
    } finally {
      unlockBusyRef.current = false;
      setUnlockBusy(false);
    }
  }

  async function unlockWithHello() {
    if (unlockBusyRef.current || lockBusyRef.current) {
      return;
    }

    unlockBusyRef.current = true;
    setUnlockBusy(true);
    setUnlockError("");
    const sessionChangeVersionAtStart = sessionChangeVersion.current;
    try {
      const verification = await requestWindowsHelloVerification();
      if (sessionChangeVersion.current !== sessionChangeVersionAtStart) {
        setUnlockValue("");
        setUnlockError("The app was locked because your session changed.");
        return;
      }

      if (!verification.success) {
        setUnlockError(verification.message ?? "The Windows Hello bridge is unavailable.");
        return;
      }

      if (verification.status === "verified") {
        setAppLocked(false);
        setRemoteFallbackActive(false);
        setUnlockValue("");
        setUnlockError("");
        showToast("WinOTP unlocked");
        return;
      }

      if (verification.status === "remote-session") {
        const remoteKind = remoteCredentialKind(settings);
        if (remoteKind && !securityStorageAvailable) {
          setUnlockError("Secure storage is unavailable; the fallback cannot be verified.");
          return;
        }

        if (remoteKind && securityStatus[securityStatusKey(remoteKind)]) {
          setRemoteFallbackActive(true);
          setUnlockValue("");
          setUnlockError(
            `Windows Hello is unavailable over Remote Desktop. Enter your ${
              remoteKind === "remotePin" ? "Remote Desktop PIN" : "Remote Desktop password"
            } to unlock.`,
          );
          return;
        }

        await disableUnavailableWindowsHello();
        return;
      }

      if (verification.status === "unavailable") {
        await disableUnavailableWindowsHello();
        return;
      }

      if (verification.status === "error") {
        setUnlockError(windowsHelloVerificationMessage(verification.status));
        return;
      }

      setUnlockError(windowsHelloVerificationMessage(verification.status));
    } finally {
      unlockBusyRef.current = false;
      setUnlockBusy(false);
    }
  }

  function renderPage() {
    if (route === "home") {
      return (
        <HomePage
          accounts={accounts}
          sort={settings.accountSortOption}
          customOrderIds={settings.accountCustomOrderIds}
          loading={accountsLoading}
          storageError={accountsError}
          showNextCode={settings.showNextCode}
          accountTiming={accountTiming}
          codes={codes}
          onNavigate={navigate}
          onSortChange={(value) => changeSetting("accountSortOption", value)}
          onCustomOrderChange={(value) => changeSetting("accountCustomOrderIds", value)}
          onCopy={copyCode}
          onEdit={editAccount}
          onDelete={deleteAccount}
        />
      );
    }
    if (route === "add") {
      return (
        <AddAccountPage onNavigate={navigate} onToast={showToast} onAccountDetected={saveAccount} />
      );
    }
    if (route === "import") {
      return <ImportPage onToast={showToast} onImport={importAccounts} />;
    }
    if (route === "manual") {
      return (
        <ManualEntryPage account={editingAccount} onNavigate={navigate} onSave={saveAccount} />
      );
    }
    return (
      <SettingsPage
        settings={settings}
        onChange={changeSetting}
        onAutoStartChange={changeAutoStart}
        onToast={showToast}
        onLock={lockPreview}
        backupFolderPath={
          backupStatus?.effectiveFolderPath ||
          settings.customBackupFolderPath ||
          "Default WinOTP backup folder"
        }
        hasStoredBackupPassword={backupStatus?.hasStoredPassword ?? false}
        onAutomaticBackupChange={changeAutomaticBackup}
        onBrowseBackupFolder={browseBackupFolder}
        onResetBackupFolder={resetBackupFolder}
        onImportBackup={importBackup}
        onExportBackup={exportBackup}
        updateState={updateState}
        onCheckForUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
        securityReady={securityReady}
        onEnableWindowsHello={enableWindowsHelloProtection}
        onDisableWindowsHello={disableWindowsHelloProtection}
        onClearWindowsHelloFallbacks={clearWindowsHelloFallbacks}
        onTransitionProtection={transitionProtectionSettings}
        onPersistProtectionSettings={persistProtectionSettings}
        onSetCredential={setSecurityCredential}
        onVerifyCredential={verifySecurityCredential}
        onRemoveCredential={removeSecurityCredential}
      />
    );
  }

  const activeCredential = remoteFallbackActive
    ? remoteCredentialKind(settings)
    : directCredentialKind(settings);
  const recoveryKind = recoveryCredentialKind(securityStatus);
  const protectionReady = settingsLoaded && settingsSourceAvailable && securityReady;

  return (
    <TooltipProvider>
      <div className="app-shell">
        <div className="window-titlebar" aria-label="WinOTP" aria-hidden={locked} inert={locked}>
          <img className="window-titlebar__icon" src="./app.ico" alt="" aria-hidden="true" />
          <span className="window-titlebar__title">WinOTP</span>
        </div>

        {!locked && (
          <div className="app-body">
            <NavigationRail route={route} onNavigate={navigate} />
            <main className="content-frame">{renderPage()}</main>
          </div>
        )}

        {locked && (
          <div
            ref={lockOverlayRef}
            className="lock-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lock-title"
          >
            <div className="lock-overlay__panel">
              <LockKeyhole className="lock-overlay__icon" size={54} strokeWidth={1.35} />
              <h1 id="lock-title" className="lock-overlay__title">
                {settingsRecoveryRequired
                  ? "Settings recovery required"
                  : protectionReady
                    ? "WinOTP is locked"
                    : "Preparing secure storage…"}
              </h1>
              {settingsRecoveryRequired ? (
                <>
                  <p className="lock-overlay__detail">
                    The settings file could not be read. Verify your saved protection to restore
                    safe defaults.
                  </p>
                  {recoveryKind ? (
                    <Input
                      autoFocus
                      type="password"
                      inputMode={isPinCredential(recoveryKind) ? "numeric" : undefined}
                      placeholder={`Enter ${credentialLabel(recoveryKind)}`}
                      value={unlockValue}
                      onChange={(event) => setUnlockValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void recoverSettings();
                        }
                      }}
                      disabled={unlockBusy || lockRequestBusy}
                    />
                  ) : (
                    <p className="lock-overlay__detail">Use Windows Hello to authorize recovery.</p>
                  )}
                  <Button
                    onClick={() => void recoverSettings()}
                    disabled={unlockBusy || lockRequestBusy}
                  >
                    {unlockBusy
                      ? "Restoring settings…"
                      : recoveryKind
                        ? "Verify and restore settings"
                        : "Use Windows Hello and restore settings"}
                  </Button>
                </>
              ) : !protectionReady ? (
                <p className="lock-overlay__detail">Checking protection settings…</p>
              ) : activeCredential ? (
                <>
                  <p className="lock-overlay__detail">
                    Enter your {credentialLabel(activeCredential)} to unlock
                  </p>
                  <Input
                    autoFocus
                    type="password"
                    inputMode={isPinCredential(activeCredential) ? "numeric" : undefined}
                    placeholder={`Enter ${credentialLabel(activeCredential)}`}
                    value={unlockValue}
                    onChange={(event) => setUnlockValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void unlock();
                      }
                    }}
                    disabled={unlockBusy || lockRequestBusy}
                  />
                </>
              ) : (
                <p className="lock-overlay__detail">Use Windows Hello to unlock</p>
              )}
              {unlockError && <div className="inline-error">{unlockError}</div>}
              {protectionReady && activeCredential && (
                <Button onClick={() => void unlock()} disabled={unlockBusy || lockRequestBusy}>
                  {lockRequestBusy ? "Locking…" : unlockBusy ? "Checking…" : "Unlock"}
                </Button>
              )}
              {protectionReady && settings.windowsHello && !remoteFallbackActive && (
                <Button
                  variant="outline"
                  onClick={() => void unlockWithHello()}
                  disabled={unlockBusy || lockRequestBusy}
                >
                  <ScanFace size={15} />
                  {lockRequestBusy ? "Locking…" : unlockBusy ? "Checking…" : "Use Windows Hello"}
                </Button>
              )}
            </div>
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
