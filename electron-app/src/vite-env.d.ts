/// <reference types="vite/client" />

interface Window {
  winotp?: {
    openExternal: (url: string) => Promise<boolean>;
    setTitleBarTheme: (theme: { color: string; symbolColor: string }) => void;
  };
}
