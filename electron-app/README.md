# WinOTP Electron app

This is the Electron frontend for WinOTP. It keeps the current 480×650 content model, uses native OS window controls with a themeable titlebar overlay, compact left navigation rail, 360px account column, and the existing Home, Add Account, Import, Manual Entry, and Settings page boundaries.

Accounts are stored by the Electron main process in `%LOCALAPPDATA%\WinOTP_Reborn\accounts.db`. TOTP secrets are encrypted with Electron `safeStorage` (Windows DPAPI) before they are written to SQLite. On first launch, the app imports valid accounts from the legacy `WinOTP` Windows Credential Manager resource and records the migration so it is not repeated.

The first launch also migrates the native `%LOCALAPPDATA%\WinOTP_Reborn\settings.json` into `app-settings.json`, maps its automatic-backup settings into `backup-settings.json`, and imports `WinOTP_AppLock` and `WinOTP_Backup` credentials into Electron's encrypted `security.json` and `.backup-password` files. Migration is idempotent, keeps usable existing Electron files authoritative, and retries incomplete parts on later launches when the legacy source or target storage becomes available.

The renderer uses the native bridge for account listing, add/edit/delete, usage counters, and encrypted backup import/export. Screen-region QR capture uses Electron's cross-platform `screen` and `desktopCapturer` APIs. It creates one local-coordinate overlay per OS display, preserves negative origins and per-monitor DPI, matches sources by `display_id`, and adds decoded `otpauth://` accounts to the local account list.

Backups use the same `.wotpbackup` PBKDF2-SHA256/AES-256-GCM envelope as the WinUI app, with the backup password protected by Electron `safeStorage`. Automatic backups are written to `%LOCALAPPDATA%\WinOTP_Reborn\Backups` by default, retain the latest 20 files, and can be moved to a validated custom folder from Settings.

Windows Hello availability and verification use the Windows PowerShell 5.1 WinRT bridge, including Remote Desktop detection and the configured fallback credential. Update checks, release selection, installer download, digest verification, and installer launch use the Rust updater sidecar through the Electron main process.

## Development

```bash
npm install
npm run dev
```

The development bridge can compile the Rust updater with Cargo on demand. Packaging automatically builds the platform-specific sidecar into `native/`; build it separately when needed:

```bash
npm run build:updater
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
