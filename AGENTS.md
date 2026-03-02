# WinOTP - Reborn

This is a C# .NET 10 Windows 11 Desktop TOTP manager App built with WinUI3.

## UI
- Make sure to always respect WinUI3 guidelines

## Tooling
- Always use the host Windows .NET install from WSL.
- Run `dotnet` as `"/mnt/c/Program Files/dotnet/dotnet.exe"` for restore/build/test/run.
- Do not rely on a Linux/WSL `dotnet` shim/path.
- Quick check command: `"/mnt/c/Program Files/dotnet/dotnet.exe" --info`

## Releases
- For GitHub releases, publish the installer assets produced by `scripts/Build-Installer.ps1`, not the raw `dotnet publish` folders.
- Preferred release assets are `WinOTP-<version>-win-x64-setup.exe` and `WinOTP-<version>-win-arm64-setup.exe`.
- The `artifacts/publish/win-x64` and `artifacts/publish/win-arm64` directories are build outputs for validation or manual distribution, not the primary GitHub release artifacts.
