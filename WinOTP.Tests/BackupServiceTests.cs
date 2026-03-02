using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Security.Credentials;
using WinOTP.Models;
using WinOTP.Services;
using Xunit;

namespace WinOTP.Tests;

public sealed class BackupServiceTests : IDisposable
{
    private readonly string _rootPath;
    private readonly string _defaultBackupDirectoryPath;

    public BackupServiceTests()
    {
        _rootPath = Path.Combine(Path.GetTempPath(), "WinOTP-BackupTests", Guid.NewGuid().ToString("N"));
        _defaultBackupDirectoryPath = Path.Combine(_rootPath, "DefaultBackups");
        Directory.CreateDirectory(_defaultBackupDirectoryPath);
    }

    [Fact]
    public async Task SetAutomaticBackupPasswordAsync_StoresAndClearsPassword()
    {
        var vault = new FakePasswordVault();
        var service = CreateService(vault: vault);

        var setResult = await service.SetAutomaticBackupPasswordAsync("backup-pass-1");
        var hasPassword = service.HasStoredAutomaticBackupPassword();
        var clearResult = await service.ClearAutomaticBackupPasswordAsync();

        Assert.True(setResult.Success);
        Assert.True(hasPassword);
        Assert.True(clearResult.Success);
        Assert.False(service.HasStoredAutomaticBackupPassword());
    }

    [Fact]
    public void GetEffectiveAutomaticBackupFolderPath_WithoutCustomPath_ReturnsDefaultFolder()
    {
        var service = CreateService();

        Assert.Equal(_defaultBackupDirectoryPath, service.GetEffectiveAutomaticBackupFolderPath());
    }

    [Fact]
    public void GetEffectiveAutomaticBackupFolderPath_WithCustomPath_ReturnsCustomFolder()
    {
        var customFolderPath = Path.Combine(_rootPath, "CustomBackups");
        var settings = new FakeAppSettingsService
        {
            CustomBackupFolderPath = customFolderPath
        };
        var service = CreateService(settings: settings);

        Assert.Equal(Path.GetFullPath(customFolderPath), service.GetEffectiveAutomaticBackupFolderPath());
    }

    [Fact]
    public async Task CreateAutomaticBackupAsync_CustomFolder_WritesBackupToCustomFolder()
    {
        var customFolderPath = Path.Combine(_rootPath, "CustomBackups");
        var settings = new FakeAppSettingsService
        {
            CustomBackupFolderPath = customFolderPath
        };
        var credentialManager = new FakeCredentialManagerService();
        credentialManager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: credentialManager, settings: settings);
        await service.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var result = await service.CreateAutomaticBackupAsync();

        Assert.True(result.Success);
        Assert.StartsWith(Path.GetFullPath(customFolderPath), result.FilePath, StringComparison.OrdinalIgnoreCase);
        Assert.Single(Directory.GetFiles(customFolderPath, "auto-*.wotpbackup"));
        Assert.Empty(Directory.GetFiles(_defaultBackupDirectoryPath, "auto-*.wotpbackup"));
    }

    [Fact]
    public async Task CreateAutomaticBackupAsync_PrunesToLastTwentyAutomaticFiles()
    {
        var manager = new FakeCredentialManagerService();
        manager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: manager);
        await service.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var manualPath = Path.Combine(_defaultBackupDirectoryPath, "manual-export.wotpbackup");
        var manualResult = await service.ExportBackupAsync(manualPath);

        for (int i = 0; i < 25; i++)
        {
            var result = await service.CreateAutomaticBackupAsync();
            Assert.True(result.Success);
        }

        var automaticFiles = Directory.GetFiles(_defaultBackupDirectoryPath, "auto-*.wotpbackup");

        Assert.True(manualResult.Success);
        Assert.Equal(20, automaticFiles.Length);
        Assert.True(File.Exists(manualPath));
    }

    [Fact]
    public async Task CreateAutomaticBackupAsync_WhenRunConcurrently_WritesDistinctAutomaticBackups()
    {
        var manager = new FakeCredentialManagerService();
        manager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: manager);
        await service.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var results = await Task.WhenAll(
            service.CreateAutomaticBackupAsync(),
            service.CreateAutomaticBackupAsync());

        Assert.All(results, result => Assert.True(result.Success));

        var automaticFiles = Directory.GetFiles(_defaultBackupDirectoryPath, "auto-*.wotpbackup");

        Assert.Equal(2, automaticFiles.Length);
        Assert.Equal(2, automaticFiles.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public async Task ExportBackupAsync_ThenImportBackupAsync_RoundTripsAccounts()
    {
        var credentialManager = new FakeCredentialManagerService();
        credentialManager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP",
            Algorithm = OtpAlgorithm.SHA256,
            Digits = 8,
            Period = 45,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        });

        var sourceService = CreateService(credentialManager: credentialManager);
        await sourceService.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var exportPath = Path.Combine(_rootPath, "manual.wotpbackup");
        var exportResult = await sourceService.ExportBackupAsync(exportPath);

        var importManager = new FakeCredentialManagerService();
        var importService = CreateService(credentialManager: importManager);
        var importResult = await importService.ImportBackupAsync(exportPath, "backup-pass-1");
        var importedAccounts = (await importManager.LoadAccountsAsync()).Accounts;

        Assert.True(exportResult.Success);
        Assert.True(importResult.Success);
        Assert.Single(importedAccounts);
        Assert.Equal("acct-1", importedAccounts[0].Id);
        Assert.Equal("ACME", importedAccounts[0].Issuer);
        Assert.Equal(8, importedAccounts[0].Digits);
        Assert.Equal(45, importedAccounts[0].Period);
    }

    [Fact]
    public async Task ImportBackupAsync_WrongPassword_FailsWithoutWrites()
    {
        var credentialManager = new FakeCredentialManagerService();
        credentialManager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var sourceService = CreateService(credentialManager: credentialManager);
        var exportPath = Path.Combine(_rootPath, "wrong-password.wotpbackup");
        var exportResult = await sourceService.ExportBackupAsync(exportPath, "backup-pass-1");

        var importManager = new FakeCredentialManagerService();
        var importService = CreateService(credentialManager: importManager);
        var importResult = await importService.ImportBackupAsync(exportPath, "backup-pass-2");

        Assert.True(exportResult.Success);
        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.DecryptionFailed, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_SameId_ReplacesExistingAccount()
    {
        var exportManager = new FakeCredentialManagerService();
        exportManager.SaveAccount(new OtpAccount
        {
            Id = "shared-id",
            Issuer = "New Issuer",
            AccountName = "new@example.com",
            Secret = "JBSWY3DPEHPK3PXP",
            Digits = 8
        });

        var exportService = CreateService(credentialManager: exportManager);
        var exportPath = Path.Combine(_rootPath, "replace.wotpbackup");
        await exportService.ExportBackupAsync(exportPath, "backup-pass-1");

        var importManager = new FakeCredentialManagerService();
        importManager.SaveAccount(new OtpAccount
        {
            Id = "shared-id",
            Issuer = "Old Issuer",
            AccountName = "old@example.com",
            Secret = "JBSWY3DPEHPK3PXP",
            Digits = 6
        });

        var importService = CreateService(credentialManager: importManager);
        var result = await importService.ImportBackupAsync(exportPath, "backup-pass-1");
        var account = Assert.Single((await importManager.LoadAccountsAsync()).Accounts);

        Assert.True(result.Success);
        Assert.Equal(1, result.ReplacedCount);
        Assert.Equal("New Issuer", account.Issuer);
        Assert.Equal("new@example.com", account.AccountName);
        Assert.Equal(8, account.Digits);
    }

    [Fact]
    public async Task ExportBackupAsync_UsesStoredPasswordWhenOverrideMissing()
    {
        var manager = new FakeCredentialManagerService();
        manager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: manager);
        await service.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var exportPath = Path.Combine(_rootPath, "stored-password.wotpbackup");
        var exportResult = await service.ExportBackupAsync(exportPath);
        var importResult = await CreateService(credentialManager: new FakeCredentialManagerService()).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.True(exportResult.Success);
        Assert.True(importResult.Success);
    }

    [Fact]
    public async Task ImportBackupAsync_UnsupportedVersion_Fails()
    {
        var manager = new FakeCredentialManagerService();
        manager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: manager);
        var exportPath = Path.Combine(_rootPath, "versioned.wotpbackup");
        var exportResult = await service.ExportBackupAsync(exportPath, "backup-pass-1");
        Assert.True(exportResult.Success);

        var json = await File.ReadAllTextAsync(exportPath);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var modified = new Dictionary<string, object?>
        {
            ["format"] = root.GetProperty("format").GetString(),
            ["version"] = 2,
            ["createdAtUtc"] = root.GetProperty("createdAtUtc").GetDateTime(),
            ["accountCount"] = root.GetProperty("accountCount").GetInt32(),
            ["ciphertext"] = root.GetProperty("ciphertext").GetString(),
            ["encryption"] = JsonSerializer.Deserialize<Dictionary<string, object?>>(root.GetProperty("encryption").GetRawText())
        };
        await File.WriteAllTextAsync(exportPath, JsonSerializer.Serialize(modified));

        var importResult = await CreateService(credentialManager: new FakeCredentialManagerService()).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
    }

    [Fact]
    public async Task ImportBackupAsync_UnsupportedLowerIterationCount_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("unsupported-lower-iterations.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["iterations"] = 100000;
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_ExcessiveIterationCount_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("unsupported-high-iterations.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["iterations"] = 150001;
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_InvalidSaltBase64_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("invalid-salt-base64.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["salt"] = "***";
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_InvalidSaltLength_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("invalid-salt-length.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["salt"] = Convert.ToBase64String(new byte[8]);
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_InvalidNonceLength_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("invalid-nonce-length.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["nonce"] = Convert.ToBase64String(new byte[8]);
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_InvalidTagLength_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("invalid-tag-length.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            ((JsonObject)root["encryption"]!)["tag"] = Convert.ToBase64String(new byte[8]);
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ImportBackupAsync_EmptyCiphertext_ReturnsInvalidFormatWithoutWrites()
    {
        var exportPath = await CreateValidBackupAsync("empty-ciphertext.wotpbackup");
        await MutateBackupAsync(exportPath, root =>
        {
            root["ciphertext"] = string.Empty;
        });

        var importManager = new FakeCredentialManagerService();
        var importResult = await CreateService(credentialManager: importManager).ImportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(importResult.Success);
        Assert.Equal(BackupOperationErrorCode.InvalidFormat, importResult.ErrorCode);
        Assert.Empty((await importManager.LoadAccountsAsync()).Accounts);
    }

    [Fact]
    public async Task ExportBackupAsync_WhenLoadAccountsHasNonVaultIssues_FailsWithoutWritingFile()
    {
        var credentialManager = new FakeCredentialManagerService
        {
            Issues =
            [
                new CredentialIssue
                {
                    Code = CredentialIssueCode.RetrieveFailed,
                    CredentialId = "acct-1",
                    Message = "Failed to retrieve account."
                }
            ]
        };
        var service = CreateService(credentialManager: credentialManager);
        var exportPath = Path.Combine(_rootPath, "incomplete-export.wotpbackup");

        var result = await service.ExportBackupAsync(exportPath, "backup-pass-1");

        Assert.False(result.Success);
        Assert.Equal(BackupOperationErrorCode.IncompleteData, result.ErrorCode);
        Assert.False(File.Exists(exportPath));
    }

    [Fact]
    public async Task CreateAutomaticBackupAsync_WhenLoadAccountsHasNonVaultIssues_FailsWithoutWritingFile()
    {
        var credentialManager = new FakeCredentialManagerService
        {
            Issues =
            [
                new CredentialIssue
                {
                    Code = CredentialIssueCode.InvalidJson,
                    CredentialId = "acct-1",
                    Message = "Stored payload is invalid."
                }
            ]
        };
        var service = CreateService(credentialManager: credentialManager);
        await service.SetAutomaticBackupPasswordAsync("backup-pass-1");

        var result = await service.CreateAutomaticBackupAsync();

        Assert.False(result.Success);
        Assert.Equal(BackupOperationErrorCode.IncompleteData, result.ErrorCode);
        Assert.Empty(Directory.GetFiles(_defaultBackupDirectoryPath, "auto-*.wotpbackup"));
    }

    [Fact]
    public void ValidateAutomaticBackupFolder_RelativePath_Fails()
    {
        var service = CreateService();

        var result = service.ValidateAutomaticBackupFolder("relative\\folder");

        Assert.False(result.Success);
        Assert.Equal("Backup folder path must be an absolute path.", result.Message);
    }

    [Fact]
    public void ValidateAutomaticBackupFolder_FilePath_Fails()
    {
        var service = CreateService();
        var filePath = Path.Combine(_rootPath, "backup-file.txt");
        File.WriteAllText(filePath, "content");

        var result = service.ValidateAutomaticBackupFolder(filePath);

        Assert.False(result.Success);
        Assert.Equal("The selected backup folder points to a file, not a folder.", result.Message);
    }

    [Fact]
    public void ValidateAutomaticBackupFolder_WhenWriteFails_ReturnsFailure()
    {
        var service = CreateService(fileSystem: new FaultingFileSystem(_defaultBackupDirectoryPath));

        var result = service.ValidateAutomaticBackupFolder(_defaultBackupDirectoryPath);

        Assert.False(result.Success);
        Assert.Equal("WinOTP could not write to the selected backup folder.", result.Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(_rootPath))
        {
            Directory.Delete(_rootPath, true);
        }
    }

    private BackupService CreateService(
        FakeCredentialManagerService? credentialManager = null,
        FakeAppSettingsService? settings = null,
        FakePasswordVault? vault = null,
        FakeLogger? logger = null,
        BackupService.IFileSystem? fileSystem = null)
    {
        return new BackupService(
            credentialManager ?? new FakeCredentialManagerService(),
            settings ?? new FakeAppSettingsService(),
            logger ?? new FakeLogger(),
            vault ?? new FakePasswordVault(),
            fileSystem ?? new BackupService.FileSystemAdapter(),
            _defaultBackupDirectoryPath);
    }

    private async Task<string> CreateValidBackupAsync(string fileName, string password = "backup-pass-1")
    {
        var credentialManager = new FakeCredentialManagerService();
        credentialManager.SaveAccount(new OtpAccount
        {
            Id = "acct-1",
            Issuer = "ACME",
            AccountName = "jdoe@example.com",
            Secret = "JBSWY3DPEHPK3PXP"
        });

        var service = CreateService(credentialManager: credentialManager);
        var exportPath = Path.Combine(_rootPath, fileName);
        var exportResult = await service.ExportBackupAsync(exportPath, password);
        Assert.True(exportResult.Success);
        return exportPath;
    }

    private static async Task MutateBackupAsync(string backupPath, Action<JsonObject> mutate)
    {
        var node = JsonNode.Parse(await File.ReadAllTextAsync(backupPath))?.AsObject();
        Assert.NotNull(node);
        mutate(node!);
        await File.WriteAllTextAsync(backupPath, node.ToJsonString());
    }

    private sealed class FakeAppSettingsService : IAppSettingsService
    {
        public bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
        public bool IsPinProtectionEnabled { get; set; }
        public bool IsPasswordProtectionEnabled { get; set; }
        public bool IsWindowsHelloEnabled { get; set; }
        public int AutoLockTimeoutMinutes { get; set; }
        public bool IsAutomaticBackupEnabled { get; set; }
        public string CustomBackupFolderPath { get; set; } = string.Empty;
        public bool IsUpdateCheckEnabled { get; set; } = true;
        public UpdateChannel UpdateChannel { get; set; } = UpdateChannel.Stable;
        public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged
        {
            add { }
            remove { }
        }
    }

    private sealed class FakeCredentialManagerService : ICredentialManagerService
    {
        private readonly Dictionary<string, OtpAccount> _accounts = new(StringComparer.Ordinal);
        public IReadOnlyList<CredentialIssue> Issues { get; set; } = Array.Empty<CredentialIssue>();

        public Task<LoadAccountsResult> LoadAccountsAsync()
        {
            return Task.FromResult(new LoadAccountsResult
            {
                Accounts = _accounts.Values
                    .OrderBy(a => a.Id)
                    .Select(Clone)
                    .ToList(),
                Issues = Issues
            });
        }

        public Task<VaultOperationResult> SaveAccountAsync(OtpAccount account)
        {
            _accounts[account.Id] = Clone(account);
            return Task.FromResult(VaultOperationResult.Ok());
        }

        public Task<VaultOperationResult> DeleteAccountAsync(string id)
        {
            _accounts.Remove(id);
            return Task.FromResult(VaultOperationResult.Ok());
        }

        public void SaveAccount(OtpAccount account)
        {
            _accounts[account.Id] = Clone(account);
        }

        private static OtpAccount Clone(OtpAccount source)
        {
            return new OtpAccount
            {
                Id = source.Id,
                Issuer = source.Issuer,
                AccountName = source.AccountName,
                Secret = source.Secret,
                Algorithm = source.Algorithm,
                Digits = source.Digits,
                Period = source.Period,
                CreatedAt = source.CreatedAt
            };
        }
    }

    private sealed class FakePasswordVault : BackupService.IPasswordVaultAdapter
    {
        private readonly List<PasswordCredential> _credentials = [];

        public IReadOnlyList<PasswordCredential> FindAllByResource(string resource)
        {
            var matches = _credentials.Where(c => c.Resource == resource).ToList();
            if (matches.Count == 0)
            {
                throw new FakeElementNotFoundException();
            }

            return matches;
        }

        public void Add(PasswordCredential credential)
        {
            _credentials.Add(credential);
        }

        public void Remove(PasswordCredential credential)
        {
            _credentials.RemoveAll(c => c.Resource == credential.Resource && c.UserName == credential.UserName);
        }
    }

    private sealed class FakeLogger : IAppLogger
    {
        public void Error(string message, Exception? ex = null)
        {
        }

        public void Info(string message)
        {
        }

        public void Warn(string message)
        {
        }
    }

    private sealed class FaultingFileSystem : BackupService.IFileSystem
    {
        private readonly string _faultingDirectoryPath;

        public FaultingFileSystem(string faultingDirectoryPath)
        {
            _faultingDirectoryPath = Path.GetFullPath(faultingDirectoryPath);
            Directory.CreateDirectory(_faultingDirectoryPath);
        }

        public void CreateDirectory(string path)
        {
            Directory.CreateDirectory(path);
        }

        public void WriteAllText(string path, string contents)
        {
            if (Path.GetFullPath(path).StartsWith(_faultingDirectoryPath, StringComparison.OrdinalIgnoreCase))
            {
                throw new UnauthorizedAccessException("Write blocked for test.");
            }

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

    private sealed class FakeElementNotFoundException : Exception
    {
        public FakeElementNotFoundException()
            : base("Not found")
        {
            HResult = unchecked((int)0x80070490);
        }
    }
}
