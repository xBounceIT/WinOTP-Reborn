import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canApplyProtectionReconciliation,
  directCredentialKind,
  hasConfiguredProtection,
  isSecurityNormalizationReady,
  remoteCredentialKind,
  securityVerificationFromResult,
  settingForCredential,
  securityStatusKey,
  shouldStartLocked,
  shouldReleaseFailedLock,
} from "../src/lib/security-settings.ts";
import { defaultSettings } from "../src/lib/types.ts";

test("does not normalize protection settings while secure storage is unavailable", () => {
  assert.equal(isSecurityNormalizationReady(true, true, false), false);
  assert.equal(isSecurityNormalizationReady(true, false, true), false);
  assert.equal(isSecurityNormalizationReady(false, true, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true), true);
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
  assert.equal(hasConfiguredProtection(defaultSettings), false);
  assert.equal(hasConfiguredProtection({ ...defaultSettings, windowsHello: true }), true);
});

test("stays locked until authoritative protection settings are loaded", () => {
  assert.equal(shouldStartLocked(defaultSettings), true);
  assert.equal(shouldStartLocked(defaultSettings, true), false);
  assert.equal(shouldStartLocked({ ...defaultSettings, pinProtection: true }, true), true);
  assert.equal(shouldStartLocked({ ...defaultSettings, passwordProtection: true }, true), true);
  assert.equal(shouldStartLocked({ ...defaultSettings, windowsHello: true }, true), true);
});

test("only applies protection reconciliation for the state it started with", () => {
  const status = {
    pinSet: false,
    passwordSet: false,
    remotePinSet: false,
    remotePasswordSet: false,
  };
  const settings = { ...defaultSettings };
  assert.equal(canApplyProtectionReconciliation(settings, status, settings, status), true);
  assert.equal(canApplyProtectionReconciliation(settings, status, { ...settings }, status), false);
  assert.equal(canApplyProtectionReconciliation(settings, status, settings, { ...status }), false);
});

test("does not release a previously locked session after a failed recheck", () => {
  assert.equal(shouldReleaseFailedLock(false, true), false);
  assert.equal(shouldReleaseFailedLock(true, true), true);
  assert.equal(shouldReleaseFailedLock(false, false), true);
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
