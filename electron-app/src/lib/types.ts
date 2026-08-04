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

export interface AccountStorageIssue {
  code: string;
  accountId: string;
  message: string;
}

export interface MigrationStatus {
  status: "pending" | "completed" | "failed";
  importedCount: number;
  skippedCount: number;
  issueCount: number;
  message?: string;
  justCompleted?: boolean;
}

export interface AccountLoadResult {
  accounts: OtpAccount[];
  issues: AccountStorageIssue[];
  migration: MigrationStatus;
  databasePath?: string;
}

export interface AccountSaveResult {
  success: boolean;
  account?: OtpAccount;
  message?: string;
  automaticBackup?: BackupOperationResult;
}

export interface AccountDeleteResult {
  success: boolean;
  message?: string;
  automaticBackup?: BackupOperationResult;
}

export interface AccountUsageResult {
  success: boolean;
  usageCount?: number;
  message?: string;
}

export interface BackupOperationResult {
  success: boolean;
  errorCode?: string;
  message?: string;
  cancelled?: boolean;
  skipped?: boolean;
  filePath?: string;
  accountCount?: number;
  automaticBackup?: BackupOperationResult;
}

export interface BackupStatus {
  automaticEnabled: boolean;
  customFolderPath: string;
  defaultFolderPath: string;
  effectiveFolderPath: string;
  hasStoredPassword: boolean;
}

export interface BackupConfigurationResult extends BackupStatus, BackupOperationResult {
  success: boolean;
}

export interface BackupImportResult extends BackupOperationResult {
  importedCount?: number;
  replacedCount?: number;
  skippedCount?: number;
  failedCount?: number;
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
  customBackupFolderPath: string;
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
  customBackupFolderPath: "",
  updateOnStartup: true,
  updateChannel: "Stable",
  theme: "dark",
};
