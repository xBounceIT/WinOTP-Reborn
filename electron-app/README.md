# WinOTP Electron app

This is the TypeScript-only desktop frontend for WinOTP. The React renderer, Electron host, preload bridge, platform adapters, tests, scripts, and Vite configuration are TypeScript/TSX. The backend is entirely Rust: `winotp-core` owns domain and cryptographic behavior, while `winotp-updater` owns update discovery, selection, download, digest verification, and installer launch. `build:electron` compiles `.cts` sources into CommonJS files under ignored `electron-dist/`; those files are generated runtime artifacts, not JavaScript source.

Accounts are stored by the Electron main process in the per-user `WinOTP_Reborn/accounts.db` directory. TOTP secrets are encrypted with Electron `safeStorage` before they are written to SQLite. On first launch, Windows imports valid accounts from the legacy `WinOTP` Credential Manager resource and records the migration so it is not repeated; other platforms mark that legacy migration as not applicable.

The first launch also migrates the native `%LOCALAPPDATA%\WinOTP_Reborn\settings.json` into `app-settings.json`, maps its automatic-backup settings into `backup-settings.json`, and imports `WinOTP_AppLock` and `WinOTP_Backup` credentials into Electron's encrypted `security.json` and `.backup-password` files. Migration is idempotent, keeps usable existing Electron files authoritative, and retries incomplete parts on later launches when the legacy source or target storage becomes available.

The renderer uses the native bridge for account listing, add/edit/delete, usage counters, encrypted backup import/export, and Rust-backed domain operations. TypeScript remains a frontend/desktop-host layer: it enforces IPC authorization and bounded bridge inputs, then delegates account normalization, TOTP generation, imports, ordering, backup encryption, domain validation, and portable policy decisions to the Rust backend. Browser-only work such as `jsqr` remains in the renderer. Screen-region QR capture uses Electron's cross-platform `screen` and `desktopCapturer` APIs. It creates one local-coordinate overlay per OS display, preserves negative origins and per-monitor DPI, matches sources by `display_id`, and adds decoded `otpauth://` accounts to the local account list.

Backups use the same `.wotpbackup` PBKDF2-SHA256/AES-256-GCM envelope as the former native app, with encryption implemented in Rust and the automatic-backup password protected by Electron `safeStorage`. Automatic backups are written to the platform's per-user `WinOTP_Reborn/Backups` directory by default, retain the latest 20 files, and can be moved to a validated custom folder from Settings.

Windows Hello availability and verification, Remote Desktop session notifications, and one-time legacy Credential Manager migration use Rust Windows API bindings through the core sidecar. On non-Windows platforms those legacy capabilities report unavailable while the portable app remains fully usable. Update checks, release selection, installer download, digest verification, and installer launch use the Rust updater sidecar through the Electron main process.

## Development

```bash
npm install
npm run dev
```

The development bridge compiles the TypeScript Electron host before launching. The Rust backend sidecars can be compiled with Cargo on demand. Packaging automatically builds both platform-specific sidecars into `native/`; build them separately when needed:

```bash
npm run build:updater
npm run build:core
npm run build:electron
npm run package -- --win --x64
```

The Electron shell is non-resizable and opens the Vite renderer in development. After `npm run build`, `npm run electron` loads the built renderer from `dist/`.

## Checks

```bash
npm run typecheck
npm run lint
npm run test:electron
npm run format:check
npm run build
```

To package the app locally, install the dependencies and run the Electron Builder script with a target platform:

```bash
npm run build
npm run package -- --win --x64
npm run package -- --linux --x64
npm run package -- --mac --universal
```

Release tags are packaged by the repository workflow into a Windows NSIS setup, Linux AppImage, and universal macOS DMG.

Stack: Electron, React, Shadcn UI components, TypeScript 7, Vite 8, Tailwind CSS 4, Oxlint, and Oxfmt.
