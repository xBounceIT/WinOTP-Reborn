# WinOTP

WinOTP is a secure, cross-platform TOTP authenticator built with TypeScript 7, Electron, and Rust. All application source is TypeScript or Rust; compiled Electron CommonJS files are generated build output only.

## Current architecture

- `electron-app/` — TypeScript 7 Electron main process, preload bridge, React renderer, tests, and OS adapters. Main-process `.cts` sources compile to the ignored `electron-dist/` runtime directory.
- `rust/winotp-core/` — portable account model, OTP generation, URI/import mapping, backup cryptography, ordering, settings, and protection policy.
- `rust/winotp-updater/` — platform-neutral update discovery and installer verification sidecar.

The Electron main process stores accounts in its per-user `WinOTP_Reborn/accounts.db` directory. TOTP secrets and security credentials are encrypted with Electron `safeStorage` before they are written to disk; Electron maps that API to DPAPI, Keychain, or the Linux secret-service backend as appropriate. On Windows, valid entries from the previous Credential Manager store are imported once. The same launch migrates the legacy settings and credentials when they are available.

Rust is authoritative for data normalization, OTP and backup cryptography, imports, ordering rules, settings normalization, and protection decisions. Electron owns the cross-platform shell boundary: SQLite and OS-backed storage, window/login-item APIs, desktop capture, and renderer-only browser work such as `jsqr` and WebCrypto.

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

The former XAML frontend, native application manifest, and native installer pipeline have been retired. Electron packaging is now handled by `.github/workflows/release.yml`, which builds a Windows NSIS setup, Linux AppImage, and universal macOS DMG for version tags such as `v2.0.0`.

WinOTP is licensed under the MIT License.
