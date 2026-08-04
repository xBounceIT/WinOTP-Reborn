export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type SortOption =
  | "DateAddedDesc"
  | "DateAddedAsc"
  | "AlphabeticalAsc"
  | "AlphabeticalDesc"
  | "CustomOrder"
  | "UsageBased";

export type Route = "home" | "add" | "import" | "manual" | "settings";

export type SecurityCredentialKind = "pin" | "password" | "remotePin" | "remotePassword";

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

export interface AccountImportResult {
  importedCount: number;
  failedCount: number;
  automaticBackupFailed: boolean;
}

export interface TrayAccount {
  id: string;
  label: string;
  code: string;
}

export interface TrayState {
  minimizeOnClose: boolean;
  minimizeToTray: boolean;
  showTotpInTray: boolean;
  locked: boolean;
  accounts: TrayAccount[];
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
  accountSortOption: SortOption;
  accountCustomOrderIds: string[];
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

export interface AutoStartResult {
  success: boolean;
  enabled: boolean;
  message?: string;
}

export interface SecurityCredentialStatus {
  pinSet: boolean;
  passwordSet: boolean;
  remotePinSet: boolean;
  remotePasswordSet: boolean;
}

export type SecurityStatusResult =
  | (SecurityCredentialStatus & { success: true })
  | { success: false; message?: string };

export interface SecurityOperationResult {
  success: boolean;
  verified?: boolean;
  credentialAvailable?: boolean;
  message?: string;
}

export interface SecurityVerification {
  verified: boolean;
  available: boolean;
  error?: string;
}

export type WindowsHelloAvailabilityStatus =
  | "available"
  | "unavailable"
  | "remote-session"
  | "error";

export type WindowsHelloVerificationStatus =
  | "verified"
  | "unavailable"
  | "remote-session"
  | "canceled"
  | "failed"
  | "error";

export type WindowsHelloAvailabilityResult =
  | { success: true; status: WindowsHelloAvailabilityStatus }
  | { success: false; message?: string };

export type WindowsHelloVerificationResult =
  | { success: true; status: WindowsHelloVerificationStatus }
  | { success: false; message?: string };

export const defaultSettings: AppSettings = {
  accountSortOption: "DateAddedDesc",
  accountCustomOrderIds: [],
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
