import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import "@/index.css";
import { ScreenCaptureOverlay } from "@/pages/ScreenCaptureOverlay";

const isScreenCaptureOverlay = new URLSearchParams(window.location.search).has("screen-capture");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isScreenCaptureOverlay ? <ScreenCaptureOverlay /> : <App />}</StrictMode>,
);
