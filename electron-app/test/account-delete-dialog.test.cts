const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf8");
const alertDialogSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/alert-dialog.tsx"),
  "utf8",
);
const buttonSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/button.tsx"),
  "utf8",
);
const accountCardSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/AccountCard.tsx"),
  "utf8",
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} should be present`);
  assert.notEqual(endIndex, -1, `${end} should be present after ${start}`);
  return source.slice(startIndex, endIndex);
}

test("account deletion uses the in-app shadcn confirmation dialog", () => {
  assert.doesNotMatch(appSource, /window\.confirm\s*\(/);
  assert.match(appSource, /onDelete=\{requestAccountDeletion\}/);
  assert.match(appSource, /open=\{Boolean\(accountPendingDeletion\)\}/);
  assert.match(appSource, /<AlertDialogTitle>Delete account\?<\/AlertDialogTitle>/);
  assert.match(appSource, /<AlertDialogAction[\s\S]*?void deleteAccount\(accountPendingDeletion\)/);
  assert.match(appSource, /<AlertDialogAction\s+variant="destructive"/);
});

test("closing the dialog restores focus to its invoking delete button", () => {
  const requestSource = sourceBetween(
    appSource,
    "function requestAccountDeletion(account: OtpAccount, trigger: HTMLButtonElement)",
    "function changeSetting",
  );

  assert.match(requestSource, /accountDeletionTriggerRef\.current = trigger/);
  assert.match(accountCardSource, /onDelete\(account, event\.currentTarget\)/);
  assert.doesNotMatch(requestSource, /document\.activeElement/);
  assert.match(appSource, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(appSource, /!lockedRef\.current && trigger\?\.isConnected/);
  assert.match(appSource, /trigger\.focus\(\)/);
});

test("the shared alert dialog is backed by Radix and exposes destructive styling", () => {
  assert.match(alertDialogSource, /AlertDialog as AlertDialogPrimitive.*from "radix-ui"/);
  assert.match(alertDialogSource, /data-slot="alert-dialog-overlay"/);
  assert.match(alertDialogSource, /data-slot="alert-dialog-content"/);
  assert.match(alertDialogSource, /buttonVariants\(\{ variant \}\)/);
  assert.match(buttonSource, /bg-destructive text-destructive-foreground/);
  assert.doesNotMatch(buttonSource, /bg-destructive text-white/);
});

test("locking the app dismisses a pending account deletion", () => {
  const lockSource = sourceBetween(
    appSource,
    "function setAppLocked(nextLocked: boolean)",
    "function updateAccountUsage",
  );
  const lockedBranch = sourceBetween(lockSource, "if (nextLocked)", "setLocked(nextLocked)");

  assert.match(lockedBranch, /setAccountPendingDeletion\(undefined\)/);
});
