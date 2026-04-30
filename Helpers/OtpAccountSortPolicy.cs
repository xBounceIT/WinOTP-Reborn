using WinOTP.Models;

namespace WinOTP.Helpers;

public static class OtpAccountSortPolicy
{
    public static IReadOnlyList<OtpAccount> Apply(
        IEnumerable<OtpAccount> accounts,
        SortOption sortOption,
        IEnumerable<string>? customOrderIds)
    {
        return sortOption switch
        {
            SortOption.DateAddedDesc => accounts.OrderByDescending(a => a.CreatedAt).ToList(),
            SortOption.DateAddedAsc => accounts.OrderBy(a => a.CreatedAt).ToList(),
            SortOption.AlphabeticalAsc => accounts.OrderBy(a => a.DisplayLabel).ToList(),
            SortOption.AlphabeticalDesc => accounts.OrderByDescending(a => a.DisplayLabel).ToList(),
            SortOption.CustomOrder => OtpAccountCustomOrderPolicy.Apply(accounts, customOrderIds),
            _ => accounts.OrderByDescending(a => a.CreatedAt).ToList(),
        };
    }
}
