import assert from "node:assert/strict";
import test from "node:test";

import { getUpdateInstallToast } from "../src/lib/update-result.ts";

const state = {} as never;

test("preserves platform-specific update installation guidance", () => {
  assert.equal(
    getUpdateInstallToast({ success: true, state, message: "Replace the downloaded AppImage." }),
    "Replace the downloaded AppImage.",
  );
  assert.equal(
    getUpdateInstallToast({ success: true, state }),
    "The update installer was launched.",
  );
  assert.equal(
    getUpdateInstallToast({ success: false, state, message: "Permission denied." }),
    "Permission denied.",
  );
  assert.equal(
    getUpdateInstallToast({ success: false, state }),
    "Unable to launch the update installer.",
  );
});
