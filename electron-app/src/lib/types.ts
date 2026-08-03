export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type SortOption =
  | "DateAddedDesc"
  | "DateAddedAsc"
  | "AlphabeticalAsc"
  | "AlphabeticalDesc"
  | "CustomOrder"
  | "UsageBased";

export type Route = "home" | "add" | "import" | "manual" | "settings";

export interface OtpAccount {
  id: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: 6 | 8;
  period: number;
  createdAt: string;
  usageCount?: number;
}

export interface AppSettings {
  showNextCode: boolean;
  pinProtection: boolean;
  passwordProtection: boolean;
  windowsHello: boolean;
  remotePin: boolean;
  remotePassword: boolean;
  autoLock: string;
  autoStart: boolean;
  minimizeOnClose: boolean;
  minimizeToTray: boolean;
  showTotpInTray: boolean;
  automaticBackup: boolean;
  updateOnStartup: boolean;
  updateChannel: "Stable" | "Pre-release";
  theme: "dark" | "light";
}

export const defaultSettings: AppSettings = {
  showNextCode: false,
  pinProtection: false,
  passwordProtection: false,
  windowsHello: false,
  remotePin: false,
  remotePassword: false,
  autoLock: "5",
  autoStart: false,
  minimizeOnClose: false,
  minimizeToTray: false,
  showTotpInTray: false,
  automaticBackup: false,
  updateOnStartup: true,
  updateChannel: "Stable",
  theme: "dark",
};
