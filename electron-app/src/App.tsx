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
import { demoAccounts } from "@/lib/demo-data";
import { useTotp } from "@/lib/use-totp";
import type { AppSettings, OtpAccount, Route } from "@/lib/types";
import { defaultSettings } from "@/lib/types";

const accountsStorageKey = "winotp-electron.accounts";
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

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [accounts, setAccounts] = useState<OtpAccount[]>(() =>
    readStorage(accountsStorageKey, demoAccounts),
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    readStorage(settingsStorageKey, defaultSettings),
  );
  const [editingAccount, setEditingAccount] = useState<OtpAccount>();
  const [toast, setToast] = useState("");
  const [locked, setLocked] = useState(false);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const { accountTiming, codes } = useTotp(accounts);

  useEffect(() => {
    window.localStorage.setItem(accountsStorageKey, JSON.stringify(accounts));
  }, [accounts]);

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

  function saveAccount(account: OtpAccount) {
    setAccounts((current) => {
      const existing = current.some((item) => item.id === account.id);
      return existing
        ? current.map((item) => (item.id === account.id ? account : item))
        : [...current, account];
    });
    setEditingAccount(undefined);
    setRoute("home");
    showToast(editingAccount ? "Account updated" : "Account added");
  }

  async function copyCode(account: OtpAccount, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setAccounts((current) =>
        current.map((item) =>
          item.id === account.id ? { ...item, usageCount: (item.usageCount ?? 0) + 1 } : item,
        ),
      );
      showToast(`${account.issuer || account.accountName} code copied`);
    } catch {
      showToast("Clipboard access is unavailable in this preview");
    }
  }

  function deleteAccount(account: OtpAccount) {
    const label = account.issuer || account.accountName;
    if (window.confirm(`Are you sure you want to delete '${label}'?`)) {
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      showToast(`${label} removed`);
    }
  }

  function changeSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
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
