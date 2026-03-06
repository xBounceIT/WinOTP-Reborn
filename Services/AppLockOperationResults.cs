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
    RemoteSession,
    Error
}

public enum WindowsHelloVerificationStatus
{
    Verified,
    Unavailable,
    RemoteSession,
    Failed,
    Error
}

public readonly record struct WindowsHelloVerificationOutcome(
    WindowsHelloVerificationStatus Status,
    UserConsentVerificationResult? Result = null);
