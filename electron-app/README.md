# WinOTP Electron app

This is the Electron frontend for WinOTP. It keeps the current 480×650 content model, uses native OS window controls with a themeable titlebar overlay, compact left navigation rail, 360px account column, and the existing Home, Add Account, Import, Manual Entry, and Settings page boundaries.

Accounts are stored by the Electron main process in `%LOCALAPPDATA%\WinOTP_Reborn\accounts.db`. TOTP secrets are encrypted with Electron `safeStorage` (Windows DPAPI) before they are written to SQLite. On first launch, the app imports valid accounts from the legacy `WinOTP` Windows Credential Manager resource and records the migration so it is not repeated.

The renderer uses the native bridge for account listing, add/edit/delete, and usage counters. Screen-region QR capture uses Electron's cross-platform `screen` and `desktopCapturer` APIs. It creates one local-coordinate overlay per OS display, preserves negative origins and per-monitor DPI, matches sources by `display_id`, and adds decoded `otpauth://` accounts to the local account list. Backup, update, and Windows Hello actions still surface their existing bridge boundaries.

## Development

```bash
npm install
npm run dev
```

The Electron shell is non-resizable and opens the Vite renderer in development. After `npm run build`, `npm run electron` loads the built renderer from `dist/`.

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Stack: Electron, React, Shadcn UI components, TypeScript 7, Vite 8, Tailwind CSS 4, Oxlint, and Oxfmt.
