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
import type {
  AppSettings,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  OtpAccount,
  Route,
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
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const backupMutationVersion = useRef(0);
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

  function unlock() {
    if (!unlockValue.trim()) {
      setUnlockError("Enter a PIN or password to unlock the preview.");
      return;
    }

    setLocked(false);
    setUnlockValue("");
    setUnlockError("");
    showToast("WinOTP unlocked");
  }

  function unlockWithHello() {
    setLocked(false);
    setUnlockValue("");
    setUnlockError("");
    showToast("Windows Hello bridge is ready to connect");
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
        onLock={() => setLocked(true)}
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
      />
    );
  }

  return (
    <TooltipProvider>
      <div className="app-shell">
        <div className="window-titlebar" aria-label="WinOTP">
          <img className="window-titlebar__icon" src="./app.ico" alt="" aria-hidden="true" />
          <span className="window-titlebar__title">WinOTP</span>
        </div>

        <div className="app-body">
          <NavigationRail route={route} onNavigate={navigate} />
          <main className="content-frame">{renderPage()}</main>
        </div>

        {locked && (
          <div
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
              <p className="lock-overlay__detail">
                Enter your {settings.pinProtection ? "PIN" : "password"} to unlock
              </p>
              <Input
                autoFocus
                type="password"
                maxLength={32}
                placeholder={settings.pinProtection ? "Enter PIN" : "Enter password"}
                value={unlockValue}
                onChange={(event) => setUnlockValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    unlock();
                  }
                }}
              />
              {unlockError && <div className="inline-error">{unlockError}</div>}
              <Button onClick={unlock}>Unlock</Button>
              {settings.windowsHello && (
                <Button variant="outline" onClick={unlockWithHello}>
                  <ScanFace size={15} />
                  Use Windows Hello
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
