import assert from "node:assert/strict";
import { test } from "node:test";

import {
  directCredentialKind,
  emptySecurityStatus,
  isSecurityNormalizationReady,
  normalizeSecuritySettings,
  remoteCredentialKind,
  securityVerificationFromResult,
  settingForCredential,
  securityStatusKey,
} from "../src/lib/security-settings.ts";
import { defaultSettings } from "../src/lib/types.ts";

test("clears protection settings that have no usable credential", () => {
  const settings = {
    ...defaultSettings,
    pinProtection: true,
    passwordProtection: true,
    windowsHello: true,
    remotePin: true,
    remotePassword: true,
  };

  assert.deepEqual(normalizeSecuritySettings(settings, emptySecurityStatus), {
    ...defaultSettings,
    pinProtection: false,
    passwordProtection: false,
    windowsHello: true,
    remotePin: false,
    remotePassword: false,
  });
});

test("does not normalize protection settings while secure storage is unavailable", () => {
  assert.equal(isSecurityNormalizationReady(true, true, false), false);
  assert.equal(isSecurityNormalizationReady(true, false, true), false);
  assert.equal(isSecurityNormalizationReady(false, true, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true), true);
});

test("keeps one direct and one remote protection method when credentials exist", () => {
  const status = {
    pinSet: true,
    passwordSet: true,
    remotePinSet: true,
    remotePasswordSet: true,
  };
  const settings = {
    ...defaultSettings,
    pinProtection: true,
    passwordProtection: true,
    windowsHello: true,
    remotePin: true,
    remotePassword: true,
  };

  const normalized = normalizeSecuritySettings(settings, status);
  assert.equal(normalized.pinProtection, true);
  assert.equal(normalized.passwordProtection, false);
  assert.equal(normalized.windowsHello, false);
  assert.equal(normalized.remotePin, true);
  assert.equal(normalized.remotePassword, false);
});

test("maps credential kinds to their persisted status fields", () => {
  assert.equal(securityStatusKey("pin"), "pinSet");
  assert.equal(securityStatusKey("password"), "passwordSet");
  assert.equal(securityStatusKey("remotePin"), "remotePinSet");
  assert.equal(securityStatusKey("remotePassword"), "remotePasswordSet");
  assert.equal(settingForCredential("pin"), "pinProtection");
  assert.equal(settingForCredential("password"), "passwordProtection");
  assert.equal(settingForCredential("remotePin"), "remotePin");
  assert.equal(settingForCredential("remotePassword"), "remotePassword");
  assert.equal(directCredentialKind({ ...defaultSettings, pinProtection: true }), "pin");
  assert.equal(directCredentialKind({ ...defaultSettings, passwordProtection: true }), "password");
  assert.equal(directCredentialKind(defaultSettings), undefined);
  assert.equal(remoteCredentialKind({ ...defaultSettings, remotePin: true }), "remotePin");
  assert.equal(
    remoteCredentialKind({ ...defaultSettings, remotePassword: true }),
    "remotePassword",
  );
  assert.equal(remoteCredentialKind(defaultSettings), undefined);
});

test("distinguishes a missing credential from a secure storage failure", () => {
  assert.deepEqual(
    securityVerificationFromResult({
      success: true,
      verified: false,
      credentialAvailable: false,
    }),
    { verified: false, available: false },
  );
  assert.deepEqual(
    securityVerificationFromResult({ success: false, message: "Storage is unavailable." }),
    {
      verified: false,
      available: false,
      error: "Storage is unavailable.",
    },
  );
  assert.deepEqual(securityVerificationFromResult(undefined), {
    verified: false,
    available: false,
    error: "The secure storage bridge is unavailable.",
  });
});
