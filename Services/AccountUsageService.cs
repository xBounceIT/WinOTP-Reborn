using System.Text.Json;
using WinOTP.Helpers;

namespace WinOTP.Services;

public interface IAccountUsageService
{
    long GetUsageCount(string accountId);
    DateTime? GetLastUsedAt(string accountId);
    void RecordUsage(string accountId);
    void PruneMissingAccounts(IEnumerable<string> existingAccountIds);
}

public sealed class AccountUsageService : IAccountUsageService
{
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = false
    };

    private readonly string _usageStatsFilePath;
    private Dictionary<string, AccountUsageEntry> _entries;

    public AccountUsageService()
        : this(AppPaths.GetUsageStatsFilePath())
    {
    }

    internal AccountUsageService(string usageStatsFilePath)
    {
        var directory = Path.GetDirectoryName(usageStatsFilePath) ?? AppPaths.GetAppDataDirectory();
        Directory.CreateDirectory(directory);
        _usageStatsFilePath = usageStatsFilePath;
        _entries = LoadEntries();
    }

    public long GetUsageCount(string accountId)
    {
        if (string.IsNullOrWhiteSpace(accountId))
        {
            return 0;
        }

        lock (Sync)
        {
            return _entries.TryGetValue(accountId, out var entry) ? entry.Count : 0;
        }
    }

    public DateTime? GetLastUsedAt(string accountId)
    {
        if (string.IsNullOrWhiteSpace(accountId))
        {
            return null;
        }

        lock (Sync)
        {
            return _entries.TryGetValue(accountId, out var entry) ? entry.LastUsedAt : null;
        }
    }

    public void RecordUsage(string accountId)
    {
        if (string.IsNullOrWhiteSpace(accountId))
        {
            return;
        }

        lock (Sync)
        {
            var existing = _entries.TryGetValue(accountId, out var entry) ? entry : new AccountUsageEntry();
            _entries[accountId] = new AccountUsageEntry
            {
                Count = existing.Count + 1,
                LastUsedAt = DateTime.UtcNow
            };
            SaveEntries();
        }
    }

    public void PruneMissingAccounts(IEnumerable<string> existingAccountIds)
    {
        var allowed = new HashSet<string>(existingAccountIds ?? [], StringComparer.Ordinal);

        lock (Sync)
        {
            var stale = _entries.Keys.Where(id => !allowed.Contains(id)).ToList();
            if (stale.Count == 0)
            {
                return;
            }

            foreach (var id in stale)
            {
                _entries.Remove(id);
            }

            SaveEntries();
        }
    }

    private Dictionary<string, AccountUsageEntry> LoadEntries()
    {
        lock (Sync)
        {
            if (!File.Exists(_usageStatsFilePath))
            {
                return new Dictionary<string, AccountUsageEntry>(StringComparer.Ordinal);
            }

            try
            {
                var json = File.ReadAllText(_usageStatsFilePath);
                var data = JsonSerializer.Deserialize<AccountUsageData>(json, SerializerOptions);
                if (data?.Entries is null)
                {
                    return new Dictionary<string, AccountUsageEntry>(StringComparer.Ordinal);
                }

                return new Dictionary<string, AccountUsageEntry>(data.Entries, StringComparer.Ordinal);
            }
            catch
            {
                return new Dictionary<string, AccountUsageEntry>(StringComparer.Ordinal);
            }
        }
    }

    private void SaveEntries()
    {
        try
        {
            var data = new AccountUsageData { Entries = _entries };
            var json = JsonSerializer.Serialize(data, SerializerOptions);
            File.WriteAllText(_usageStatsFilePath, json);
        }
        catch
        {
            // Ignore persistence errors to keep the app usable.
        }
    }

    private sealed class AccountUsageData
    {
        public Dictionary<string, AccountUsageEntry> Entries { get; set; } = new(StringComparer.Ordinal);
    }
}

internal sealed class AccountUsageEntry
{
    public long Count { get; init; }
    public DateTime? LastUsedAt { get; init; }
}
