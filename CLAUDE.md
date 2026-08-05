# WinOTP - Reborn

This repository contains the cross-platform WinOTP application: a TypeScript 7-only desktop frontend and an entirely Rust backend. JavaScript source and C#/.NET are no longer part of the application.

## Tooling

- Treat `electron-app/` as the primary application surface.
- Treat `electron-app/src/`, `electron-app/electron/`, `electron-app/scripts/`, and `electron-app/vite.config.ts` as TypeScript frontend, desktop-host, adapter, and tooling source. Do not add JavaScript source files; `.cjs` files under ignored `electron-dist/` are generated output only.
- Treat the Rust workspace as the entire backend and `rust/winotp-core/` as the source of truth for portable application logic.
- Run Electron checks from `electron-app/` with npm and Rust checks from the repository root with Cargo.

## Platform boundary

Keep TypeScript frontend-only: UI, Electron IPC orchestration, IPC authorization and input bounds, and thin OS/persistence adapters. Keep every backend business rule, portable domain operation, domain validation, and cryptographic operation in Rust. Electron owns OS-backed secure-storage access, desktop capture, and login-item integration; Rust owns the backend plus native Windows Hello, session notification, and legacy Credential Manager behavior.
