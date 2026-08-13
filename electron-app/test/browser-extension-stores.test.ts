import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_EXTENSION_STORES,
  openExternalSafely,
} from "../src/lib/browser-extension-stores.ts";

test("keeps the public browser extension store contract", () => {
  assert.deepEqual(BROWSER_EXTENSION_STORES, [
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
  ]);

  for (const store of BROWSER_EXTENSION_STORES) {
    const target = new URL(store.url);
    assert.equal(target.protocol, "https:");
    assert.equal(target.username, "");
    assert.equal(target.password, "");
  }
});

test("opens external links safely across success and IPC failures", async () => {
  const openedUrls: string[] = [];
  const openExternal = async (url: string) => {
    openedUrls.push(url);
    return true;
  };

  assert.equal(await openExternalSafely(openExternal, BROWSER_EXTENSION_STORES[0].url), true);
  assert.deepEqual(openedUrls, [BROWSER_EXTENSION_STORES[0].url]);
  assert.equal(await openExternalSafely(async () => false, BROWSER_EXTENSION_STORES[1].url), false);
  assert.equal(await openExternalSafely(undefined, BROWSER_EXTENSION_STORES[1].url), false);
  assert.equal(
    await openExternalSafely(async () => {
      throw new Error("IPC unavailable");
    }, BROWSER_EXTENSION_STORES[1].url),
    false,
  );
});
