using WinOTP.Models;

namespace WinOTP.Helpers;

public static class OtpAccountSortPolicy
{
    public static IReadOnlyList<OtpAccount> Apply(
        IEnumerable<OtpAccount> accounts,
        SortOption sortOption,
        IEnumerable<string>? customOrderIds,
        IReadOnlyDictionary<string, (long Count, DateTime LastUsed)>? usageSnapshot = null)
    {
        return sortOption switch
        {
            SortOption.DateAddedDesc => accounts.OrderByDescending(a => a.CreatedAt).ToList(),
            SortOption.DateAddedAsc => accounts.OrderBy(a => a.CreatedAt).ToList(),
            SortOption.AlphabeticalAsc => accounts.OrderBy(a => a.DisplayLabel).ToList(),
            SortOption.AlphabeticalDesc => accounts.OrderByDescending(a => a.DisplayLabel).ToList(),
            SortOption.CustomOrder => OtpAccountCustomOrderPolicy.Apply(accounts, customOrderIds),
            SortOption.UsageBased when usageSnapshot is not null => accounts
                .OrderByDescending(a => usageSnapshot.TryGetValue(a.Id, out var u) ? u.Count : 0L)
                .ThenByDescending(a => usageSnapshot.TryGetValue(a.Id, out var u) ? u.LastUsed : DateTime.MinValue)
                .ThenByDescending(a => a.CreatedAt)
                .ToList(),
            _ => accounts.OrderByDescending(a => a.CreatedAt).ToList(),
        };
    }
}
