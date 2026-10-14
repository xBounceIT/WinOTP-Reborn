import { FileArchive, FileCode2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AccountImportFormatError,
  MAX_IMPORT_FILE_SIZE_BYTES,
  parseLegacyWinOtpJson,
  parseWinAuthText,
} from "@/lib/account-import";
import type { AccountImportResult, BrowserQrReview, OtpAccount } from "@/lib/types";

export function BrowserQrReviewDialog({
  review,
  onConfirm,
  onCancel,
}: {
  review: BrowserQrReview;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function act(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    try {
      await operation();
    } catch {
      setError("Unable to complete the import request. Try again.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Review QR import</AlertDialogTitle>
          <AlertDialogDescription>
            Sent by WinOTP Reborn WebBridge. Confirm to save this account on this device.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-2 break-all">
          <div>
            <dt>Issuer</dt>
            <dd>{review.issuer || "—"}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>{review.accountName || "—"}</dd>
          </div>
          <div>
            <dt>One-time code</dt>
            <dd>
              {review.algorithm}, {review.digits} digits, {review.period} seconds
            </dd>
          </div>
        </dl>
        {review.queuedCount > 1 && (
          <p>{review.queuedCount - 1} more QR imports waiting for review.</p>
        )}
        {(review.error || error) && <p role="alert">{review.error || error}</p>}
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={working || review.saving}
            onClick={() => void act(onCancel)}
          >
            Cancel
          </Button>
          <Button disabled={working || review.saving} onClick={() => void act(onConfirm)}>
            {working || review.saving ? "Please wait…" : "Confirm import"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ImportPageProps {
  onToast: (message: string) => void;
  onImport: (accounts: OtpAccount[]) => Promise<AccountImportResult>;
}

type ImportSource = "legacy" | "winauth";

function formatImportSummary(result: AccountImportResult, skippedCount: number) {
  const details = [`${result.importedCount} imported`];
  if (skippedCount > 0) {
    details.push(`${skippedCount} skipped`);
  }
  if (result.failedCount > 0) {
    details.push(`${result.failedCount} failed`);
  }

  const automaticBackupMessage = result.automaticBackupFailed
    ? " Automatic backup failed for one or more imported accounts."
    : "";
  return `Import completed: ${details.join(", ")}.${automaticBackupMessage}`;
}

export function ImportPage({ onToast, onImport }: ImportPageProps) {
  const legacyInput = useRef<HTMLInputElement>(null);
  const winAuthInput = useRef<HTMLInputElement>(null);
  const busySourceRef = useRef<ImportSource | undefined>(undefined);
  const [busySource, setBusySource] = useState<ImportSource>();

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>, source: ImportSource) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      onToast("The selected import file is too large. The maximum size is 32 MiB.");
      return;
    }

    if (busySourceRef.current) {
      return;
    }

    busySourceRef.current = source;
    setBusySource(source);
    try {
      const content = await file.text();
      const parsed =
        source === "legacy"
          ? await parseLegacyWinOtpJson(content)
          : await parseWinAuthText(content);

      if (parsed.accounts.length === 0 && parsed.skippedCount === 0) {
        onToast(
          source === "legacy"
            ? "No accounts found in the selected WinOTP backup."
            : "The selected WinAuth file is empty.",
        );
        return;
      }

      const result =
        parsed.accounts.length > 0
          ? await onImport(parsed.accounts)
          : { importedCount: 0, failedCount: 0, automaticBackupFailed: false };
      onToast(formatImportSummary(result, parsed.skippedCount));
    } catch (error) {
      onToast(
        error instanceof AccountImportFormatError
          ? error.message
          : "Failed to read the selected import file.",
      );
    } finally {
      busySourceRef.current = undefined;
      setBusySource(undefined);
    }
  }

  const isBusy = busySource !== undefined;

  return (
    <div className="page-scroll">
      <div className="page-shell">
        <h1 className="page-title">Import Accounts</h1>
        <div className="choice-list">
          <Button
            type="button"
            variant="outline"
            className="choice-card"
            disabled={isBusy}
            onClick={() => legacyInput.current?.click()}
          >
            <span className="choice-card__icon">
              <FileArchive size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import from WinOTP (old)</span>
              <span className="choice-card__detail">
                {busySource === "legacy"
                  ? "Reading and importing backup…"
                  : "Import tokens from legacy WinOTP JSON backup file"}
              </span>
            </span>
          </Button>
          <input
            ref={legacyInput}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="Select a legacy WinOTP backup"
            onChange={(event) => handleFile(event, "legacy")}
          />

          <Button
            type="button"
            variant="outline"
            className="choice-card"
            disabled={isBusy}
            onClick={() => winAuthInput.current?.click()}
          >
            <span className="choice-card__icon">
              <FileCode2 size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import from WinAuth</span>
              <span className="choice-card__detail">
                {busySource === "winauth"
                  ? "Reading and importing export…"
                  : "Import tokens from WinAuth exported text file"}
              </span>
            </span>
          </Button>
          <input
            ref={winAuthInput}
            className="sr-only"
            type="file"
            accept=".txt,text/plain"
            aria-label="Select a WinAuth export"
            onChange={(event) => handleFile(event, "winauth")}
          />
        </div>
      </div>
    </div>
  );
}
