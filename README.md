# WinOTP

A modern, secure TOTP (Time-based One-Time Password) authenticator app for Windows 11, built with .NET 10 and WinUI 3.

![Windows](https://img.shields.io/badge/Windows-11-blue?logo=windows)
![.NET](https://img.shields.io/badge/.NET-10.0-purple?logo=dotnet)
![Platform](https://img.shields.io/badge/platform-x64%20%7C%20ARM64-lightgrey)

## Features

- **Secure Storage**: TOTP secrets are encrypted and stored using Windows Credential Manager (DPAPI)
- **QR Code Import**: Scan QR codes from files or screen capture
- **Manual Entry**: Add accounts manually with support for custom settings
- **Real-time Codes**: Auto-refreshing TOTP codes with visual countdown timers
- **Multiple Algorithms**: Supports SHA1, SHA256, and SHA512
- **Flexible Sorting**: Sort accounts by date added or alphabetically (ascending/descending)
- **Account Management**: Easy deletion with confirmation dialogs
- **Native Windows UI**: Modern WinUI 3 interface with dark/light mode support

## Screenshots

*Screenshots will be added here*

## Requirements

- Windows 11 (Build 19041 or later)
- [.NET 10 Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)

## Installation

### Download Pre-built Binary

Download the latest release from the [Releases](https://github.com/xBounceIT/WinOTP-Reborn/releases) page.

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

## Security

WinOTP prioritizes the security of your TOTP secrets:

- **Encryption**: All secrets are encrypted using Windows Data Protection API (DPAPI)
- **Isolation**: Credentials are stored per Windows user account
- **No Cloud Sync**: Your secrets never leave your device
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
│   └── TotpCodeGenerator.cs         # TOTP code generation
├── Pages/
│   ├── HomePage.xaml          # Main account list
│   ├── AddAccountPage.xaml    # Add account methods
│   ├── ManualEntryPage.xaml   # Manual account entry
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
