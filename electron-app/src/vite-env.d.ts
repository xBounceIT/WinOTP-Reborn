/// <reference types="vite/client" />

import type {
  AccountDeleteResult,
  AccountLoadResult,
  AccountSaveResult,
  AccountUsageResult,
  OtpAccount,
} from "@/lib/types";

declare global {
  interface Window {
    winotp?: {
      openExternal: (url: string) => Promise<boolean>;
      setTitleBarTheme: (theme: { color: string; symbolColor: string }) => void;
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
