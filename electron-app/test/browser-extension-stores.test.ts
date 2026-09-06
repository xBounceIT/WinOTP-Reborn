import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_EXTENSION_STORES,
  openExternalSafely,
} from "../src/lib/browser-extension-stores.ts";

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
