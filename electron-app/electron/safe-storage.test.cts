const assert = require("node:assert/strict");
const { test } = require("node:test");

const { isSecureStorageAvailable } = require("./safe-storage.cjs");

test("rejects Linux basic_text safe storage", () => {
  const encryption = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
  };

  assert.equal(isSecureStorageAvailable(encryption, "linux"), false);
  assert.equal(isSecureStorageAvailable(encryption, "win32"), true);
});
