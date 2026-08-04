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
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import type {
  AppSettings,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
} from "@/lib/types";

interface SettingsPageProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onToast: (message: string) => void;
  onLock: () => void;
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
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ label, hint, checked, disabled, onCheckedChange }: ToggleRowProps) {
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
type BusyAction = PasswordDialogAction | "disable" | "browse" | "reset";

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

export function SettingsPage({
  settings,
  onChange,
  onToast,
  onLock,
  backupFolderPath,
  hasStoredBackupPassword,
  onAutomaticBackupChange,
  onBrowseBackupFolder,
  onResetBackupFolder,
  onImportBackup,
  onExportBackup,
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
          onToast(
            `Automatic backup enabled. Files will be stored in:\n${result.effectiveFolderPath}`,
          );
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

  async function openRepository() {
    const opened = await window.winotp?.openExternal("https://github.com/xBounceIT/WinOTP-Reborn");
    if (!opened) {
      onToast("Repository link is available once the Electron shell is running.");
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
              onCheckedChange={(checked) => onChange("pinProtection", checked)}
            />
            <ToggleRow
              label="Protect app with password"
              checked={settings.passwordProtection}
              onCheckedChange={(checked) => onChange("passwordProtection", checked)}
            />
            <ToggleRow
              label="Protect app with Windows Hello"
              checked={settings.windowsHello}
              onCheckedChange={(checked) => onChange("windowsHello", checked)}
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
                  onCheckedChange={(checked) => onChange("remotePin", checked)}
                />
                <ToggleRow
                  label="Require password over Remote Desktop"
                  checked={settings.remotePassword}
                  onCheckedChange={(checked) => onChange("remotePassword", checked)}
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
              <Button variant="outline" size="sm" onClick={onLock}>
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
              hint="Automatically launch the app in the background when you sign in to Windows."
              checked={settings.autoStart}
              onCheckedChange={(checked) => onChange("autoStart", checked)}
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
            <div className="settings-card__title-row">
              <CardTitle className="settings-card__title">Check for updates</CardTitle>
              <Badge variant="default">Electron preview</Badge>
            </div>
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
              <span className="settings-row__value">2.0.0</span>
            </div>
            <div className="settings-row">
              <span>Status</span>
              <span className="settings-row__value">Ready to connect</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToast("Update service bridge is ready to connect.")}
            >
              <Check size={14} />
              Check now
            </Button>
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
    </div>
  );
}
