/// <reference types="vite/client" />

import type {
  AccountDeleteResult,
  AccountLoadResult,
  AccountSaveResult,
  AccountUsageResult,
  AutoStartResult,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  OtpAccount,
  SecurityCredentialKind,
  SecurityOperationResult,
  SecurityStatusResult,
  WindowsHelloAvailabilityResult,
  WindowsHelloVerificationResult,
  TrayState,
} from "@/lib/types";

declare global {
  interface ScreenCaptureDisplay {
    id: string;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    scaleFactor: number;
    displayIndex: number;
    displayCount: number;
    dataUrl: string;
  }

  interface ScreenCapturePayload {
    display: ScreenCaptureDisplay;
  }

  interface TrayUsagePayload {
    id: string;
    usageCount?: number;
  }

  type ScreenCaptureResult =
    | { status: "success"; text: string }
    | { status: "cancelled" | "no-qr-code" | "failed" };

  interface Window {
    winotp?: {
      openExternal: (url: string) => Promise<boolean>;
      setTitleBarTheme: (theme: { color: string; symbolColor: string }) => void;
      setTrayState: (state: TrayState) => void;
      autoStart: {
        status: () => Promise<AutoStartResult>;
        set: (enabled: boolean) => Promise<AutoStartResult>;
      };
      onTrayUsageRecorded: (listener: (usage: TrayUsagePayload) => void) => () => void;
      captureScreen: () => Promise<ScreenCaptureResult>;
      onScreenCaptureReady: (listener: (capture: ScreenCapturePayload) => void) => () => void;
      completeScreenCapture: (result: ScreenCaptureResult) => void;
      accounts: {
        list: () => Promise<AccountLoadResult>;
        acknowledgeMigration: () => Promise<boolean>;
        save: (account: OtpAccount) => Promise<AccountSaveResult>;
        delete: (id: string) => Promise<AccountDeleteResult>;
        recordUsage: (id: string) => Promise<AccountUsageResult>;
      };
      backup: {
        status: () => Promise<BackupConfigurationResult>;
        configure: (settings: {
          automaticEnabled: boolean;
          customFolderPath: string;
        }) => Promise<BackupConfigurationResult>;
        enableAutomatic: (
          password: string,
          customFolderPath?: string,
        ) => Promise<BackupConfigurationResult>;
        disableAutomatic: () => Promise<BackupConfigurationResult>;
        chooseFolder: () => Promise<BackupConfigurationResult>;
        resetFolder: () => Promise<BackupConfigurationResult>;
        import: (password: string) => Promise<BackupImportResult>;
        export: (passwordOverride?: string) => Promise<BackupOperationResult>;
      };
      security: {
        getStatus: () => Promise<SecurityStatusResult>;
        setCredential: (
          kind: SecurityCredentialKind,
          secret: string,
        ) => Promise<SecurityOperationResult>;
        verifyCredential: (
          kind: SecurityCredentialKind,
          secret: string,
        ) => Promise<SecurityOperationResult>;
        removeCredential: (kind: SecurityCredentialKind) => Promise<SecurityOperationResult>;
        getWindowsHelloAvailability: () => Promise<WindowsHelloAvailabilityResult>;
        verifyWindowsHello: () => Promise<WindowsHelloVerificationResult>;
      };
    };
  }
}

export {};
