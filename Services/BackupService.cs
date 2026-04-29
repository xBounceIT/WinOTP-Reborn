using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Windows.Security.Credentials;
using WinOTP.Helpers;
using WinOTP.Models;

namespace WinOTP.Services;

public interface IBackupService
{
    string GetDefaultBackupFolderPath();
    string GetEffectiveAutomaticBackupFolderPath();
    BackupFolderValidationResult ValidateAutomaticBackupFolder(string folderPath);
    bool HasStoredAutomaticBackupPassword();
    Task<BackupPasswordOperationResult> SetAutomaticBackupPasswordAsync(string password);
    Task<BackupPasswordOperationResult> ClearAutomaticBackupPasswordAsync();
    Task<BackupOperationResult> CreateAutomaticBackupAsync();
    Task<BackupOperationResult> ExportBackupAsync(string destinationFilePath, string? passwordOverride = null);
    Task<BackupImportResult> ImportBackupAsync(
        string sourceFilePath,
        string password,
        IProgress<(int current, int total)>? progress = null);
}

public sealed class BackupService : IBackupService
{
    private const string BackupPasswordResource = "WinOTP_Backup";
    private const string BackupPasswordKey = "BackupPassword";
    private const string BackupExtension = ".wotpbackup";
    private const string AutomaticBackupPrefix = "auto-";
    private const int BackupHistoryLimit = 20;
    private const int ElementNotFoundHResult = unchecked((int)0x80070490);
    private const int MinimumPasswordLength = 8;
    private const int KeySizeBytes = 32;
    private const int SaltSizeBytes = 16;
    private const int NonceSizeBytes = 12;
    private const int TagSizeBytes = 16;
    private const int Iterations = 150000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ICredentialManagerService _credentialManager;
    private readonly IAppSettingsService _appSettings;
    private readonly IAppLogger _logger;
    private readonly IPasswordVaultAdapter _vault;
    private readonly IFileSystem _fileSystem;
    private readonly string _defaultBackupDirectoryPath;
    private readonly SemaphoreSlim _automaticBackupSemaphore = new(1, 1);

    private sealed record DecodedBackupEnvelope(
        byte[] Salt,
        byte[] Nonce,
        byte[] Tag,
        byte[] Ciphertext,
        int Iterations);

    public BackupService(ICredentialManagerService credentialManager, IAppSettingsService appSettings, IAppLogger logger)
        : this(credentialManager, appSettings, logger, new PasswordVaultAdapter(new PasswordVault()), new FileSystemAdapter(), AppPaths.GetBackupDirectory())
    {
    }

    internal BackupService(
        ICredentialManagerService credentialManager,
        IAppSettingsService appSettings,
        IAppLogger logger,
        IPasswordVaultAdapter vault,
        IFileSystem fileSystem,
        string defaultBackupDirectoryPath)
    {
        _credentialManager = credentialManager;
        _appSettings = appSettings;
        _logger = logger;
        _vault = vault;
        _fileSystem = fileSystem;
        _defaultBackupDirectoryPath = defaultBackupDirectoryPath;
    }

    public string GetDefaultBackupFolderPath() => _defaultBackupDirectoryPath;

    public string GetEffectiveAutomaticBackupFolderPath()
    {
        var customPath = _appSettings.CustomBackupFolderPath?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(customPath))
        {
            return _defaultBackupDirectoryPath;
        }

        if (Path.IsPathRooted(customPath))
        {
            try
            {
                return Path.GetFullPath(customPath);
            }
            catch
            {
                return customPath;
            }
        }

        return customPath;
    }

    public BackupFolderValidationResult ValidateAutomaticBackupFolder(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath))
        {
            return BackupFolderValidationResult.Fail("Backup folder path is required.");
        }

        var trimmedPath = folderPath.Trim();
        if (!Path.IsPathRooted(trimmedPath))
        {
            return BackupFolderValidationResult.Fail("Backup folder path must be an absolute path.");
        }

        string normalizedPath;
        try
        {
            normalizedPath = Path.GetFullPath(trimmedPath);
        }
        catch (Exception ex)
        {
            _logger.Warn($"Backup folder path '{trimmedPath}' is invalid: {ex.Message}");
            return BackupFolderValidationResult.Fail("The selected backup folder path is invalid.");
        }

        if (_fileSystem.FileExists(normalizedPath))
        {
            return BackupFolderValidationResult.Fail("The selected backup folder points to a file, not a folder.");
        }

        try
        {
            _fileSystem.CreateDirectory(normalizedPath);
            var probeFilePath = Path.Combine(normalizedPath, $".winotp-probe-{Guid.NewGuid():N}.tmp");
            _fileSystem.WriteAllText(probeFilePath, "probe");
            _fileSystem.DeleteFile(probeFilePath);
            return BackupFolderValidationResult.Ok(normalizedPath);
        }
        catch (Exception ex)
        {
            _logger.Warn($"Backup folder '{normalizedPath}' is not writable: {ex.Message}");
            return BackupFolderValidationResult.Fail("WinOTP could not write to the selected backup folder.");
        }
    }

    public bool HasStoredAutomaticBackupPassword()
    {
        try
        {
            return _vault.FindAllByResource(BackupPasswordResource)
                .Any(c => c.UserName == BackupPasswordKey);
        }
        catch (Exception ex) when (ex.HResult == ElementNotFoundHResult)
        {
            return false;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to query the backup password from Windows Credential Manager.", ex);
            return false;
        }
    }

    public Task<BackupPasswordOperationResult> SetAutomaticBackupPasswordAsync(string password)
    {
        if (!IsValidBackupPassword(password))
        {
            return Task.FromResult(BackupPasswordOperationResult.Fail(
                BackupOperationErrorCode.ValidationFailed,
                $"Backup password must be at least {MinimumPasswordLength} characters."));
        }

        try
        {
            RemoveStoredPassword();
            _vault.Add(new PasswordCredential(BackupPasswordResource, BackupPasswordKey, password));
            return Task.FromResult(BackupPasswordOperationResult.Ok());
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to store the backup password.", ex);
            return Task.FromResult(BackupPasswordOperationResult.Fail(
                BackupOperationErrorCode.VaultAccessFailed,
                "Failed to store the backup password."));
        }
    }

    public Task<BackupPasswordOperationResult> ClearAutomaticBackupPasswordAsync()
    {
        try
        {
            RemoveStoredPassword();
            return Task.FromResult(BackupPasswordOperationResult.Ok());
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to clear the backup password.", ex);
            return Task.FromResult(BackupPasswordOperationResult.Fail(
                BackupOperationErrorCode.VaultAccessFailed,
                "Failed to clear the backup password."));
        }
    }

    public async Task<BackupOperationResult> CreateAutomaticBackupAsync()
    {
        var password = GetStoredPassword();
        if (string.IsNullOrWhiteSpace(password))
        {
            return BackupOperationResult.Fail(
                BackupOperationErrorCode.PasswordUnavailable,
                "Automatic backup is enabled, but no stored backup password is available.");
        }

        var folderValidation = ValidateAutomaticBackupFolder(GetEffectiveAutomaticBackupFolderPath());
        if (!folderValidation.Success)
        {
            return BackupOperationResult.Fail(BackupOperationErrorCode.FileAccessFailed, folderValidation.Message);
        }

        return await Task.Run(async () =>
        {
            await _automaticBackupSemaphore.WaitAsync().ConfigureAwait(false);
            try
            {
                var timestamp = DateTime.UtcNow;
                var fileName = $"{AutomaticBackupPrefix}{timestamp:yyyyMMddTHHmmssZ}{BackupExtension}";
                var destinationPath = GetUniquePath(Path.Combine(folderValidation.ResolvedPath, fileName));

                var result = await ExportBackupCoreAsync(destinationPath, password).ConfigureAwait(false);
                if (!result.Success)
                {
                    return result;
                }

                PruneAutomaticBackups(folderValidation.ResolvedPath);
                return result;
            }
            finally
            {
                _automaticBackupSemaphore.Release();
            }
        }).ConfigureAwait(false);
    }

    public Task<BackupOperationResult> ExportBackupAsync(string destinationFilePath, string? passwordOverride = null)
    {
        var password = string.IsNullOrWhiteSpace(passwordOverride)
            ? GetStoredPassword()
            : passwordOverride;

        if (string.IsNullOrWhiteSpace(password))
        {
            return Task.FromResult(BackupOperationResult.Fail(
                BackupOperationErrorCode.PasswordUnavailable,
                "A backup password is required to export a backup."));
        }

        return ExportBackupCoreAsync(destinationFilePath, password);
    }

    public async Task<BackupImportResult> ImportBackupAsync(
        string sourceFilePath,
        string password,
        IProgress<(int current, int total)>? progress = null)
    {
        if (string.IsNullOrWhiteSpace(sourceFilePath))
        {
            return BackupImportResult.Fail(BackupOperationErrorCode.ValidationFailed, "Backup file path is required.");
        }

        if (!IsValidBackupPassword(password))
        {
            return BackupImportResult.Fail(
                BackupOperationErrorCode.ValidationFailed,
                $"Backup password must be at least {MinimumPasswordLength} characters.");
        }

        string json;
        try
        {
            json = _fileSystem.ReadAllText(sourceFilePath);
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to read backup file '{sourceFilePath}'.", ex);
            return BackupImportResult.Fail(BackupOperationErrorCode.FileAccessFailed, "Failed to read the backup file.");
        }

        BackupEnvelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<BackupEnvelope>(json, JsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.Error($"Backup file '{sourceFilePath}' is not valid JSON.", ex);
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file is not valid.");
        }

        if (envelope == null)
        {
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file format is not supported.");
        }

        if (!HasSupportedIterations(envelope))
        {
            _logger.Warn($"Backup file '{sourceFilePath}' uses unsupported PBKDF2 iteration count '{envelope.Encryption?.Iterations}'.");
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file format is not supported.");
        }

        if (!IsSupportedEnvelope(envelope))
        {
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file format is not supported.");
        }

        if (!TryDecodeEnvelope(envelope, out var decodedEnvelope))
        {
            _logger.Warn($"Backup file '{sourceFilePath}' contains invalid encryption metadata.");
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file is corrupted.");
        }

        BackupPayload? payload;
        try
        {
            payload = DecryptPayload(decodedEnvelope, password);
        }
        catch (CryptographicException ex)
        {
            _logger.Error($"Failed to decrypt backup file '{sourceFilePath}'.", ex);
            return BackupImportResult.Fail(BackupOperationErrorCode.DecryptionFailed, "Backup password is incorrect or the file is corrupted.");
        }
        catch (ArgumentException ex)
        {
            _logger.Error($"Backup file '{sourceFilePath}' contains invalid encryption data.", ex);
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file is corrupted.");
        }
        catch (JsonException ex)
        {
            _logger.Error($"Backup payload '{sourceFilePath}' is not valid JSON.", ex);
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file payload is invalid.");
        }

        if (payload == null)
        {
            return BackupImportResult.Fail(BackupOperationErrorCode.InvalidFormat, "The backup file does not contain any payload.");
        }

        var existingAccountsResult = await _credentialManager.LoadAccountsAsync();
        if (HasVaultFailure(existingAccountsResult.Issues))
        {
            return BackupImportResult.Fail(
                BackupOperationErrorCode.VaultAccessFailed,
                "Unable to access Windows Credential Manager while importing tokens.");
        }

        var existingIds = existingAccountsResult.Accounts
            .Select(a => a.Id)
            .ToHashSet(StringComparer.Ordinal);

        int importedCount = 0;
        int replacedCount = 0;
        int skippedCount = 0;
        int failedCount = 0;

        var accountsToImport = payload.Accounts ?? [];
        int total = accountsToImport.Count;

        for (int i = 0; i < total; i++)
        {
            var source = accountsToImport[i];
            var saveResult = await _credentialManager.SaveAccountAsync(source);
            if (!saveResult.Success)
            {
                if (saveResult.ErrorCode == VaultOperationErrorCode.ValidationFailed)
                {
                    skippedCount++;
                    _logger.Warn($"Skipped invalid backup account '{source.Id}'.");
                }
                else
                {
                    failedCount++;
                    _logger.Error($"Failed to import backup account '{source.Id}': {saveResult.Message}");
                }
            }
            else
            {
                var persistedId = saveResult.PersistedId!;
                if (existingIds.Contains(persistedId))
                {
                    replacedCount++;
                }
                else
                {
                    existingIds.Add(persistedId);
                }

                importedCount++;
            }

            progress?.Report((i + 1, total));
        }

        _logger.Info($"Imported backup '{sourceFilePath}' with {importedCount} account(s), {replacedCount} replacement(s), {skippedCount} skipped, {failedCount} failed.");

        return BackupImportResult.Ok(
            importedCount,
            replacedCount,
            skippedCount,
            failedCount,
            "Import completed.");
    }

    private async Task<BackupOperationResult> ExportBackupCoreAsync(string destinationFilePath, string password)
    {
        if (string.IsNullOrWhiteSpace(destinationFilePath))
        {
            return BackupOperationResult.Fail(BackupOperationErrorCode.ValidationFailed, "Backup file path is required.");
        }

        if (!IsValidBackupPassword(password))
        {
            return BackupOperationResult.Fail(
                BackupOperationErrorCode.ValidationFailed,
                $"Backup password must be at least {MinimumPasswordLength} characters.");
        }

        var loadResult = await _credentialManager.LoadAccountsAsync();
        if (HasVaultFailure(loadResult.Issues))
        {
            return BackupOperationResult.Fail(
                BackupOperationErrorCode.VaultAccessFailed,
                "Unable to access Windows Credential Manager while exporting tokens.");
        }

        if (loadResult.Issues.Count > 0)
        {
            var issueSummary = string.Join(", ", loadResult.Issues
                .Select(issue => $"{issue.Code}:{issue.CredentialId}"));
            _logger.Warn($"Backup export aborted because {loadResult.Issues.Count} credential issue(s) were detected while loading accounts. {issueSummary}");
            return BackupOperationResult.Fail(
                BackupOperationErrorCode.IncompleteData,
                "Backup could not be created because one or more saved accounts could not be read. Resolve the affected accounts and try again.");
        }

        var payload = new BackupPayload
        {
            Source = "WinOTP-Reborn",
            ExportedAtUtc = DateTime.UtcNow,
            Accounts = loadResult.Accounts.ToList()
        };

        var envelope = EncryptPayload(payload, password);
        var json = JsonSerializer.Serialize(envelope, JsonOptions);

        try
        {
            var directory = Path.GetDirectoryName(destinationFilePath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                _fileSystem.CreateDirectory(directory);
            }

            _fileSystem.WriteAllText(destinationFilePath, json);
            _logger.Info($"Created backup '{destinationFilePath}' with {loadResult.Accounts.Count} account(s).");
            return BackupOperationResult.Ok(destinationFilePath, loadResult.Accounts.Count, "Backup created.");
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to write backup file '{destinationFilePath}'.", ex);
            return BackupOperationResult.Fail(BackupOperationErrorCode.FileAccessFailed, "Failed to write the backup file.");
        }
    }

    private void PruneAutomaticBackups(string backupDirectoryPath)
    {
        try
        {
            if (!_fileSystem.DirectoryExists(backupDirectoryPath))
            {
                return;
            }

            var automaticBackups = _fileSystem.GetFiles(backupDirectoryPath, $"{AutomaticBackupPrefix}*{BackupExtension}")
                .Select(path => new FileInfo(path))
                .OrderByDescending(info => info.LastWriteTimeUtc)
                .ToList();

            foreach (var file in automaticBackups.Skip(BackupHistoryLimit))
            {
                try
                {
                    _fileSystem.DeleteFile(file.FullName);
                }
                catch (Exception ex)
                {
                    _logger.Warn($"Failed to prune old backup '{file.FullName}': {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.Warn($"Failed to enumerate automatic backups for pruning: {ex.Message}");
        }
    }

    private string? GetStoredPassword()
    {
        try
        {
            var credential = _vault.FindAllByResource(BackupPasswordResource)
                .FirstOrDefault(c => c.UserName == BackupPasswordKey);

            if (credential == null)
            {
                return null;
            }

            credential.RetrievePassword();
            return credential.Password;
        }
        catch (Exception ex) when (ex.HResult == ElementNotFoundHResult)
        {
            return null;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to read the backup password from Windows Credential Manager.", ex);
            return null;
        }
    }

    private void RemoveStoredPassword()
    {
        try
        {
            var credential = _vault.FindAllByResource(BackupPasswordResource)
                .FirstOrDefault(c => c.UserName == BackupPasswordKey);

            if (credential != null)
            {
                _vault.Remove(credential);
            }
        }
        catch (Exception ex) when (ex.HResult == ElementNotFoundHResult)
        {
        }
    }

    private static bool HasVaultFailure(IReadOnlyList<CredentialIssue> issues)
    {
        return issues.Any(i => i.Code == CredentialIssueCode.VaultAccessFailed);
    }

    private static bool IsValidBackupPassword(string? password)
    {
        return !string.IsNullOrWhiteSpace(password) && password.Length >= MinimumPasswordLength;
    }

    private static bool IsSupportedEnvelope(BackupEnvelope envelope)
    {
        return string.Equals(envelope.Format, "winotp-backup", StringComparison.Ordinal) &&
            envelope.Version == 1 &&
            envelope.Encryption != null &&
            string.Equals(envelope.Encryption.Scheme, "PBKDF2-SHA256-AES-256-GCM", StringComparison.Ordinal) &&
            envelope.Encryption.Iterations == Iterations &&
            !string.IsNullOrWhiteSpace(envelope.Ciphertext);
    }

    private static bool HasSupportedIterations(BackupEnvelope envelope)
    {
        return envelope.Version == 1 &&
            envelope.Encryption != null &&
            string.Equals(envelope.Encryption.Scheme, "PBKDF2-SHA256-AES-256-GCM", StringComparison.Ordinal) &&
            envelope.Encryption.Iterations == Iterations;
    }

    private static BackupEnvelope EncryptPayload(BackupPayload payload, string password)
    {
        var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);
        var plaintext = Encoding.UTF8.GetBytes(payloadJson);

        var salt = RandomNumberGenerator.GetBytes(SaltSizeBytes);
        var nonce = RandomNumberGenerator.GetBytes(NonceSizeBytes);
        var key = DeriveKey(password, salt, Iterations);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSizeBytes];

        using (var aesGcm = new AesGcm(key, TagSizeBytes))
        {
            aesGcm.Encrypt(nonce, plaintext, ciphertext, tag);
        }

        return new BackupEnvelope
        {
            Format = "winotp-backup",
            Version = 1,
            CreatedAtUtc = payload.ExportedAtUtc,
            AccountCount = payload.Accounts.Count,
            Encryption = new BackupEncryptionMetadata
            {
                Scheme = "PBKDF2-SHA256-AES-256-GCM",
                Iterations = Iterations,
                Salt = Convert.ToBase64String(salt),
                Nonce = Convert.ToBase64String(nonce),
                Tag = Convert.ToBase64String(tag)
            },
            Ciphertext = Convert.ToBase64String(ciphertext)
        };
    }

    private static bool TryDecodeEnvelope(BackupEnvelope envelope, out DecodedBackupEnvelope decodedEnvelope)
    {
        decodedEnvelope = null!;

        if (envelope.Encryption == null ||
            string.IsNullOrWhiteSpace(envelope.Encryption.Salt) ||
            string.IsNullOrWhiteSpace(envelope.Encryption.Nonce) ||
            string.IsNullOrWhiteSpace(envelope.Encryption.Tag) ||
            string.IsNullOrWhiteSpace(envelope.Ciphertext))
        {
            return false;
        }

        try
        {
            var salt = Convert.FromBase64String(envelope.Encryption.Salt);
            var nonce = Convert.FromBase64String(envelope.Encryption.Nonce);
            var tag = Convert.FromBase64String(envelope.Encryption.Tag);
            var ciphertext = Convert.FromBase64String(envelope.Ciphertext);

            if (salt.Length != SaltSizeBytes ||
                nonce.Length != NonceSizeBytes ||
                tag.Length != TagSizeBytes ||
                ciphertext.Length == 0)
            {
                return false;
            }

            decodedEnvelope = new DecodedBackupEnvelope(
                salt,
                nonce,
                tag,
                ciphertext,
                envelope.Encryption.Iterations);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static BackupPayload? DecryptPayload(DecodedBackupEnvelope envelope, string password)
    {
        var key = DeriveKey(password, envelope.Salt, envelope.Iterations);
        var plaintext = new byte[envelope.Ciphertext.Length];

        using (var aesGcm = new AesGcm(key, envelope.Tag.Length))
        {
            aesGcm.Decrypt(envelope.Nonce, envelope.Ciphertext, envelope.Tag, plaintext);
        }

        var payloadJson = Encoding.UTF8.GetString(plaintext);
        return JsonSerializer.Deserialize<BackupPayload>(payloadJson, JsonOptions);
    }

    private static byte[] DeriveKey(string password, byte[] salt, int iterations)
    {
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, KeySizeBytes);
    }

    private static string GetUniquePath(string basePath)
    {
        if (!File.Exists(basePath))
        {
            return basePath;
        }

        var directory = Path.GetDirectoryName(basePath) ?? string.Empty;
        var fileName = Path.GetFileNameWithoutExtension(basePath);
        var extension = Path.GetExtension(basePath);

        for (int index = 1; index < 1000; index++)
        {
            var candidate = Path.Combine(directory, $"{fileName}-{index}{extension}");
            if (!File.Exists(candidate))
            {
                return candidate;
            }
        }

        return Path.Combine(directory, $"{fileName}-{Guid.NewGuid():N}{extension}");
    }

    internal interface IPasswordVaultAdapter
    {
        IReadOnlyList<PasswordCredential> FindAllByResource(string resource);
        void Add(PasswordCredential credential);
        void Remove(PasswordCredential credential);
    }

    internal interface IFileSystem
    {
        void CreateDirectory(string path);
        void WriteAllText(string path, string contents);
        string ReadAllText(string path);
        bool DirectoryExists(string path);
        bool FileExists(string path);
        IReadOnlyList<string> GetFiles(string directoryPath, string searchPattern);
        void DeleteFile(string path);
    }

    internal sealed class PasswordVaultAdapter : IPasswordVaultAdapter
    {
        private readonly PasswordVault _vault;

        public PasswordVaultAdapter(PasswordVault vault)
        {
            _vault = vault;
        }

        public IReadOnlyList<PasswordCredential> FindAllByResource(string resource)
        {
            return _vault.FindAllByResource(resource);
        }

        public void Add(PasswordCredential credential)
        {
            _vault.Add(credential);
        }

        public void Remove(PasswordCredential credential)
        {
            _vault.Remove(credential);
        }
    }

    internal sealed class FileSystemAdapter : IFileSystem
    {
        public void CreateDirectory(string path)
        {
            Directory.CreateDirectory(path);
        }

        public void WriteAllText(string path, string contents)
        {
            File.WriteAllText(path, contents);
        }

        public string ReadAllText(string path)
        {
            return File.ReadAllText(path);
        }

        public bool DirectoryExists(string path)
        {
            return Directory.Exists(path);
        }

        public bool FileExists(string path)
        {
            return File.Exists(path);
        }

        public IReadOnlyList<string> GetFiles(string directoryPath, string searchPattern)
        {
            return Directory.GetFiles(directoryPath, searchPattern);
        }

        public void DeleteFile(string path)
        {
            File.Delete(path);
        }
    }

    internal sealed class BackupEnvelope
    {
        public string Format { get; set; } = string.Empty;
        public int Version { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public int AccountCount { get; set; }
        public BackupEncryptionMetadata? Encryption { get; set; }
        public string Ciphertext { get; set; } = string.Empty;
    }

    internal sealed class BackupEncryptionMetadata
    {
        public string Scheme { get; set; } = string.Empty;
        public int Iterations { get; set; }
        public string Salt { get; set; } = string.Empty;
        public string Nonce { get; set; } = string.Empty;
        public string Tag { get; set; } = string.Empty;
    }

    internal sealed class BackupPayload
    {
        public string Source { get; set; } = string.Empty;
        public DateTime ExportedAtUtc { get; set; }
        public List<OtpAccount> Accounts { get; set; } = [];
    }
}
