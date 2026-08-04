/// <reference types="vite/client" />

import type {
  AccountDeleteResult,
  AccountLoadResult,
  AccountSaveResult,
  AccountUsageResult,
  OtpAccount,
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

  type ScreenCaptureResult =
    | { status: "success"; text: string }
    | { status: "cancelled" | "no-qr-code" | "failed" };

  interface Window {
    winotp?: {
      openExternal: (url: string) => Promise<boolean>;
      setTitleBarTheme: (theme: { color: string; symbolColor: string }) => void;
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
    };
  }
}

export {};
