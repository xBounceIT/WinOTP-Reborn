import {
  ExternalLink,
  FolderOpen,
  GitBranch,
  Archive,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { credentialLabel, isPinCredential } from "@/lib/security-settings";
import {
  CHROME_EXTENSION_STORE,
  FIREFOX_EXTENSION_STORE,
  openExternalSafely,
  type BrowserExtensionStore,
} from "@/lib/browser-extension-stores";
import { useModalDialog } from "@/lib/use-modal-dialog";
import type {
  AppSettings,
  AutoStartResult,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  SecurityCredentialKind,
  SecurityOperationResult,
  ProtectionTransitionKind,
  SecurityVerification,
  UpdateOperationResult,
  UpdateState,
} from "@/lib/types";
import { getUpdateInstallToast } from "@/lib/update-result";

function ChromeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" />
    </svg>
  );
}

function FirefoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8.824 7.287c.008 0 .004 0 0 0zm-2.8-1.4c.006 0 .003 0 0 0zm16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477-.091-.147-.184-.292-.273-.446a3.545 3.545 0 0 1-.13-.24 2.118 2.118 0 0 1-.172-.46.03.03 0 0 0-.027-.03.038.038 0 0 0-.021 0l-.006.001a.037.037 0 0 0-.01.005L15.624 0c-2.585 1.515-3.657 4.168-3.932 5.856a6.197 6.197 0 0 0-2.305.587.297.297 0 0 0-.147.37c.057.162.24.24.396.17a5.622 5.622 0 0 1 2.008-.523l.067-.005a5.847 5.847 0 0 1 1.957.222l.095.03a5.816 5.816 0 0 1 .616.228c.08.036.16.073.238.112l.107.055a5.835 5.835 0 0 1 .368.211 5.953 5.953 0 0 1 2.034 2.104c-.62-.437-1.733-.868-2.803-.681 4.183 2.09 3.06 9.292-2.737 9.02a5.164 5.164 0 0 1-1.513-.292 4.42 4.42 0 0 1-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806 0 0 .537-2 3.845-2 .357 0 1.38-.998 1.398-1.287-.005-.095-2.029-.9-2.817-1.677-.422-.416-.622-.616-.8-.767a3.47 3.47 0 0 0-.301-.227 5.388 5.388 0 0 1-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913-.006-.025-.343.176-.389.206-.406.29-.787.616-1.136.974-.397.403-.76.839-1.085 1.303a9.816 9.816 0 0 0-1.562 3.52c-.003.013-.11.487-.19 1.073-.013.09-.026.181-.037.272a7.8 7.8 0 0 0-.069.667l-.002.034-.023.387-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661.02-.149.035-.298.052-.448.232-1.994-.025-4.09-.753-5.844z" />
    </svg>
  );
}

interface SettingsPageProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onAutoStartChange: (enabled: boolean) => Promise<AutoStartResult>;
  onToast: (message: string) => void;
  onLock: () => Promise<void>;
  backupFolderPath: string;
  hasStoredBackupPassword: boolean;
  onAutomaticBackupChange: (
    enabled: boolean,
    password?: string,
  ) => Promise<BackupConfigurationResult>;
  onBrowseBackupFolder: () => Promise<BackupConfigurationResult>;
  onResetBackupFolder: () => Promise<BackupConfigurationResult>;
  onImportBackup: (password: string) => Promise<BackupImportResult>;
  onExportBackup: (passwordOverride?: string) => Promise<BackupOperationResult>;
  updateState: UpdateState;
  onCheckForUpdates: () => Promise<UpdateOperationResult>;
  onInstallUpdate: () => Promise<UpdateOperationResult>;
  securityReady: boolean;
  onEnableWindowsHello: () => Promise<boolean>;
  onDisableWindowsHello: () => Promise<boolean>;
  onClearWindowsHelloFallbacks: () => Promise<boolean>;
  onTransitionProtection: (
    settings: AppSettings,
    kind: ProtectionTransitionKind,
    enabled: boolean,
  ) => Promise<AppSettings | undefined>;
  onPersistProtectionSettings: (settings: AppSettings) => Promise<boolean>;
  onSetCredential: (
    kind: SecurityCredentialKind,
    secret: string,
  ) => Promise<SecurityOperationResult>;
  onVerifyCredential: (
    kind: SecurityCredentialKind,
    secret: string,
  ) => Promise<SecurityVerification>;
  onRemoveCredential: (kind: SecurityCredentialKind) => Promise<boolean>;
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ label, hint, checked, onCheckedChange, disabled = false }: ToggleRowProps) {
  return (
    <div className="settings-control">
      <div className="settings-control__copy">
        <span className="settings-control__label">{label}</span>
        {hint && <span className="settings-control__hint">{hint}</span>}
      </div>
      <div className="settings-control__switch">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={label}
        />
      </div>
    </div>
  );
}

type PasswordDialogAction = "enable" | "import" | "export";
type BusyAction = PasswordDialogAction | "disable" | "browse" | "reset" | "autoStart";

const passwordDialogCopy: Record<
  PasswordDialogAction,
  { title: string; detail: string; submit: string }
> = {
  enable: {
    title: "Enable automatic backup",
    detail: "Choose a password. WinOTP stores it securely and uses it for automatic backups.",
    submit: "Enable backup",
  },
  import: {
    title: "Import backup",
    detail: "Enter the password used to protect this backup file.",
    submit: "Import",
  },
  export: {
    title: "Export backup",
    detail: "Choose a password for this exported backup file.",
    submit: "Export",
  },
};

function formatAccountCount(count: number | undefined) {
  const safeCount = count ?? 0;
  return `${safeCount} account${safeCount === 1 ? "" : "s"}`;
}

function updateStatusLabel(status: UpdateState["status"]) {
  switch (status) {
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return "Up to date";
    case "updateAvailable":
      return "Update available";
    case "downloading":
      return "Downloading installer…";
    case "launchReady":
      return "Installer ready";
    case "error":
      return "Unable to check for updates";
    case "disabled":
      return "Automatic checks are off";
    default:
      return "Ready to check";
  }
}

interface CredentialDialogState {
  kind: SecurityCredentialKind;
  mode: "setup" | "verify";
}

function CredentialDialog({
  dialog,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  dialog: CredentialDialogState;
  error: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (secret: string, confirmation: string) => void;
}) {
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const label = credentialLabel(dialog.kind);
  const pin = isPinCredential(dialog.kind);
  const setup = dialog.mode === "setup";
  const dialogRef = useModalDialog();

  return (
    <dialog
      ref={dialogRef}
      className="credential-dialog"
      aria-labelledby="credential-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        className="credential-dialog__panel"
        aria-labelledby="credential-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(secret, confirmation);
        }}
      >
        <h2 id="credential-dialog-title" className="credential-dialog__title">
          {setup ? `Set up ${label}` : `Verify ${label}`}
        </h2>
        <p className="credential-dialog__detail">
          {setup
            ? pin
              ? `Choose a ${label} to protect the app.`
              : "Choose a password to protect the app."
            : `Enter your ${label} to turn off this protection.`}
        </p>
        <Input
          autoFocus
          type="password"
          inputMode={pin ? "numeric" : undefined}
          autoComplete={setup ? "new-password" : "current-password"}
          placeholder={`Enter ${label}`}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          disabled={busy}
        />
        {setup && (
          <Input
            type="password"
            inputMode={pin ? "numeric" : undefined}
            autoComplete="new-password"
            placeholder={`Confirm ${label}`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
          />
        )}
        {error && <div className="inline-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : setup ? `Set ${label}` : "Verify"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function SettingsPage(props: SettingsPageProps) {
  return useSettingsPage(props);
}

function useSettingsPage({
  settings,
  onChange,
  onAutoStartChange,
  onToast,
  onLock,
  backupFolderPath,
  hasStoredBackupPassword,
  onAutomaticBackupChange,
  onBrowseBackupFolder,
  onResetBackupFolder,
  onImportBackup,
  onExportBackup,
  updateState,
  onCheckForUpdates,
  onInstallUpdate,
  securityReady,
  onEnableWindowsHello,
  onDisableWindowsHello,
  onClearWindowsHelloFallbacks,
  onTransitionProtection,
  onPersistProtectionSettings,
  onSetCredential,
  onVerifyCredential,
  onRemoveCredential,
}: SettingsPageProps) {
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialogAction>();
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const passwordDialogRef = useModalDialog(Boolean(passwordDialog));

  function openPasswordDialog(action: PasswordDialogAction) {
    setPasswordDialog(action);
    setPassword("");
    setPasswordConfirmation("");
    setPasswordError("");
  }

  function closePasswordDialog() {
    if (busyAction) {
      return;
    }

    setPasswordDialog(undefined);
    setPassword("");
    setPasswordConfirmation("");
    setPasswordError("");
  }

  async function handleAutomaticBackupChange(enabled: boolean) {
    if (enabled) {
      openPasswordDialog("enable");
      return;
    }

    setBusyAction("disable");
    try {
      const result = await onAutomaticBackupChange(false);
      if (result.success) {
        onToast("Automatic backup has been disabled. Existing backup files were kept.");
      } else {
        onToast(result.message ?? "Unable to disable automatic backup.");
      }
    } catch {
      onToast("Unable to disable automatic backup.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleAutoStartChange(enabled: boolean) {
    setBusyAction("autoStart");
    try {
      const result = await onAutoStartChange(enabled);
      if (result.success) {
        onToast(enabled ? "WinOTP will start when you sign in." : "WinOTP auto-start disabled.");
      } else {
        onToast(result.message ?? "Unable to update auto-start.");
      }
    } catch {
      onToast("Unable to update auto-start.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleBrowseBackupFolder() {
    setBusyAction("browse");
    try {
      const result = await onBrowseBackupFolder();
      if (result.success) {
        onToast(`Automatic backup folder updated to:\n${result.effectiveFolderPath}`);
      } else if (!result.cancelled) {
        onToast(result.message ?? "Unable to update the automatic backup folder.");
      }
    } catch {
      onToast("Unable to update the automatic backup folder.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleResetBackupFolder() {
    setBusyAction("reset");
    try {
      const result = await onResetBackupFolder();
      if (result.success) {
        onToast(`Automatic backup folder reset to default:\n${result.effectiveFolderPath}`);
      } else {
        onToast(result.message ?? "Unable to reset the automatic backup folder.");
      }
    } catch {
      onToast("Unable to reset the automatic backup folder.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleExportBackup(passwordOverride?: string) {
    setBusyAction("export");
    try {
      const result = await onExportBackup(passwordOverride);
      if (result.success) {
        setPasswordDialog(undefined);
        onToast(`Backup exported successfully. ${formatAccountCount(result.accountCount)}.`);
      } else if (result.errorCode === "PasswordUnavailable" && passwordOverride === undefined) {
        openPasswordDialog("export");
      } else if (!result.cancelled) {
        if (passwordDialog) {
          setPasswordError(result.message ?? "Unable to export the backup.");
        } else {
          onToast(result.message ?? "Unable to export the backup.");
        }
      }
    } catch {
      if (passwordDialog) {
        setPasswordError("Unable to export the backup.");
      } else {
        onToast("Unable to export the backup.");
      }
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleCheckForUpdates() {
    try {
      const result = await onCheckForUpdates();
      if (!result.success) {
        onToast(result.message ?? "Unable to check for updates.");
      }
    } catch {
      onToast("Unable to check for updates.");
    }
  }

  async function handleInstallUpdate() {
    try {
      const result = await onInstallUpdate();
      onToast(getUpdateInstallToast(result));
    } catch {
      onToast("Unable to launch the update installer.");
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordDialog) {
      return;
    }

    if (passwordDialog !== "import" && password !== passwordConfirmation) {
      setPasswordError("The passwords do not match.");
      return;
    }

    setPasswordError("");
    setBusyAction(passwordDialog);
    try {
      if (passwordDialog === "enable") {
        const result = await onAutomaticBackupChange(true, password);
        if (result.success) {
          setPasswordDialog(undefined);
          onToast("Automatic backups enabled");
        } else {
          setPasswordError(result.message ?? "Unable to enable automatic backup.");
        }
      } else if (passwordDialog === "import") {
        const result = await onImportBackup(password);
        if (result.success) {
          setPasswordDialog(undefined);
          const summary = `Imported ${formatAccountCount(result.importedCount)}.`;
          const details = [
            result.replacedCount ? `${result.replacedCount} replaced` : "",
            result.skippedCount ? `${result.skippedCount} skipped` : "",
            result.failedCount ? `${result.failedCount} failed` : "",
          ].filter(Boolean);
          const automaticFailure =
            result.automaticBackup?.success === false
              ? ` Automatic backup failed: ${result.automaticBackup.message ?? "unknown error"}`
              : "";
          onToast(
            `${summary}${details.length > 0 ? ` ${details.join(", ")}.` : ""}${automaticFailure}`,
          );
        } else if (!result.cancelled) {
          setPasswordError(result.message ?? "Unable to import the backup.");
        } else {
          setPasswordDialog(undefined);
        }
      } else {
        await handleExportBackup(password);
      }
    } catch {
      setPasswordError("The backup operation could not be completed.");
    } finally {
      setBusyAction(undefined);
    }
  }
  const [credentialDialog, setCredentialDialog] = useState<CredentialDialogState>();
  const [credentialDialogError, setCredentialDialogError] = useState("");
  const [credentialDialogBusy, setCredentialDialogBusy] = useState(false);
  const [windowsHelloBusy, setWindowsHelloBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const credentialDialogBusyRef = useRef(false);
  const windowsHelloBusyRef = useRef(false);
  const lockBusyRef = useRef(false);

  async function openRepository() {
    const opened = await openExternalSafely(
      window.winotp?.openExternal,
      "https://github.com/xBounceIT/WinOTP-Reborn",
    );
    if (!opened) {
      onToast("Repository link is available once the Electron shell is running.");
    }
  }

  async function openBrowserExtension(store: BrowserExtensionStore) {
    const opened = await openExternalSafely(window.winotp?.openExternal, store.url);
    if (!opened) {
      onToast(`${store.browser} extension link is available once the Electron shell is running.`);
    }
  }

  function openCredentialDialog(kind: SecurityCredentialKind, mode: "setup" | "verify") {
    if (
      !securityReady ||
      credentialDialogBusyRef.current ||
      windowsHelloBusyRef.current ||
      lockBusyRef.current ||
      credentialDialog
    ) {
      return;
    }

    setCredentialDialogError("");
    setCredentialDialog({ kind, mode });
  }

  function closeCredentialDialog() {
    if (!credentialDialogBusyRef.current) {
      setCredentialDialog(undefined);
      setCredentialDialogError("");
    }
  }

  async function submitCredentialDialog(secret: string, confirmation: string) {
    if (
      !credentialDialog ||
      credentialDialogBusyRef.current ||
      windowsHelloBusyRef.current ||
      lockBusyRef.current
    ) {
      return;
    }

    const { kind, mode } = credentialDialog;
    if (mode === "setup") {
      if (secret !== confirmation) {
        setCredentialDialogError(`${credentialLabel(kind)} entries do not match.`);
        return;
      }
    }

    credentialDialogBusyRef.current = true;
    setCredentialDialogBusy(true);
    try {
      if (mode === "setup") {
        const saved = await onSetCredential(kind, secret);
        if (!saved.success) {
          setCredentialDialogError(saved.message ?? "The security credential could not be saved.");
          return;
        }

        const nextSettings = await onTransitionProtection(settings, kind, true);
        if (!nextSettings || !(await onPersistProtectionSettings(nextSettings))) {
          await onRemoveCredential(kind);
          setCredentialDialogError(
            "Protection settings could not be saved; setup was rolled back.",
          );
          return;
        }
      } else {
        const verification = await onVerifyCredential(kind, secret);
        if (verification.error) {
          setCredentialDialogError(verification.error);
          return;
        }

        if (!verification.available) {
          const nextSettings = await onTransitionProtection(settings, kind, false);
          if (!nextSettings || !(await onPersistProtectionSettings(nextSettings))) {
            setCredentialDialogError(
              "Protection settings could not be saved; protection remains enabled.",
            );
            return;
          }

          setCredentialDialog(undefined);
          setCredentialDialogError("");
          onToast(
            `${credentialLabel(kind)} protection was disabled because its credential is unavailable.`,
          );
          return;
        }

        if (!verification.verified) {
          setCredentialDialogError(`Incorrect ${credentialLabel(kind)}.`);
          return;
        }

        const nextSettings = await onTransitionProtection(settings, kind, false);
        if (!nextSettings || !(await onPersistProtectionSettings(nextSettings))) {
          setCredentialDialogError(
            "Protection settings could not be saved; protection remains enabled.",
          );
          return;
        }

        const removed = await onRemoveCredential(kind);
        if (!removed) {
          const restored = await onPersistProtectionSettings(settings);
          setCredentialDialogError(
            restored
              ? "The security credential could not be removed; protection remains enabled."
              : "The security credential could not be removed or restore protection settings.",
          );
          return;
        }
      }

      setCredentialDialog(undefined);
      setCredentialDialogError("");
    } finally {
      credentialDialogBusyRef.current = false;
      setCredentialDialogBusy(false);
    }
  }

  async function handleWindowsHelloChange(checked: boolean) {
    if (
      windowsHelloBusyRef.current ||
      credentialDialogBusyRef.current ||
      lockBusyRef.current ||
      credentialDialog
    ) {
      return;
    }

    windowsHelloBusyRef.current = true;
    setWindowsHelloBusy(true);
    try {
      if (checked) {
        if (!(await onEnableWindowsHello())) {
          return;
        }

        const nextSettings = await onTransitionProtection(settings, "windowsHello", true);
        if (nextSettings) {
          await onPersistProtectionSettings(nextSettings);
        }
        return;
      }

      if (!(await onDisableWindowsHello())) {
        return;
      }

      const nextSettings = await onTransitionProtection(settings, "windowsHello", false);
      if (!nextSettings || !(await onPersistProtectionSettings(nextSettings))) {
        return;
      }

      await onClearWindowsHelloFallbacks();
    } finally {
      windowsHelloBusyRef.current = false;
      setWindowsHelloBusy(false);
    }
  }

  async function handleLock() {
    if (
      lockBusyRef.current ||
      credentialDialogBusyRef.current ||
      windowsHelloBusyRef.current ||
      credentialDialog
    ) {
      return;
    }

    lockBusyRef.current = true;
    setLockBusy(true);
    try {
      await onLock();
    } finally {
      lockBusyRef.current = false;
      setLockBusy(false);
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-shell">
        <div className="settings-stack">
          <Card className="settings-card">
            <CardTitle className="settings-card__title">Security</CardTitle>
            <ToggleRow
              label="Protect app with PIN"
              checked={settings.pinProtection}
              disabled={
                !securityReady ||
                credentialDialogBusy ||
                windowsHelloBusy ||
                lockBusy ||
                settings.passwordProtection ||
                settings.windowsHello
              }
              onCheckedChange={(checked) =>
                openCredentialDialog("pin", checked ? "setup" : "verify")
              }
            />
            <ToggleRow
              label="Protect app with password"
              checked={settings.passwordProtection}
              disabled={
                !securityReady ||
                credentialDialogBusy ||
                windowsHelloBusy ||
                lockBusy ||
                settings.pinProtection ||
                settings.windowsHello
              }
              onCheckedChange={(checked) =>
                openCredentialDialog("password", checked ? "setup" : "verify")
              }
            />
            <ToggleRow
              label="Protect app with Windows Hello"
              checked={settings.windowsHello}
              disabled={
                !securityReady ||
                credentialDialogBusy ||
                windowsHelloBusy ||
                lockBusy ||
                settings.pinProtection ||
                settings.passwordProtection
              }
              onCheckedChange={(checked) => void handleWindowsHelloChange(checked)}
            />

            {settings.windowsHello && (
              <div className="settings-subsection">
                <h2 className="settings-subsection__title">Remote Desktop fallback</h2>
                <p className="settings-card__description">
                  Windows Hello is unavailable over Remote Desktop. Add an optional PIN or password
                  that WinOTP requires only while you are connected remotely.
                </p>
                <ToggleRow
                  label="Require PIN over Remote Desktop"
                  checked={settings.remotePin}
                  disabled={
                    !securityReady ||
                    credentialDialogBusy ||
                    windowsHelloBusy ||
                    lockBusy ||
                    settings.remotePassword
                  }
                  onCheckedChange={(checked) =>
                    openCredentialDialog("remotePin", checked ? "setup" : "verify")
                  }
                />
                <ToggleRow
                  label="Require password over Remote Desktop"
                  checked={settings.remotePassword}
                  disabled={
                    !securityReady ||
                    credentialDialogBusy ||
                    windowsHelloBusy ||
                    lockBusy ||
                    settings.remotePin
                  }
                  onCheckedChange={(checked) =>
                    openCredentialDialog("remotePassword", checked ? "setup" : "verify")
                  }
                />
              </div>
            )}

            <div className="form-field">
              <Label className="form-field__label" htmlFor="auto-lock">
                Auto-lock after inactivity
              </Label>
              <Select
                value={settings.autoLock}
                onValueChange={(value) => onChange("autoLock", value)}
              >
                <SelectTrigger id="auto-lock" className="settings-select">
                  <SelectValue placeholder="Select lock timeout" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Never</SelectItem>
                  <SelectItem value="1">1 minute</SelectItem>
                  <SelectItem value="2">2 minutes</SelectItem>
                  <SelectItem value="5">5 minutes</SelectItem>
                  <SelectItem value="10">10 minutes</SelectItem>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                </SelectContent>
              </Select>
              <span className="form-field__hint">
                Automatically lock the app after a period of inactivity when protection is enabled.
              </span>
            </div>
            {(settings.pinProtection || settings.passwordProtection || settings.windowsHello) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLock()}
                disabled={!securityReady || lockBusy || credentialDialogBusy || windowsHelloBusy}
              >
                <LockKeyhole size={14} />
                Lock preview now
              </Button>
            )}
          </Card>

          <Card className="settings-card">
            <div className="settings-card__title-row">
              <CardTitle className="settings-card__title">Browser extension</CardTitle>
            </div>
            <p className="settings-card__description">
              Connect the official Chrome, Chromium, or Firefox extension directly to this app. The
              local bridge has no cloud service and never shares account secrets.
            </p>
            <ToggleRow
              label="Allow browser extension access"
              hint="Registers the local Native Messaging host. Account labels and requested codes are available only while WinOTP is unlocked."
              checked={settings.webBridgeEnabled}
              onCheckedChange={(checked) => onChange("webBridgeEnabled", checked)}
            />
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openBrowserExtension(CHROME_EXTENSION_STORE)}
              >
                <ChromeIcon />
                {CHROME_EXTENSION_STORE.label}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openBrowserExtension(FIREFOX_EXTENSION_STORE)}
              >
                <FirefoxIcon />
                {FIREFOX_EXTENSION_STORE.label}
              </Button>
            </div>
          </Card>

          <Card className="settings-card">
            <CardTitle className="settings-card__title">Display</CardTitle>
            <ToggleRow
              label="Show next TOTP code when 5 seconds remain"
              hint="Keeps the current code visible and shows the upcoming code as a hint in the last 5 seconds."
              checked={settings.showNextCode}
              onCheckedChange={(checked) => onChange("showNextCode", checked)}
            />
            <ToggleRow
              label="Start WinOTP when I sign in"
              hint="Automatically launch the app in the background when you sign in."
              checked={settings.autoStart}
              disabled={Boolean(busyAction)}
              onCheckedChange={(checked) => void handleAutoStartChange(checked)}
            />
            <ToggleRow
              label="Minimize on close"
              hint="When closing the window, minimize the app instead of exiting."
              checked={settings.minimizeOnClose}
              onCheckedChange={(checked) => onChange("minimizeOnClose", checked)}
            />
            <ToggleRow
              label="Minimize to tray on close"
              hint="When closing the window, minimize the app to the system tray instead of exiting."
              checked={settings.minimizeToTray}
              onCheckedChange={(checked) => onChange("minimizeToTray", checked)}
            />
            <ToggleRow
              label="Show TOTP codes in tray menu"
              hint="Display TOTP accounts in the system tray right-click menu. Clicking a code copies it to the clipboard."
              checked={settings.showTotpInTray}
              onCheckedChange={(checked) => onChange("showTotpInTray", checked)}
            />
            <div className="form-field" style={{ marginTop: 8 }}>
              <Label className="form-field__label" htmlFor="theme">
                Theme preview
              </Label>
              <Select
                value={settings.theme}
                onValueChange={(value) => onChange("theme", value as AppSettings["theme"])}
              >
                <SelectTrigger id="theme" className="settings-select">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="settings-card">
            <CardTitle className="settings-card__title">Backup</CardTitle>
            <ToggleRow
              label="Enable automatic backup"
              hint="Password-protected backups are stored locally whenever your tokens change."
              checked={settings.automaticBackup}
              disabled={Boolean(busyAction)}
              onCheckedChange={(checked) => void handleAutomaticBackupChange(checked)}
            />
            <p className="settings-card__description">Backup folder: {backupFolderPath}</p>
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() => void handleBrowseBackupFolder()}
              >
                <FolderOpen size={14} />
                Set folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busyAction) || !settings.customBackupFolderPath}
                onClick={() => void handleResetBackupFolder()}
              >
                <RotateCcw size={14} />
                Reset to default
              </Button>
            </div>
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() => openPasswordDialog("import")}
              >
                <Archive size={14} />
                Import backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  hasStoredBackupPassword ? void handleExportBackup() : openPasswordDialog("export")
                }
              >
                <Save size={14} />
                Export backup
              </Button>
            </div>
          </Card>

          <Card className="settings-card">
            <CardTitle className="settings-card__title">Check for updates</CardTitle>
            <ToggleRow
              label="Automatically check on startup"
              checked={settings.updateOnStartup}
              onCheckedChange={(checked) => onChange("updateOnStartup", checked)}
            />
            <div className="form-field">
              <Label className="form-field__label" htmlFor="update-channel">
                Update channel
              </Label>
              <Select
                value={settings.updateChannel}
                onValueChange={(value) =>
                  onChange("updateChannel", value as AppSettings["updateChannel"])
                }
              >
                <SelectTrigger
                  id="update-channel"
                  className="settings-select"
                  disabled={updateState.isBusy || Boolean(busyAction)}
                >
                  <SelectValue placeholder="Select update channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Stable">Stable</SelectItem>
                  <SelectItem value="Pre-release">Pre-release</SelectItem>
                </SelectContent>
              </Select>
              <span className="form-field__hint">
                {settings.updateChannel === "Stable"
                  ? "Stable checks published releases only."
                  : "Pre-release also includes prerelease tags on GitHub."}
              </span>
            </div>
            <div className="settings-row">
              <span>Current version</span>
              <span className="settings-row__value">
                {updateState.currentVersion || "Loading…"}
              </span>
            </div>
            <div className="settings-row">
              <span>Status</span>
              <span className="settings-row__value">
                {updateState.statusMessage || updateStatusLabel(updateState.status)}
              </span>
            </div>
            {updateState.availableUpdate && (
              <div className="settings-card__description" role="status">
                Version {updateState.availableUpdate.displayVersion} is available.
              </div>
            )}
            {updateState.status === "error" && updateState.lastError && (
              <div className="inline-error" role="alert">
                {updateState.lastError}
              </div>
            )}
            <div className="settings-buttons settings-buttons--fill-single">
              <Button
                variant="outline"
                size="sm"
                disabled={updateState.isBusy || Boolean(busyAction)}
                onClick={() => void handleCheckForUpdates()}
              >
                <RefreshCw size={14} />
                {updateState.isBusy ? "Checking…" : "Check now"}
              </Button>
              {updateState.isUpdateAvailable && (
                <Button
                  size="sm"
                  disabled={updateState.isBusy || Boolean(busyAction)}
                  onClick={() => void handleInstallUpdate()}
                >
                  {updateState.status === "launchReady" ? "Install update" : "Download and install"}
                </Button>
              )}
            </div>
          </Card>

          <Card className="settings-card">
            <CardTitle className="settings-card__title">About</CardTitle>
            <div className="settings-row">
              <span>GitHub Repository</span>
              <Button variant="ghost" size="sm" onClick={() => void openRepository()}>
                <GitBranch size={14} />
                Go to repository
                <ExternalLink size={12} />
              </Button>
            </div>
            <div className="settings-row">
              <span>Owner</span>
              <span className="settings-row__value">Daniel D&apos;Angeli</span>
            </div>
            <div className="settings-row">
              <span>License</span>
              <span className="settings-row__value">MIT</span>
            </div>
          </Card>
        </div>
      </div>
      {passwordDialog && (
        <dialog
          ref={passwordDialogRef}
          className="lock-overlay"
          aria-labelledby="backup-password-title"
          onCancel={(event) => {
            event.preventDefault();
            closePasswordDialog();
          }}
        >
          <div className="lock-overlay__panel">
            <LockKeyhole className="lock-overlay__icon" size={42} strokeWidth={1.35} />
            <h1 id="backup-password-title" className="lock-overlay__title">
              {passwordDialogCopy[passwordDialog].title}
            </h1>
            <p className="lock-overlay__detail">{passwordDialogCopy[passwordDialog].detail}</p>
            <form className="form-stack" onSubmit={(event) => void handlePasswordSubmit(event)}>
              <Input
                autoFocus
                type="password"
                placeholder="Backup password"
                value={password}
                disabled={Boolean(busyAction)}
                onChange={(event) => setPassword(event.target.value)}
              />
              {passwordDialog !== "import" && (
                <Input
                  type="password"
                  placeholder="Confirm password"
                  value={passwordConfirmation}
                  disabled={Boolean(busyAction)}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                />
              )}
              {passwordError && <div className="inline-error">{passwordError}</div>}
              <Button type="submit" disabled={Boolean(busyAction)}>
                {busyAction ? "Working…" : passwordDialogCopy[passwordDialog].submit}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={closePasswordDialog}
              >
                Cancel
              </Button>
            </form>
          </div>
        </dialog>
      )}
      {credentialDialog && (
        <CredentialDialog
          key={`${credentialDialog.kind}-${credentialDialog.mode}`}
          dialog={credentialDialog}
          error={credentialDialogError}
          busy={credentialDialogBusy}
          onCancel={closeCredentialDialog}
          onSubmit={(secret, confirmation) => void submitCredentialDialog(secret, confirmation)}
        />
      )}
    </div>
  );
}
