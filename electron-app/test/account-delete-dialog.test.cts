const { test } = require("node:test");
const { rendererTestOptions, runRendererTest } = require("./renderer-test.cjs");

test(
  "account deletion requires confirmation, restores focus on cancel and clears the request on lock",
  rendererTestOptions,
  () =>
    runRendererTest(
      `
    import { defaultSettings } from "@/lib/types";

    const accounts = ["Personal", "Work"].map((issuer) => ({
      id: issuer.toLowerCase(), issuer, accountName: "user@example.com",
      secret: "", algorithm: "SHA1", digits: 6, period: 30,
      createdAt: "2026-08-05T00:00:00.000Z", usageCount: 0,
    }));
    const status = { pinSet: true, passwordSet: false, remotePinSet: false, remotePasswordSet: false };
    window.deletedAccounts = [];
    window.winotp = {
      settings: { get: async () => ({
        success: true, settings: { ...defaultSettings, autoLock: "0", pinProtection: true, webBridgeNoticeDismissed: true },
        persistable: false,
      }) },
      security: {
        getStatus: async () => ({ success: true, ...status }),
        getWindowsHelloAvailability: async () => ({ success: true, status: "unavailable" }),
        verifyCredential: async (kind, value) => ({
          success: true, credentialAvailable: true, verified: kind === "pin" && value === "1234",
        }),
      },
      accounts: {
        list: async () => ({ accounts, issues: [], migration: { status: "completed" } }),
        delete: async (id) => {
          window.deletedAccounts.push(id);
          return { success: true };
        },
      },
      core: {
        sortAccounts: async ({ accounts }) => accounts,
        reconcileProtection: async () => ({
          pinEnabled: true, passwordEnabled: false,
          remotePinEnabled: false, remotePasswordEnabled: false, windowsHelloEnabled: false,
          presentation: { shouldShowLockScreen: true },
        }),
      },
      totp: { previews: async (ids) => ids.map(() => ({
        code: "123456", nextCode: "141414", remainingSeconds: 30,
      })) },
      onSessionChanged: (listener) => {
        window.lockSession = () => listener({ reason: "lock-screen" });
        return () => {};
      },
      onTrayUsageRecorded: () => () => {},
      setTrayState: () => {},
      setTitleBarTheme: () => {},
    };

    await import("@/main");
  `,
      async (waitFor) => {
        const testWindow = window as unknown as {
          deletedAccounts: string[];
          lockSession: () => void;
        };
        const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
        const workDelete = () =>
          document.querySelector<HTMLButtonElement>('button[aria-label="Delete Work"]');
        const button = (root: ParentNode, label: string) =>
          Array.from(root.querySelectorAll("button")).find(
            (item) => item.textContent?.trim() === label,
          );

        async function unlock() {
          const lockScreen = () => document.querySelector<HTMLDialogElement>("dialog[open]");
          await waitFor(
            () => lockScreen()?.textContent?.includes("WinOTP is locked"),
            "App did not lock",
          );
          const input = lockScreen()?.querySelector("input");
          const unlockButton = button(lockScreen(), "Unlock");
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
            input,
            "1234",
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
          unlockButton.click();
          await waitFor(workDelete, "Account list did not become available after unlocking");
        }

        async function openConfirmation() {
          workDelete().click();
          await waitFor(dialog, "Deletion did not open an in-app confirmation");
          const title = document.getElementById(dialog().getAttribute("aria-labelledby") ?? "");
          if (!title?.textContent?.trim() || !dialog().textContent?.includes("Work")) {
            throw new Error(
              "Deletion confirmation needs an accessible title and must identify the account",
            );
          }
          if (testWindow.deletedAccounts.length !== 0)
            throw new Error("Deleted before confirmation");
        }

        await unlock();
        await openConfirmation();
        button(dialog(), "Cancel").click();
        await waitFor(
          () => !dialog() && document.activeElement === workDelete(),
          "Cancel did not restore focus to the invoking account button",
        );

        await openConfirmation();
        testWindow.lockSession();
        await waitFor(() => !dialog(), "The deletion prompt survived a session lock");
        await unlock();
        if (dialog()) throw new Error("A stale deletion prompt reopened after unlocking");

        await openConfirmation();
        button(dialog(), "Delete").click();
        await waitFor(() => !workDelete(), "The confirmed account remained in the account list");
        if (
          testWindow.deletedAccounts.join(",") !== "work" ||
          !document.querySelector('button[aria-label="Delete Personal"]')
        ) {
          throw new Error("Confirmation must delete only the selected account");
        }
      },
    ),
);
