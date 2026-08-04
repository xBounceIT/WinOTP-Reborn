# WinOTP Electron migration UI

This is the parallel frontend for the WinUI3 implementation in the repository root. It keeps the current 480×650 content model, uses native OS window controls with a themeable titlebar overlay, compact left navigation rail, 360px account column, and the existing Home, Add Account, Import, Manual Entry, and Settings page boundaries.

The UI keeps the migration bridge narrow while the rest of the app is being migrated:

- Three local demo accounts render live RFC 6238-compatible TOTP codes.
- Search, sorting, copying, add/edit/delete, settings, theme preview, and the lock overlay work in local state.
- Screen-region QR capture uses Electron's cross-platform `screen` and `desktopCapturer` APIs. It creates one local-coordinate overlay per OS display, preserves negative origins and per-monitor DPI, matches sources by `display_id`, and adds decoded `otpauth://` accounts to the local account list.
- Backup, update, and secure persistence actions still surface the remaining native bridge boundary.

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
