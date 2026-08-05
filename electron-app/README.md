# WinOTP Electron app

This is the TypeScript 7 Electron application for WinOTP. Renderer code is TypeScript/TSX, Electron main-process and preload code is TypeScript `.cts`, and the Rust `winotp-core` sidecar provides portable domain logic. TypeScript compiles the Electron runtime into the ignored `electron-dist/` directory; generated CommonJS files are never edited directly.

Accounts are stored by the Electron main process in the per-user `WinOTP_Reborn/accounts.db` directory. TOTP secrets are encrypted with Electron `safeStorage` before they are written to SQLite. On first launch, Windows imports valid accounts from the legacy `WinOTP` Credential Manager resource and records the migration so it is not repeated; other platforms mark that legacy migration as not applicable.

The first launch also migrates the native `%LOCALAPPDATA%\WinOTP_Reborn\settings.json` into `app-settings.json`, maps its automatic-backup settings into `backup-settings.json`, and imports `WinOTP_AppLock` and `WinOTP_Backup` credentials into Electron's encrypted `security.json` and `.backup-password` files. Migration is idempotent, keeps usable existing Electron files authoritative, and retries incomplete parts on later launches when the legacy source or target storage becomes available.

The renderer uses the native bridge for account listing, add/edit/delete, usage counters, and encrypted backup import/export. The main process delegates account normalization, TOTP generation, backup encryption, and portable policy decisions to Rust. Renderer helpers that must stay responsive or use browser-only APIs (sorting previews, WebCrypto, and `jsqr`) remain thin cross-platform UI adapters over the same Rust-defined data contract. Screen-region QR capture uses Electron's cross-platform `screen` and `desktopCapturer` APIs. It creates one local-coordinate overlay per OS display, preserves negative origins and per-monitor DPI, matches sources by `display_id`, and adds decoded `otpauth://` accounts to the local account list.

Backups use the same `.wotpbackup` PBKDF2-SHA256/AES-256-GCM envelope as the former native app, with encryption implemented in Rust and the automatic-backup password protected by Electron `safeStorage`. Automatic backups are written to the platform's per-user `WinOTP_Reborn/Backups` directory by default, retain the latest 20 files, and can be moved to a validated custom folder from Settings.

Windows Hello availability and verification, Remote Desktop session notifications, and one-time legacy Credential Manager migration use Rust Windows API bindings through the core sidecar. On non-Windows platforms those legacy capabilities report unavailable while the portable app remains fully usable. Update checks, release selection, installer download, digest verification, and installer launch use the Rust updater sidecar through the Electron main process.

## Development

```bash
npm install
npm run dev
```

The development bridge compiles the TypeScript Electron boundary before launching. The Rust sidecars can be compiled with Cargo on demand. Packaging automatically builds both platform-specific sidecars into `native/`; build them separately when needed:

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
