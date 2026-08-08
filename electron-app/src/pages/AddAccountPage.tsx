import { FileKey2, FileText, GalleryVerticalEnd, PencilLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { parseOtpUri } from "@/lib/otp-uri";
import type { OtpAccount, Route } from "@/lib/types";

const MAX_QR_IMAGE_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_QR_IMAGE_DIMENSION = 8_192;
const MAX_QR_IMAGE_PIXELS = 16 * 1024 * 1024;

interface AddAccountPageProps {
  onNavigate: (route: Route) => void;
  onToast: (message: string) => void;
  onAccountDetected: (account: OtpAccount) => Promise<void>;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The selected image could not be read."));
      }
    };
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be loaded."));
    image.src = dataUrl;
  });
}

async function decodeQrFile(file: File): Promise<string | undefined> {
  if (file.size > MAX_QR_IMAGE_FILE_SIZE_BYTES) {
    throw new Error("The selected image is too large to scan.");
  }

  const [{ default: decoder }, image] = await Promise.all([import("jsqr"), loadImage(file)]);

  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return undefined;
  }

  if (
    image.naturalWidth > MAX_QR_IMAGE_DIMENSION ||
    image.naturalHeight > MAX_QR_IMAGE_DIMENSION ||
    image.naturalWidth * image.naturalHeight > MAX_QR_IMAGE_PIXELS
  ) {
    throw new Error("The selected image dimensions are too large to scan.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }

  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return (
    decoder(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" })?.data ||
    undefined
  );
}

export function AddAccountPage({ onNavigate, onToast, onAccountDetected }: AddAccountPageProps) {
  const qrInput = useRef<HTMLInputElement>(null);
  const isMounted = useRef(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  async function handleQrFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    setIsImporting(true);
    try {
      const text = await decodeQrFile(file);
      if (!isMounted.current) {
        return;
      }
      if (!text) {
        onToast("No QR code found in the selected image.");
        return;
      }

      const account = await parseOtpUri(text);
      if (!account) {
        onToast("The QR code does not contain a valid OTP URI.");
        return;
      }

      await onAccountDetected(account);
    } catch {
      if (isMounted.current) {
        onToast("Failed to scan the selected image.");
      }
    } finally {
      if (isMounted.current) {
        input.value = "";
        setIsImporting(false);
      }
    }
  }

  async function handleScreenCapture() {
    if (!window.winotp?.captureScreen) {
      onToast("Screen capture is unavailable outside the Electron app.");
      return;
    }

    setIsCapturing(true);
    try {
      const result = await window.winotp.captureScreen();
      if (!isMounted.current) {
        return;
      }
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

      const account = await parseOtpUri(result.text);
      if (!account) {
        onToast("The QR code does not contain a valid OTP URI.");
        return;
      }

      await onAccountDetected(account);
    } catch {
      if (isMounted.current) {
        onToast("Failed to capture the screen.");
      }
    } finally {
      if (isMounted.current) {
        setIsCapturing(false);
      }
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
            disabled={isImporting || isCapturing}
            onClick={() => qrInput.current?.click()}
          >
            <span className="choice-card__icon">
              <GalleryVerticalEnd size={24} strokeWidth={1.6} />
            </span>
            <span className="choice-card__copy">
              <span className="choice-card__title">Import QR Code</span>
              <span className="choice-card__detail">
                {isImporting ? "Scanning selected image…" : "Select an image file with a QR code"}
              </span>
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
            disabled={isCapturing || isImporting}
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
            disabled={isImporting || isCapturing}
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
            disabled={isImporting || isCapturing}
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
