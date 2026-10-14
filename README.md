# WinOTP

WinOTP is a secure, cross-platform TOTP authenticator with a TypeScript-only desktop frontend and an entirely Rust backend.

## Current architecture

- `electron-app/src/` — TypeScript 7 React renderer and typed frontend state.
- `electron-app/electron/` — TypeScript Electron host, preload bridge, persistence boundary, and OS adapters. These files are part of the desktop frontend/platform layer: they must not contain portable domain or cryptographic backend logic.
- `electron-app/scripts/` and `electron-app/vite.config.ts` — TypeScript development, build, packaging, and frontend configuration.
- `electron-app/electron-dist/` — ignored generated CommonJS runtime output compiled from `.cts` sources; it is never a source directory.
- `rust/winotp-core/` — portable account model, OTP generation, URI/import mapping, backup cryptography, ordering, settings, and protection policy.
- `rust/winotp-updater/` — platform-neutral update discovery and installer verification sidecar.
- `rust/winotp-browser-bridge-host/` — the packaged Native Messaging transport pinned to the official [WinOTP Reborn WebBridge](https://github.com/xBounceIT/WinOTP-Reborn-WebBridge).

The Electron main process stores accounts in its per-user `WinOTP_Reborn/accounts.db` directory. TOTP secrets and security credentials are encrypted with Electron `safeStorage` before they are written to disk; Electron maps that API to DPAPI, Keychain, or the Linux secret-service backend as appropriate. On Windows, valid entries from the previous Credential Manager store are imported once. The same launch migrates the legacy settings and credentials when they are available.

Rust is the complete backend and is authoritative for data normalization, OTP and backup cryptography, imports, ordering rules, settings normalization, protection decisions, plus update discovery, selection, download, digest verification, and installer launch. TypeScript is frontend-only: Electron owns the cross-platform host and adapter boundary—IPC, update UI state, SQLite and OS-backed persistence access, windows, login items, desktop capture, and renderer-only browser work such as `jsqr`—but no backend business rules.

## Run the Electron app

Requirements: Node.js 24 or newer.

```powershell
cd electron-app
npm install
npm run dev
```

For production renderer checks:

```powershell
cd electron-app
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:electron
npm run build
```

The app currently supports the home, add-account, manual-entry, import, settings, multi-display QR screen-capture, backup, protection, and update flows. Portable behavior is implemented in Rust and exposed through a narrow JSON sidecar bridge; Electron IPC exposes only renderer-safe operations.

## Browser extension bridge

Browser access is disabled by default. After the user explicitly enables **Allow browser extension access** in Settings, WinOTP registers the per-user Native Messaging host and publishes the authenticated local endpoint defined by the WebBridge Desktop trusted contract. Disabling the option removes the endpoint and registrations without touching account data.

The extension can read only account `id`, `issuer`, and display `name`, then request a current TOTP for one selected account while the desktop app is unlocked. Secrets, OTP URIs, backups, encryption material, protection credentials, and page contents are never returned to the browser. Every request re-checks the live lock state and passes TOTP generation through `winotp-core`.

`importQr` accepts an authenticated QR handoff for desktop review while unlocked. The closed protocol-1 request accepts only `params.text`, up to 8192 UTF-8 bytes without ASCII controls. The existing Rust OTP parser validates the payload; migration QR codes currently return `INVALID_REQUEST` because this parser does not support them. `{ "accepted": true }` acknowledges the queued review, not a saved account. The desktop displays account metadata and requires **Confirm import** before using the shared account import/persistence flow. Protection is checked again before saving, and failures remain visible in the review.

Pending QR data stays in main-process memory and is discarded on cancellation, lock, bridge disablement, renderer reload/crash, or completion. Requests whose connection or authorization was revoked during authentication cannot open a review after unlocking. Request IDs, payload digests and Rust account identities coalesce concurrent handoffs and equivalent QR encodings for the lifetime of the app; reusing an ID with different text is rejected. Retrying an accepted ID never reopens a cancelled or completed review. A new request ID can start a fresh review after cancellation or lock. The queue holds at most 16 pending reviews and 4096 replay records per app session, refusing additional requests rather than evicting replay protection. Replay records do not persist across app restarts, but confirmation compares the account against stored accounts in Rust and reports an existing account without writing another copy or creating a redundant backup.

On Linux AppImage builds, enabling the bridge installs a private per-user copy of the packaged Native Messaging host so `ping` can still distinguish an installed bridge from an app that is not currently running. Disabling the bridge removes that copy together with its browser manifests.

The Native Messaging manifests allow only the official extension identities: `chrome-extension://gomcpjbgmfdggpnbplajohjkjbbjijln/` for Chrome and Chromium, and `{250f3c41-cf5e-4c20-a07c-e99a8532436b}` for Firefox. These identities are built into the desktop app, so development and release builds register the same trusted extensions without build-time secrets.

## Test the Rust core

```powershell
cargo test --manifest-path rust/Cargo.toml --workspace
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
```

Packaging automatically builds both platform-specific Rust sidecars through the `prepackage` lifecycle hook. To build them separately for a packaged Electron build:

```powershell
cd electron-app
npm run build:updater
npm run build:core
npm run package -- --win --x64
```

## Security

- Account secrets are encrypted with OS-backed Electron `safeStorage` before database storage.
- Legacy Windows Credential Manager entries are read only for the one-time migration; existing Electron credentials and settings remain authoritative when already present.
- Backup data remains local and password-protected where the corresponding Electron bridge is enabled.
- No cloud synchronization is performed.

## Project status

The former XAML frontend, native application manifest, and native installer pipeline have been retired. Electron packaging is now handled by `.github/workflows/release.yml`, which builds Windows NSIS setups, Linux AppImage, DEB, and RPM packages for x64 and arm64, and a universal macOS DMG for version tags such as `v2.2.0`.

WinOTP is licensed under the MIT License.
