import {
  Check,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Archive,
  LockKeyhole,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    setSecret("");
    setConfirmation("");
  }, [dialog]);

  return (
    <div className="credential-dialog" role="presentation">
      <form
        className="credential-dialog__panel"
        role="dialog"
        aria-modal="true"
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
    </div>
  );
}

export function SettingsPage({
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
      if (result.success) {
        onToast("The update installer was launched.");
      } else {
        onToast(result.message ?? "Unable to launch the update installer.");
      }
    } catch {
      onToast("Unable to launch the update installer.");
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordDialog) {
      return;
    }

    if (password.length < 8 || !password.trim()) {
      setPasswordError("Backup password must be at least 8 characters.");
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
    const opened = await window.winotp?.openExternal("https://github.com/xBounceIT/WinOTP-Reborn");
    if (!opened) {
      onToast("Repository link is available once the Electron shell is running.");
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
                Browse
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
                <SelectTrigger id="update-channel" className="settings-select">
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
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                disabled={updateState.isBusy || Boolean(busyAction)}
                onClick={() => void handleCheckForUpdates()}
              >
                <Check size={14} />
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
        <div
          className="lock-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-password-title"
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
                minLength={8}
                placeholder="Backup password"
                value={password}
                disabled={Boolean(busyAction)}
                onChange={(event) => setPassword(event.target.value)}
              />
              {passwordDialog !== "import" && (
                <Input
                  type="password"
                  minLength={8}
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
        </div>
      )}
      {credentialDialog && (
        <CredentialDialog
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
