import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canApplyProtectionReconciliation,
  directCredentialKind,
  hasConfiguredProtection,
  isSecurityNormalizationReady,
  remoteCredentialKind,
  remoteSessionDetectedAfterChange,
  securityVerificationFromResult,
  settingForCredential,
  securityStatusKey,
  shouldActivateRemoteFallback,
  shouldReleaseFailedLock,
  shouldShowStartupLoading,
  windowsHelloAvailabilityOverrideForRemoteSession,
} from "../src/lib/security-settings.ts";
import { defaultSettings } from "../src/lib/types.ts";

test("normalizes protection settings only after security and startup are ready", () => {
  assert.equal(isSecurityNormalizationReady(true, true, false, false, true), false);
  assert.equal(isSecurityNormalizationReady(true, false, true, false, true), false);
  assert.equal(isSecurityNormalizationReady(false, true, true, false, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true, true, true), false);
  assert.equal(isSecurityNormalizationReady(true, true, true, false, false), false);
  assert.equal(isSecurityNormalizationReady(true, true, true, false, true), true);
});

test("keeps the loading screen visible until startup protection is resolved", () => {
  assert.equal(shouldShowStartupLoading(true, false, false), true);
  assert.equal(shouldShowStartupLoading(true, false, true), false);
  assert.equal(shouldShowStartupLoading(true, true, false), false);
  assert.equal(shouldShowStartupLoading(false, false, false), false);
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

test("treats a detected Remote Desktop connection as authoritative during the transition", () => {
  const settings = {
    ...defaultSettings,
    windowsHello: true,
    remotePin: true,
  };
  const status = {
    pinSet: false,
    passwordSet: false,
    remotePinSet: true,
    remotePasswordSet: false,
  };

  let remoteSessionDetected = remoteSessionDetectedAfterChange(false, "remote-connect");
  assert.equal(remoteSessionDetected, true);
  for (const reason of [
    "lock-screen",
    "unlock-screen",
    "suspend",
    "resume",
    "console-disconnect",
  ] as const) {
    remoteSessionDetected = remoteSessionDetectedAfterChange(remoteSessionDetected, reason);
    assert.equal(remoteSessionDetected, true, `${reason} must preserve the detected RDP session`);
  }
  assert.equal(
    windowsHelloAvailabilityOverrideForRemoteSession(remoteSessionDetected),
    "remote-session",
  );
  assert.equal(shouldActivateRemoteFallback(remoteSessionDetected, settings, status), true);
  assert.equal(
    shouldActivateRemoteFallback(remoteSessionDetected, settings, {
      ...status,
      remotePinSet: false,
    }),
    false,
  );

  remoteSessionDetected = remoteSessionDetectedAfterChange(
    remoteSessionDetected,
    "remote-disconnect",
  );
  assert.equal(remoteSessionDetected, false);
  assert.equal(windowsHelloAvailabilityOverrideForRemoteSession(remoteSessionDetected), undefined);
  assert.equal(shouldActivateRemoteFallback(remoteSessionDetected, settings, status), false);
  assert.equal(remoteSessionDetectedAfterChange(true, "console-connect"), false);
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
