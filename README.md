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

The extension can read only account `id`, `issuer`, and display `name`, then request a current TOTP for one selected account while the desktop app is unlocked. Secrets, OTP URIs, backups, encryption material, protection credentials, and page contents never cross the bridge. Every request re-checks the live lock state and passes TOTP generation through `winotp-core`.

On Linux AppImage builds, enabling the bridge installs a private per-user copy of the packaged Native Messaging host so `ping` can still distinguish an installed bridge from an app that is not currently running. Disabling the bridge removes that copy together with its browser manifests.

Firefox uses the extension's stable add-on ID. Chrome and Chromium production packages also require their assigned 32-character store extension ID when building the desktop installers:

```powershell
$env:WINOTP_CHROME_EXTENSION_ID = "<chrome-extension-id>"
cd electron-app
npm run package
```

The release workflow reads the same value from the `CHROME_EXTENSION_ID` repository secret. Development builds may set either `WINOTP_CHROME_EXTENSION_ID` or `CHROME_EXTENSION_ID` before `npm run build:core`.

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

The former XAML frontend, native application manifest, and native installer pipeline have been retired. Electron packaging is now handled by `.github/workflows/release.yml`, which builds Windows NSIS setups, Linux AppImage, DEB, and RPM packages for x64 and arm64, and a universal macOS DMG for version tags such as `v2.1.0`.

WinOTP is licensed under the MIT License.
