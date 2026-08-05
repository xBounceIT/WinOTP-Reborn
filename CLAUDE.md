# WinOTP - Reborn

This repository contains the cross-platform WinOTP application: TypeScript 7 Electron sources and a Rust core. C#/.NET is no longer part of the application.

## Tooling

- Treat `electron-app/` as the primary application surface.
- Treat `electron-app/src/` as TypeScript frontend source. Treat `electron-app/electron/`, `electron-app/scripts/`, and `electron-app/vite.config.mjs` as plain JavaScript; `electron-app/electron-dist/` is generated runtime output.
- Treat `rust/winotp-core/` as the source of truth for portable application logic.
- Run Electron checks from `electron-app/` with npm and Rust checks from the repository root with Cargo.

## Platform boundary

Keep UI and renderer-facing behavior in TypeScript frontend code. Keep portable domain rules and cryptography in Rust. Electron owns OS-backed secure storage, desktop capture, and login items; Rust owns portable rules plus the native Windows Hello, session notification, and legacy Credential Manager bridge.
