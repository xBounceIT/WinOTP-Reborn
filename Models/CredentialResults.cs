namespace WinOTP.Models;

public enum CredentialIssueCode
{
    RetrieveFailed,
    InvalidJson,
    InvalidData,
    VaultAccessFailed,
    UnexpectedError
}

public sealed class CredentialIssue
{
    public required CredentialIssueCode Code { get; init; }
    public required string CredentialId { get; init; }
    public required string Message { get; init; }
}

public sealed class LoadAccountsResult
{
    public IReadOnlyList<OtpAccount> Accounts { get; init; } = Array.Empty<OtpAccount>();
    public IReadOnlyList<CredentialIssue> Issues { get; init; } = Array.Empty<CredentialIssue>();
}

public enum VaultOperationErrorCode
{
    None,
    ValidationFailed,
    VaultAccessFailed,
    UnexpectedError
}

public sealed class VaultOperationResult
{
    public bool Success => ErrorCode == VaultOperationErrorCode.None;
    public VaultOperationErrorCode ErrorCode { get; init; } = VaultOperationErrorCode.None;
    public string Message { get; init; } = string.Empty;

    public static VaultOperationResult Ok() => new();

    public static VaultOperationResult Fail(VaultOperationErrorCode errorCode, string message) => new()
    {
        ErrorCode = errorCode,
        Message = message
    };
}
