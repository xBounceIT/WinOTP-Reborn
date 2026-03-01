using Windows.Security.Credentials.UI;

namespace WinOTP.Services;

public enum AppLockCredentialStatus
{
    NotSet,
    Set,
    Error
}

public enum WindowsHelloAvailabilityStatus
{
    Available,
    Unavailable,
    Error
}

public enum WindowsHelloVerificationStatus
{
    Verified,
    Unavailable,
    Failed,
    Error
}

public readonly record struct WindowsHelloVerificationOutcome(
    WindowsHelloVerificationStatus Status,
    UserConsentVerificationResult? Result = null);
