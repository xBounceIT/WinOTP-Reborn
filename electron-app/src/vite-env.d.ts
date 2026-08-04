/// <reference types="vite/client" />

interface ScreenCaptureDisplay {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
  displayIndex: number;
  displayCount: number;
  dataUrl: string;
}

interface ScreenCapturePayload {
  display: ScreenCaptureDisplay;
}

type ScreenCaptureResult =
  | { status: "success"; text: string }
  | { status: "cancelled" | "no-qr-code" | "failed" };

interface Window {
  winotp?: {
    openExternal: (url: string) => Promise<boolean>;
    setTitleBarTheme: (theme: { color: string; symbolColor: string }) => void;
    captureScreen: () => Promise<ScreenCaptureResult>;
    onScreenCaptureReady: (listener: (capture: ScreenCapturePayload) => void) => () => void;
    completeScreenCapture: (result: ScreenCaptureResult) => void;
  };
}
