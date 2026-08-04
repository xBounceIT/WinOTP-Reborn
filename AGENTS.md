# WinOTP - Reborn

This repository is migrating its Windows TOTP manager from a native C# frontend to Electron.

## Architecture

- Treat `electron-app/` as the primary application surface.
- Keep `WinOTP.Core.csproj` limited to transitional Windows-specific support and migration logic.
- Do not add new application UI behavior to the C# support project; implement new UI and renderer-facing behavior in Electron.

## Checks

- Electron: run the typecheck, lint, format check, unit tests, and production build from `electron-app/`.
- Transitional C#: run `dotnet test WinOTP.Tests\WinOTP.Tests.csproj` and build `WinOTP.Core.csproj` when changing the support code.

## Releases

Electron packaging and release automation are intentionally paused while the remaining native bridges are migrated. Do not restore the retired native installer pipeline for Electron releases.
