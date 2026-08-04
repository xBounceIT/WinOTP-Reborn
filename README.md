# WinOTP

WinOTP is a secure TOTP authenticator for Windows. The application is migrating from the former native C# desktop frontend to Electron; `electron-app/` is now the primary application surface.

## Current architecture

- `electron-app/` — Electron main process, preload bridge, and React renderer.
- `WinOTP.Core.csproj` — transitional Windows-only support library containing legacy credential, backup, update, and migration logic while equivalent Electron bridges are completed.
- `WinOTP.Tests/` — regression coverage for the transitional support library and migration behavior.

The Electron main process stores accounts in `%LOCALAPPDATA%\WinOTP_Reborn\accounts.db`. TOTP secrets are encrypted with Electron `safeStorage` before they are written to SQLite. On first launch, valid entries from the previous Windows Credential Manager store are imported once.

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

The app currently supports the home, add-account, manual-entry, import, settings, and multi-display QR screen-capture flows. Backup, update, and some protection settings still use migration placeholders in the Electron bridge.

## Test the transitional support code

The C# project is no longer an application entry point. It remains only to validate Windows-specific migration and compatibility behavior until those pieces are fully moved into Electron.

```powershell
dotnet test WinOTP.Tests\WinOTP.Tests.csproj
dotnet build WinOTP.Core.csproj
```

## Security

- Account secrets are encrypted with Windows-backed Electron `safeStorage` before database storage.
- Legacy Windows Credential Manager entries are read only for the one-time migration.
- Backup data remains local and password-protected where the corresponding Electron bridge is enabled.
- No cloud synchronization is performed.

## Project status

The former XAML frontend, native application manifest, and native installer pipeline have been retired. Electron packaging is now handled by `.github/workflows/release.yml`, which builds a Windows NSIS setup, Linux AppImage, and universal macOS DMG for version tags such as `v2.0.0`.

WinOTP is licensed under the MIT License.
