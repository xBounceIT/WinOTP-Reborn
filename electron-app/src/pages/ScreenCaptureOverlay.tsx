import { useCallback, useEffect, useRef, useState } from "react";

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const minimumSelectionSize = 10;
type JsQrDecoder = typeof import("jsqr").default;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getPoint(event: React.PointerEvent, element: HTMLElement): ScreenRect {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height),
    width: 0,
    height: 0,
  };
}

function getSelection(start: ScreenRect, end: ScreenRect): ScreenRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function getDisplayViewport(display: ScreenCaptureDisplay): ScreenRect {
  return {
    x: 0,
    y: 0,
    width: display.bounds.width,
    height: display.bounds.height,
  };
}

function decodeRegion(
  decoder: JsQrDecoder,
  image: HTMLImageElement,
  selection: { x: number; y: number; width: number; height: number },
): string | undefined {
  const sourceX = Math.max(0, Math.floor(selection.x));
  const sourceY = Math.max(0, Math.floor(selection.y));
  const sourceRight = Math.min(image.naturalWidth, Math.ceil(selection.x + selection.width));
  const sourceBottom = Math.min(image.naturalHeight, Math.ceil(selection.y + selection.height));
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;

  if (sourceWidth < minimumSelectionSize || sourceHeight < minimumSelectionSize) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight);
  return (
    decoder(pixels.data, sourceWidth, sourceHeight, { inversionAttempts: "attemptBoth" })?.data ||
    undefined
  );
}

async function decodeSelection(
  capture: ScreenCapturePayload,
  selection: ScreenRect,
  image: HTMLImageElement | null,
): Promise<string | undefined> {
  const { default: decoder } = await import("jsqr");
  const display = capture.display;
  if (!image) {
    return undefined;
  }

  const bounds = getDisplayViewport(display);
  const core = window.winotp?.core;
  if (!core) {
    throw new Error("The Rust screen-capture bridge is unavailable.");
  }

  const mapped = await core.screenCaptureMap({
    selectionX: selection.x,
    selectionY: selection.y,
    selectionWidth: selection.width,
    selectionHeight: selection.height,
    canvasWidth: bounds.width,
    canvasHeight: bounds.height,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
  });
  const padding = await core.screenCapturePadding({ rect: mapped });
  const expanded = await core.screenCaptureExpand({
    rect: mapped,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    padding,
  });

  for (const candidate of [mapped, expanded]) {
    const text = decodeRegion(decoder, image, candidate);
    if (text) {
      return text;
    }
  }

  return undefined;
}

export function ScreenCaptureOverlay() {
  const [capture, setCapture] = useState<ScreenCapturePayload>();
  const [loadedImageId, setLoadedImageId] = useState<string>();
  const [selection, setSelection] = useState<ScreenRect>();
  const [dragStart, setDragStart] = useState<ScreenRect>();
  const [isScanning, setIsScanning] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const hasSubmitted = useRef(false);

  const submit = useCallback((result: ScreenCaptureResult) => {
    if (hasSubmitted.current) {
      return;
    }

    hasSubmitted.current = true;
    window.winotp?.completeScreenCapture(result);
  }, []);

  useEffect(() => {
    if (!window.winotp) {
      setBridgeError("Screen capture is unavailable outside the Electron app.");
      return;
    }

    return window.winotp.onScreenCaptureReady((nextCapture) => {
      setCapture(nextCapture);
      imageRef.current = null;
      setLoadedImageId(undefined);
      setBridgeError("");
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        submit({ status: "cancelled" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submit]);

  const imagesReady = Boolean(capture && loadedImageId === capture.display.id);

  function handleImageLoad(displayId: string, image: HTMLImageElement) {
    imageRef.current = image;
    setLoadedImageId(displayId);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imagesReady || isScanning || event.button !== 0 || !overlayRef.current) {
      return;
    }

    const point = getPoint(event, overlayRef.current);
    setDragStart(point);
    setSelection(point);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || !overlayRef.current) {
      return;
    }

    setSelection(getSelection(dragStart, getPoint(event, overlayRef.current)));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || !overlayRef.current) {
      return;
    }

    const nextSelection = getSelection(dragStart, getPoint(event, overlayRef.current));
    setDragStart(undefined);
    setSelection(nextSelection);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (
      nextSelection.width < minimumSelectionSize ||
      nextSelection.height < minimumSelectionSize ||
      !capture
    ) {
      return;
    }

    setIsScanning(true);
    void decodeSelection(capture, nextSelection, imageRef.current)
      .then((text) => submit(text ? { status: "success", text } : { status: "no-qr-code" }))
      .catch(() => submit({ status: "failed" }));
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragStart(undefined);
    setSelection(undefined);
  }

  return (
    <main
      ref={overlayRef}
      className="screen-capture-overlay"
      onContextMenu={(event) => {
        event.preventDefault();
        submit({ status: "cancelled" });
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {capture && (
        <img
          key={capture.display.id}
          ref={(image) => {
            imageRef.current = image;
          }}
          onLoad={(event) => handleImageLoad(capture.display.id, event.currentTarget)}
          onError={() => {
            setBridgeError("Could not prepare the screen capture.");
            submit({ status: "failed" });
          }}
          className="screen-capture-overlay__screen"
          src={capture.display.dataUrl}
          alt=""
          draggable={false}
          style={{ left: 0, top: 0, width: "100%", height: "100%" }}
        />
      )}

      <div className="screen-capture-overlay__shade" aria-hidden="true" />

      {selection &&
        selection.width >= minimumSelectionSize &&
        selection.height >= minimumSelectionSize && (
          <div
            className="screen-capture-overlay__selection"
            aria-hidden="true"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />
        )}

      <div className="screen-capture-overlay__status" role="status" aria-live="polite">
        {bridgeError ||
          (isScanning
            ? "Scanning selected region…"
            : imagesReady
              ? "Drag around a QR code · Esc to cancel"
              : "Preparing screen capture…")}
      </div>
    </main>
  );
}
