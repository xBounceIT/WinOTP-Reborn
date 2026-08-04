import { FileKey2, FileText, GalleryVerticalEnd, PencilLine } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { parseOtpUri } from "@/lib/otp-uri";
import type { OtpAccount, Route } from "@/lib/types";

interface AddAccountPageProps {
  onNavigate: (route: Route) => void;
  onToast: (message: string) => void;
  onAccountDetected: (account: OtpAccount) => void;
}

export function AddAccountPage({ onNavigate, onToast, onAccountDetected }: AddAccountPageProps) {
  const qrInput = useRef<HTMLInputElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  function handleQrFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      onToast(`Selected ${file.name}. QR decoding will use the Electron bridge.`);
    }
    event.target.value = "";
  }

  async function handleScreenCapture() {
    if (!window.winotp?.captureScreen) {
      onToast("Screen capture is unavailable outside the Electron app.");
      return;
    }

    setIsCapturing(true);
    try {
      const result = await window.winotp.captureScreen();
      if (result.status === "cancelled") {
        return;
      }
      if (result.status === "no-qr-code") {
        onToast("No QR code found in the selected screen region.");
        return;
      }
      if (result.status !== "success") {
        onToast("Failed to scan the selected screen region.");
        return;
      }

      const account = parseOtpUri(result.text);
      if (!account) {
        onToast("The QR code does not contain a valid OTP URI.");
        return;
      }

      onAccountDetected(account);
    } catch {
      onToast("Failed to capture the screen.");
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <div className="page-scroll">
      <div className="page-shell">
        <h1 className="page-title">Add Account</h1>
        <div className="choice-list">
          <Button
            type="button"
            variant="outline"
            className="choice-card"
            onClick={() => qrInput.current?.click()}
          >
            <span className="choice-card__icon">
              <GalleryVerticalEnd size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import QR Code</span>
              <span className="choice-card__detail">Select an image file with a QR code</span>
            </span>
          </Button>
          <input
            ref={qrInput}
            className="sr-only"
            type="file"
            accept="image/*"
            aria-label="Select a QR code image"
            onChange={handleQrFile}
          />

          <Button
            type="button"
            variant="outline"
            className="choice-card"
            disabled={isCapturing}
            onClick={handleScreenCapture}
          >
            <span className="choice-card__icon">
              <FileKey2 size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Capture Screen Region</span>
              <span className="choice-card__detail">
                {isCapturing
                  ? "Preparing screen capture…"
                  : "Select a screen area containing a QR code"}
              </span>
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="choice-card"
            onClick={() => onNavigate("manual")}
          >
            <span className="choice-card__icon">
              <PencilLine size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Manual Entry</span>
              <span className="choice-card__detail">Enter account details manually</span>
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            className="choice-card"
            onClick={() => onNavigate("import")}
          >
            <span className="choice-card__icon">
              <FileText size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import</span>
              <span className="choice-card__detail">
                Import accounts from other sources or files
              </span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
