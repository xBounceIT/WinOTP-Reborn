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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/lib/types";

interface SettingsPageProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onToast: (message: string) => void;
  onLock: () => void;
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ label, hint, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="settings-control">
      <div className="settings-control__copy">
        <span className="settings-control__label">{label}</span>
        {hint && <span className="settings-control__hint">{hint}</span>}
      </div>
      <div className="settings-control__switch">
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  );
}

export function SettingsPage({ settings, onChange, onToast, onLock }: SettingsPageProps) {
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
              onCheckedChange={(checked) => onChange("automaticBackup", checked)}
            />
            <p className="settings-card__description">
              Default folder: %LocalAppData%\WinOTP_Reborn\Backups
            </p>
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToast("Folder picker bridge is ready to connect.")}
              >
                <FolderOpen size={14} />
                Browse
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToast("Backup folder reset to default.")}
              >
                <RotateCcw size={14} />
                Reset to default
              </Button>
            </div>
            <div className="settings-buttons">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToast("Backup import bridge is ready to connect.")}
              >
                <Archive size={14} />
                Import backup
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onToast("Backup export bridge is ready to connect.")}
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
    </div>
  );
}
