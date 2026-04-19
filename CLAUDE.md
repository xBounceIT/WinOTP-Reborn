# WinOTP - Reborn

This is a C# .NET 10 Windows 11 Desktop TOTP manager App built with WinUI3.

## UI
- Make sure to always respect WinUI3 guidelines

## Tooling
- Run `dotnet` directly from the shell for restore/build/test/run.

## Releases
- For GitHub releases, publish the installer assets produced by `scripts/Build-Installer.ps1`, not the raw `dotnet publish` folders.
- Preferred release assets are `WinOTP-<version>-win-x64-setup.exe` and `WinOTP-<version>-win-arm64-setup.exe`.
- The `artifacts/publish/win-x64` and `artifacts/publish/win-arm64` directories are build outputs for validation or manual distribution, not the primary GitHub release artifacts.
