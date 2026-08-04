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
import { useTotp } from "@/lib/use-totp";
import {
  directCredentialKind,
  emptySecurityStatus,
  credentialLabel,
  isPinCredential,
  normalizeSecuritySettings,
  remoteCredentialKind,
  securityVerificationFromResult,
  settingForCredential,
  securityStatusKey,
} from "@/lib/security-settings";
import type {
  AppSettings,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  OtpAccount,
  Route,
  SecurityCredentialKind,
  SecurityCredentialStatus,
  SecurityVerification,
  WindowsHelloAvailabilityStatus,
  WindowsHelloVerificationResult,
} from "@/lib/types";
import { defaultSettings } from "@/lib/types";

const settingsStorageKey = "winotp-electron.settings";

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
  const stored = readStorage<Partial<AppSettings>>(settingsStorageKey, {});
  const savedSettings =
    stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};

  return {
    ...defaultSettings,
    ...savedSettings,
    automaticBackup: savedSettings.automaticBackup === true,
    customBackupFolderPath:
      typeof savedSettings.customBackupFolderPath === "string"
        ? savedSettings.customBackupFolderPath
        : "",
  };
}

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [accounts, setAccounts] = useState<OtpAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [settings, setSettings] = useState<AppSettings>(readAppSettings);
  const [backupStatus, setBackupStatus] = useState<BackupConfigurationResult>();
  const [editingAccount, setEditingAccount] = useState<OtpAccount>();
  const [toast, setToast] = useState("");
  const [locked, setLocked] = useState(false);
  const [remoteFallbackActive, setRemoteFallbackActive] = useState(false);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [securityReady, setSecurityReady] = useState(false);
  const [securityStorageAvailable, setSecurityStorageAvailable] = useState(true);
  const [securityStatus, setSecurityStatus] =
    useState<SecurityCredentialStatus>(emptySecurityStatus);
  const settingsRef = useRef(settings);
  const unlockBusyRef = useRef(false);
  const lockBusyRef = useRef(false);
  const lockOverlayRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const backupMutationVersion = useRef(0);
  settingsRef.current = settings;
  const { accountTiming, codes } = useTotp(accounts);

  useEffect(() => {
    let cancelled = false;

    async function loadAccounts() {
      setAccountsLoading(true);
      setAccountsError("");

      if (!window.winotp?.accounts) {
        if (!cancelled) {
          setAccountsLoading(false);
          setAccountsError("The Electron storage bridge is unavailable.");
        }
        return;
      }

      try {
        const result = await window.winotp.accounts.list();
        if (cancelled) {
          return;
        }

        setAccounts(result.accounts);
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
          void window.winotp.accounts.acknowledgeMigration().catch(() => undefined);
        } else if (result.issues.length > 0) {
          showToast("Some stored accounts could not be loaded.");
        }
      } catch {
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
        setSettings((current) => normalizeSecuritySettings(current, status));
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
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings]);

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
        setSettings((current) => ({
          ...current,
          automaticBackup: result.automaticEnabled,
          customBackupFolderPath: result.customFolderPath,
        }));
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

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function navigate(nextRoute: Route) {
    setRoute(nextRoute);
    if (nextRoute !== "manual") {
      setEditingAccount(undefined);
    }
  }

  function editAccount(account: OtpAccount) {
    setEditingAccount(account);
    setRoute("manual");
  }

  async function saveAccount(account: OtpAccount) {
    try {
      const result = await window.winotp?.accounts.save(account);
      if (!result?.success || !result.account) {
        showToast(result?.message ?? "Unable to save the account.");
        return;
      }

      const persistedAccount = result.account;
      const wasEditing = Boolean(editingAccount);
      setAccounts((current) => {
        const existing = current.some((item) => item.id === persistedAccount.id);
        return existing
          ? current.map((item) => (item.id === persistedAccount.id ? persistedAccount : item))
          : [...current, persistedAccount];
      });
      setEditingAccount(undefined);
      setRoute("home");
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

  async function copyCode(account: OtpAccount, code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      showToast("Clipboard access is unavailable");
      return;
    }

    let usageSaved = true;
    try {
      const result = await window.winotp?.accounts.recordUsage(account.id);
      if (result?.success) {
        setAccounts((current) =>
          current.map((item) =>
            item.id === account.id ? { ...item, usageCount: result.usageCount } : item,
          ),
        );
      } else {
        usageSaved = false;
      }
    } catch {
      usageSaved = false;
    }

    const label = account.issuer || account.accountName;
    showToast(usageSaved ? `${label} code copied` : `${label} code copied; usage not saved`);
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
    setSettings((current) => ({ ...current, [key]: value }));
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
        try {
          const loadResult = await window.winotp?.accounts.list();
          if (loadResult) {
            setAccounts(loadResult.accounts);
            setAccountsError(
              loadResult.issues.find((issue) => issue.code === "storage-unavailable")?.message ??
                "",
            );
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

  async function setSecurityCredential(kind: SecurityCredentialKind, secret: string) {
    try {
      const result = await window.winotp?.security.setCredential(kind, secret);
      if (!result?.success) {
        showToast(result?.message ?? "The security credential could not be saved.");
        return false;
      }

      setSecurityStorageAvailable(true);
      setSecurityStatus((current) => ({ ...current, [securityStatusKey(kind)]: true }));
      return true;
    } catch {
      showToast("The security credential could not be saved.");
      return false;
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
      await clearWindowsHelloFallbackCredentials(true);
      return true;
    } else if (verification.status !== "verified") {
      showToast(windowsHelloVerificationMessage(verification.status));
      return false;
    }

    const removed = await clearWindowsHelloFallbackCredentials(true);

    if (!removed) {
      showToast("A Remote Desktop fallback credential could not be cleared.");
    }
    return removed;
  }

  async function disableUnavailableWindowsHello() {
    setLocked(false);
    setRemoteFallbackActive(false);
    setUnlockValue("");
    setUnlockError("");
    setSettings((current) => ({
      ...current,
      windowsHello: false,
      remotePin: false,
      remotePassword: false,
    }));

    await clearWindowsHelloFallbackCredentials();

    showToast("Windows Hello was unavailable and has been disabled.");
  }

  async function lockPreview() {
    if (lockBusyRef.current) {
      return;
    }

    lockBusyRef.current = true;
    const settingsAtStart = settingsRef.current;
    const kind = directCredentialKind(settingsAtStart);
    try {
      if (kind && !securityReady) {
        showToast("Secure storage is still loading. Try again shortly.");
        return;
      }

      if (kind && !securityStorageAvailable) {
        showToast("Secure storage is unavailable; saved protection remains enabled.");
        return;
      }

      if (kind && !securityStatus[securityStatusKey(kind)]) {
        setSettings((current) => normalizeSecuritySettings(current, securityStatus));
        showToast(`Set up your ${kind === "pin" ? "PIN" : "password"} before locking the app.`);
        return;
      }

      if (settingsRef.current !== settingsAtStart) {
        showToast("Security settings changed; try locking again.");
        return;
      }

      if (settingsAtStart.windowsHello) {
        const availability = await checkWindowsHelloAvailability();
        if (settingsRef.current !== settingsAtStart) {
          showToast("Security settings changed; try locking again.");
          return;
        }

        if (availability === "remote-session") {
          const remoteKind = remoteCredentialKind(settingsAtStart);
          if (remoteKind && securityStatus[securityStatusKey(remoteKind)]) {
            setRemoteFallbackActive(true);
          } else {
            showToast(windowsHelloAvailabilityMessage(availability));
            return;
          }
        } else if (availability === "unavailable") {
          await disableUnavailableWindowsHello();
          return;
        } else if (availability === "error") {
          showToast(windowsHelloAvailabilityMessage(availability));
          return;
        } else {
          setRemoteFallbackActive(false);
        }
      }

      setLocked(true);
      setUnlockValue("");
      setUnlockError("");
    } finally {
      lockBusyRef.current = false;
    }
  }

  async function unlock() {
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
      setLocked(false);
      setSettings((current) => normalizeSecuritySettings(current, securityStatus));
      setUnlockError("");
      showToast("This protection has no saved credential and was disabled.");
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
    try {
      const verification = await verifySecurityCredential(kind, unlockValue);
      if (verification.error) {
        setUnlockError(verification.error);
        return;
      }

      if (!verification.available) {
        const unavailableStatus = {
          ...securityStatus,
          [securityStatusKey(kind)]: false,
        };
        setSecurityStatus(unavailableStatus);
        setLocked(false);
        setSettings((current) => normalizeSecuritySettings(current, unavailableStatus));
        setUnlockValue("");
        setUnlockError("");
        showToast("This protection could not be verified and was disabled.");
        return;
      }

      if (!verification.verified) {
        setUnlockError(`Incorrect ${credentialLabel(kind)}. Try again.`);
        setUnlockValue("");
        return;
      }

      setLocked(false);
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
    if (unlockBusyRef.current) {
      return;
    }

    unlockBusyRef.current = true;
    setUnlockBusy(true);
    setUnlockError("");
    try {
      const verification = await requestWindowsHelloVerification();
      if (!verification.success) {
        setUnlockError(verification.message ?? "The Windows Hello bridge is unavailable.");
        return;
      }

      if (verification.status === "verified") {
        setLocked(false);
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
          loading={accountsLoading}
          storageError={accountsError}
          showNextCode={settings.showNextCode}
          accountTiming={accountTiming}
          codes={codes}
          onNavigate={navigate}
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
      return <ImportPage onToast={showToast} />;
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
        onToast={showToast}
        onLock={lockPreview}
        backupFolderPath={
          backupStatus?.effectiveFolderPath ||
          settings.customBackupFolderPath ||
          "%LocalAppData%\\WinOTP_Reborn\\Backups"
        }
        hasStoredBackupPassword={backupStatus?.hasStoredPassword ?? false}
        onAutomaticBackupChange={changeAutomaticBackup}
        onBrowseBackupFolder={browseBackupFolder}
        onResetBackupFolder={resetBackupFolder}
        onImportBackup={importBackup}
        onExportBackup={exportBackup}
        securityReady={securityReady}
        onEnableWindowsHello={enableWindowsHelloProtection}
        onDisableWindowsHello={disableWindowsHelloProtection}
        onSetCredential={setSecurityCredential}
        onVerifyCredential={verifySecurityCredential}
        onRemoveCredential={removeSecurityCredential}
      />
    );
  }

  const activeCredential = remoteFallbackActive
    ? remoteCredentialKind(settings)
    : directCredentialKind(settings);

  return (
    <TooltipProvider>
      <div className="app-shell">
        <div className="window-titlebar" aria-label="WinOTP" aria-hidden={locked} inert={locked}>
          <img className="window-titlebar__icon" src="./app.ico" alt="" aria-hidden="true" />
          <span className="window-titlebar__title">WinOTP</span>
        </div>

        <div className="app-body" aria-hidden={locked} inert={locked}>
          <NavigationRail route={route} onNavigate={navigate} />
          <main className="content-frame">{renderPage()}</main>
        </div>

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
                WinOTP is locked
              </h1>
              {activeCredential ? (
                <>
                  <p className="lock-overlay__detail">
                    Enter your {credentialLabel(activeCredential)} to unlock
                  </p>
                  <Input
                    autoFocus
                    type="password"
                    inputMode={isPinCredential(activeCredential) ? "numeric" : undefined}
                    maxLength={isPinCredential(activeCredential) ? 6 : 128}
                    placeholder={`Enter ${credentialLabel(activeCredential)}`}
                    value={unlockValue}
                    onChange={(event) => setUnlockValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void unlock();
                      }
                    }}
                    disabled={unlockBusy}
                  />
                </>
              ) : (
                <p className="lock-overlay__detail">Use Windows Hello to unlock</p>
              )}
              {unlockError && <div className="inline-error">{unlockError}</div>}
              {activeCredential && (
                <Button onClick={() => void unlock()} disabled={unlockBusy}>
                  {unlockBusy ? "Checking…" : "Unlock"}
                </Button>
              )}
              {settings.windowsHello && !remoteFallbackActive && (
                <Button
                  variant="outline"
                  onClick={() => void unlockWithHello()}
                  disabled={unlockBusy}
                >
                  <ScanFace size={15} />
                  {unlockBusy ? "Checking…" : "Use Windows Hello"}
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
