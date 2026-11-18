const { test } = require("node:test");
const { rendererTestOptions, runRendererTest } = require("./renderer-test.cjs");

test(
  "QR review fits the desktop window and waits for explicit asynchronous confirmation",
  rendererTestOptions,
  () =>
    runRendererTest(
      `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserQrReviewDialog } from "@/pages/ImportPage";
import "@/index.css";
const root = createRoot(document.getElementById("root"));
window.confirmations = 0;
root.render(createElement(BrowserQrReviewDialog, {
  review: { id: "review", issuer: "Issuer".repeat(650), accountName: "Account".repeat(550),
    algorithm: "SHA1", digits: 6, period: 30, saving: false, queuedCount: 1 },
  onConfirm: () => { window.confirmations++; return new Promise(resolve => { window.finishSave = resolve; }); },
  onCancel: async () => root.unmount(),
}));
  `,
      async (waitFor) => {
        const testWindow = window as unknown as { confirmations: number; finishSave: () => void };
        await waitFor(() => document.querySelector('[role="alertdialog"]'), "Review did not mount");
        const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
        // Wait for the opening transition before measuring the fixed-size desktop viewport.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const rect = dialog.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > innerHeight)
          throw new Error(
            "Review exceeds viewport: " +
              JSON.stringify({ top: rect.top, bottom: rect.bottom, height: innerHeight }),
          );
        if (testWindow.confirmations !== 0) throw new Error("Imported without confirmation");
        const confirm = Array.from(dialog.querySelectorAll("button")).find(
          (button) => button.textContent === "Confirm import",
        );
        confirm.scrollIntoView({ block: "center" });
        const buttonRect = confirm.getBoundingClientRect();
        if (buttonRect.top < 0 || buttonRect.bottom > innerHeight)
          throw new Error("Confirmation is unreachable");
        confirm.click();
        confirm.click();
        await waitFor(
          () => testWindow.confirmations > 0 && confirm.disabled,
          "Confirmation did not start",
        );
        if (Number(testWindow.confirmations) !== 1)
          throw new Error("Confirmation is not serialized");
        testWindow.finishSave();
        await waitFor(() => !confirm.disabled, "Confirmation did not finish");
        const cancel = Array.from(dialog.querySelectorAll("button")).find(
          (button) => button.textContent === "Cancel",
        );
        cancel.scrollIntoView({ block: "center" });
        cancel.click();
        await waitFor(
          () => !document.querySelector('[role="alertdialog"]'),
          "Cancellation did not clear review",
        );
      },
    ),
);
