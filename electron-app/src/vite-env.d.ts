/// <reference types="vite/client" />

import type {
  AccountDeleteResult,
  AccountBatchSaveResult,
  AccountLoadResult,
  AccountSaveResult,
  AccountUsageResult,
  AppSettings,
  AppSettingsResult,
  AutoStartResult,
  BackupConfigurationResult,
  BackupImportResult,
  BackupOperationResult,
  OtpAccount,
  ParsedAccountImport,
  ProtectionCoreInput,
  ProtectionViewState,
  SortOption,
  SecurityCredentialKind,
  SecurityOperationResult,
  SecurityStatusResult,
  UpdateOperationResult,
  UpdateStatusResult,
  WindowsHelloAvailabilityResult,
  WindowsHelloVerificationResult,
  TrayState,
  TotpPreview,
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
    lastUsedAt?: string;
  }

  interface SessionChangePayload {
    reason:
      | "lock-screen"
      | "unlock-screen"
      | "suspend"
      | "resume"
      | "console-connect"
      | "console-disconnect"
      | "remote-connect"
      | "remote-disconnect";
  }

  type ScreenCaptureResult =
    | { status: "success"; text: string }
    | { status: "cancelled" | "no-qr-code" | "failed" };

  interface CoreSortInput {
    accounts: OtpAccount[];
    sortOption: SortOption;
    customOrderIds: string[];
  }

  interface CorePruneOrderInput {
    accounts: OtpAccount[];
    orderIds: string[];
  }

  interface CoreOrderDropInput {
    bounds: Array<{
      id: string;
      left: number;
      top: number;
      width: number;
      height: number;
      sourceIndex?: number;
    }>;
    x: number;
    y: number;
  }

  interface CoreOrderProjectInput {
    orderIds: string[];
    draggedId: string;
    insertionIndex: number;
  }

  interface CoreScreenCaptureMapInput {
    selectionX: number;
    selectionY: number;
    selectionWidth: number;
    selectionHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    imageWidth: number;
    imageHeight: number;
  }

  interface CoreScreenCaptureExpandInput {
    rect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
    padding: number;
  }

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
      onSessionChanged: (listener: (change: SessionChangePayload) => void) => () => void;
      captureScreen: () => Promise<ScreenCaptureResult>;
      onScreenCaptureReady: (listener: (capture: ScreenCapturePayload) => void) => () => void;
      completeScreenCapture: (result: ScreenCaptureResult) => void;
      core: {
        parseOtpUri: (uri: string) => Promise<OtpAccount | undefined>;
        parseWinAuthLine: (line: string) => Promise<OtpAccount | undefined>;
        parseLegacyJson: (content: string) => Promise<ParsedAccountImport>;
        parseWinAuthText: (content: string) => Promise<ParsedAccountImport>;
        sortAccounts: (input: CoreSortInput) => Promise<OtpAccount[]>;
        pruneCustomOrderIds: (input: CorePruneOrderInput) => Promise<string[]>;
        orderDropIndex: (input: CoreOrderDropInput) => Promise<number>;
        orderProject: (input: CoreOrderProjectInput) => Promise<string[]>;
        reconcileProtection: (input: ProtectionCoreInput) => Promise<ProtectionViewState>;
        screenCaptureMap: (input: CoreScreenCaptureMapInput) => Promise<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>;
        screenCaptureExpand: (input: CoreScreenCaptureExpandInput) => Promise<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>;
        screenCapturePadding: (input: {
          rect: { x: number; y: number; width: number; height: number };
        }) => Promise<number>;
      };
      totp: {
        previews: (ids: string[], timestamp?: number) => Promise<TotpPreview[]>;
      };
      settings: {
        get: () => Promise<AppSettingsResult>;
        save: (settings: AppSettings) => Promise<AppSettingsResult>;
      };
      accounts: {
        list: () => Promise<AccountLoadResult>;
        get: (id: string) => Promise<OtpAccount | undefined>;
        acknowledgeMigration: () => Promise<boolean>;
        save: (account: OtpAccount) => Promise<AccountSaveResult>;
        saveBatch: (accounts: OtpAccount[]) => Promise<AccountBatchSaveResult>;
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
      updates: {
        status: () => Promise<UpdateStatusResult>;
        check: (
          channel: AppSettings["updateChannel"],
          automaticCheckEnabled?: boolean,
        ) => Promise<UpdateOperationResult>;
        download: () => Promise<UpdateOperationResult>;
        install: () => Promise<UpdateOperationResult>;
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
