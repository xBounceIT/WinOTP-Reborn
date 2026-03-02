namespace WinOTP.Models;

public enum BackupOperationErrorCode
{
    None,
    ValidationFailed,
    PasswordUnavailable,
    VaultAccessFailed,
    IncompleteData,
    FileAccessFailed,
    InvalidFormat,
    DecryptionFailed,
    UnexpectedError
}

public sealed class BackupPasswordOperationResult
{
    public bool Success => ErrorCode == BackupOperationErrorCode.None;
    public BackupOperationErrorCode ErrorCode { get; init; } = BackupOperationErrorCode.None;
    public string Message { get; init; } = string.Empty;

    public static BackupPasswordOperationResult Ok() => new();

    public static BackupPasswordOperationResult Fail(BackupOperationErrorCode errorCode, string message) => new()
    {
        ErrorCode = errorCode,
        Message = message
    };
}

public sealed class BackupOperationResult
{
    public bool Success => ErrorCode == BackupOperationErrorCode.None;
    public BackupOperationErrorCode ErrorCode { get; init; } = BackupOperationErrorCode.None;
    public string Message { get; init; } = string.Empty;
    public string FilePath { get; init; } = string.Empty;
    public int AccountCount { get; init; }

    public static BackupOperationResult Ok(string filePath, int accountCount, string message = "") => new()
    {
        FilePath = filePath,
        AccountCount = accountCount,
        Message = message
    };

    public static BackupOperationResult Fail(BackupOperationErrorCode errorCode, string message) => new()
    {
        ErrorCode = errorCode,
        Message = message
    };
}

public sealed class BackupImportResult
{
    public bool Success => ErrorCode == BackupOperationErrorCode.None;
    public BackupOperationErrorCode ErrorCode { get; init; } = BackupOperationErrorCode.None;
    public string Message { get; init; } = string.Empty;
    public int ImportedCount { get; init; }
    public int ReplacedCount { get; init; }
    public int SkippedCount { get; init; }
    public int FailedCount { get; init; }

    public static BackupImportResult Ok(int importedCount, int replacedCount, int skippedCount, int failedCount, string message = "") => new()
    {
        ImportedCount = importedCount,
        ReplacedCount = replacedCount,
        SkippedCount = skippedCount,
        FailedCount = failedCount,
        Message = message
    };

    public static BackupImportResult Fail(BackupOperationErrorCode errorCode, string message) => new()
    {
        ErrorCode = errorCode,
        Message = message
    };
}

public sealed class BackupFolderValidationResult
{
    public bool Success { get; init; }
    public string ResolvedPath { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;

    public static BackupFolderValidationResult Ok(string resolvedPath) => new()
    {
        Success = true,
        ResolvedPath = resolvedPath
    };

    public static BackupFolderValidationResult Fail(string message) => new()
    {
        Success = false,
        Message = message
    };
}
