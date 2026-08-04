# WinOTP - Reborn

This repository is migrating its Windows TOTP manager from a native C# frontend to Electron.

## Tooling

- Treat `electron-app/` as the primary application surface.
- Run Electron checks from `electron-app/` with npm.
- Run `dotnet` directly from the shell for the transitional `WinOTP.Core.csproj` and `WinOTP.Tests` projects.

## Migration boundary

Keep new UI and renderer-facing behavior in Electron. The C# project should contain only Windows-specific compatibility and migration code that has not yet moved to an Electron bridge.
