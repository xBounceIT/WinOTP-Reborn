import { FileKey2, FileText, GalleryVerticalEnd, PencilLine } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import type { Route } from "@/lib/types";

interface AddAccountPageProps {
  onNavigate: (route: Route) => void;
  onToast: (message: string) => void;
}

export function AddAccountPage({ onNavigate, onToast }: AddAccountPageProps) {
  const qrInput = useRef<HTMLInputElement>(null);

  function handleQrFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      onToast(`Selected ${file.name}. QR decoding will use the Electron bridge.`);
    }
    event.target.value = "";
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
            onClick={() => onToast("Screen capture is ready for the Electron native bridge.")}
          >
            <span className="choice-card__icon">
              <FileKey2 size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Capture Screen Region</span>
              <span className="choice-card__detail">Select a screen area containing a QR code</span>
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
