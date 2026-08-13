export const BROWSER_EXTENSION_STORES = [
  {
    browser: "Chrome",
    label: "Add to Chrome",
    url: "https://chromewebstore.google.com/detail/gomcpjbgmfdggpnbplajohjkjbbjijln",
  },
  {
    browser: "Firefox",
    label: "Add to Firefox",
    url: "https://addons.mozilla.org/firefox/addon/winotp-reborn/",
  },
] as const;

export const [CHROME_EXTENSION_STORE, FIREFOX_EXTENSION_STORE] = BROWSER_EXTENSION_STORES;

export type BrowserExtensionStore = (typeof BROWSER_EXTENSION_STORES)[number];

export async function openExternalSafely(
  openExternal: ((url: string) => Promise<boolean>) | undefined,
  url: string,
): Promise<boolean> {
  if (!openExternal) {
    return false;
  }

  try {
    return (await openExternal(url)) === true;
  } catch {
    return false;
  }
}
