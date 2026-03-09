# WinOTP

Successor to my previous project: https://github.com/xBounceIT/WinOTP

A modern, secure TOTP (Time-based One-Time Password) authenticator app for Windows 11, built with .NET 10 and WinUI 3.

![Windows](https://img.shields.io/badge/Windows-11-blue?logo=windows)
![.NET](https://img.shields.io/badge/.NET-10.0-purple?logo=dotnet)
![Platform](https://img.shields.io/badge/platform-x64%20%7C%20ARM64-lightgrey)

## Features

- **Secure Storage**: TOTP secrets are encrypted and stored using Windows Credential Manager (DPAPI)
- **QR Code Import**: Scan QR codes from files or screen capture
- **Manual Entry**: Add accounts manually with support for custom settings
- **Encrypted Backups**: Create password-protected backup files and optional automatic local backup history
- **Real-time Codes**: Auto-refreshing TOTP codes with visual countdown timers
- **Multiple Algorithms**: Supports SHA1, SHA256, and SHA512
- **Flexible Sorting**: Sort accounts by date added or alphabetically (ascending/descending)
- **Account Management**: Easy deletion with confirmation dialogs
- **Native Windows UI**: Modern WinUI 3 interface with dark/light mode support

## Screenshots

<img width="731" height="797" alt="immagine" src="https://github.com/user-attachments/assets/dc4ec69c-fb41-4862-9df3-81397f82d0da" />
<img width="731" height="797" alt="immagine" src="https://github.com/user-attachments/assets/4657af51-8024-474d-ab2a-e824a4ba47d6" />



## Requirements

- Windows 11 (Build 19041 or later)
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) for building from source

## Installation

### Download Pre-built Binary

Download the latest release from the [Releases](https://github.com/xBounceIT/WinOTP-Reborn/releases) page. The installer packages the required .NET and Windows App SDK runtime files for the target architecture.

### Build from Source

```bash
# Clone the repository
git clone https://github.com/xBounceIT/WinOTP-Reborn.git
cd WinOTP-Reborn

# Build the project
dotnet build -c Release

# Run the app
dotnet run
```

### Build Installer

The project version in `WinOTP.csproj` is the source of truth for both the app and installer version.

Prerequisites:

- Windows PowerShell
- .NET SDK installed at `C:\Program Files\dotnet\dotnet.exe`
- Inno Setup 6 installed at `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`

Run the packaging script from Windows PowerShell:

```powershell
.\scripts\Build-Installer.ps1 -Architecture x64
```

Build an ARM64 installer:

```powershell
.\scripts\Build-Installer.ps1 -Architecture arm64
```

The script publishes a self-contained app payload, validates that the publish directory contains the compiled WinUI XAML assets (`WinOTP.pri` and app `.xbf` files), reads the version from `WinOTP.csproj`, and passes it into `installer/WinOTP.iss`.
The raw project version is kept for installer metadata, while the generated installer filename uses a normalized version that strips any leading `v` and SemVer build metadata so release assets match the updater's expected naming.

## Usage

### Adding an Account

1. Click **"Add Account"** on the home screen
2. Choose one of the following methods:
   - **Import QR from File**: Select a QR code image from your computer
   - **Capture QR from Screen**: Select a region of your screen containing a QR code
   - **Manual Entry**: Enter the account details and secret key manually

### Viewing TOTP Codes

- All accounts are displayed on the home screen with their current TOTP codes
- Codes automatically refresh every 30 seconds (or custom period)
- A progress bar shows how much time remains before the code changes

### Sorting Accounts

Use the dropdown menu to sort accounts by:
- Date Added (Newest First)
- Date Added (Oldest First)
- Name (A → Z)
- Name (Z → A)

### Deleting an Account

Click the trash icon next to an account and confirm the deletion. The account and its secret will be permanently removed from Windows Credential Manager.

### Backing Up Tokens

- Open **Settings** to enable automatic backups
- Automatic backups are password-protected and stored in `%LocalAppData%\\WinOTP_Reborn\\Backups` by default
- You can choose a custom folder for automatic backups from **Settings**
- Manual **Export backup** writes a `.wotpbackup` file to a location you choose
- Manual **Import backup** restores tokens from a `.wotpbackup` file using its password

## Security

WinOTP prioritizes the security of your TOTP secrets:

- **Encryption**: All secrets are encrypted using Windows Data Protection API (DPAPI)
- **Isolation**: Credentials are stored per Windows user account
- **No Cloud Sync**: Your secrets never leave your device
- **Password-Protected Backups**: Backup files are encrypted with a user-provided password
- **OS-Level Security**: Leverages Windows Credential Manager for secure storage

## Supported Algorithms

| Algorithm | Hash Function |
|-----------|--------------|
| SHA1      | HMAC-SHA1    |
| SHA256    | HMAC-SHA256  |
| SHA512    | HMAC-SHA512  |

## Compatible Services

WinOTP works with any service that supports standard TOTP authenticator apps:

- Google
- Microsoft
- GitHub
- AWS
- Discord
- Dropbox
- And many more...

## Dependencies

- [Microsoft.WindowsAppSDK](https://www.nuget.org/packages/Microsoft.WindowsAppSDK/) (1.8.260209005)
- [Otp.NET](https://www.nuget.org/packages/Otp.NET/) (1.4.1) - TOTP generation
- [ZXing.Net](https://www.nuget.org/packages/ZXing.Net/) (0.16.11) - QR code decoding

## Architecture

```
WinOTP/
├── Models/
│   └── OtpAccount.cs          # TOTP account model
├── Services/
│   ├── CredentialManagerService.cs  # Secure storage
│   ├── BackupService.cs             # Encrypted backup import/export
│   └── TotpCodeGenerator.cs         # TOTP code generation
├── Pages/
│   ├── HomePage.xaml          # Main account list
│   ├── AddAccountPage.xaml    # Add account methods
│   ├── ManualEntryPage.xaml   # Manual account entry
│   ├── SettingsPage.xaml      # Security, display, and backup settings
│   └── ScreenCaptureOverlay.xaml    # Screen QR capture
└── Helpers/
    ├── QrCodeHelper.cs        # QR code processing
    ├── OtpUriParser.cs        # OTP URI parsing
    └── ScreenCaptureHelper.cs # Screen capture utilities
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Otp.NET](https://github.com/kspearrin/Otp.NET) for TOTP implementation
- [ZXing.Net](https://github.com/micjahn/ZXing.Net) for QR code processing
- [WinUI 3](https://github.com/microsoft/microsoft-ui-xaml) for the modern Windows UI framework
