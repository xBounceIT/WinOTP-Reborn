import { useLayoutEffect, useRef } from "react";

function openModalDialog(dialog: HTMLDialogElement) {
  if (dialog.open) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeModalDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) {
    return;
  }

  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

export function useModalDialog(enabled = true) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    openModalDialog(dialog);
    return () => closeModalDialog(dialog);
  }, [enabled]);

  return dialogRef;
}
