using WinOTP.Models;

namespace WinOTP.Helpers;

public static class OtpAccountCustomOrderPolicy
{
    public static IReadOnlyList<OtpAccount> Apply(
        IEnumerable<OtpAccount> accounts,
        IEnumerable<string>? savedOrderIds)
    {
        var accountList = accounts.ToList();
        var accountById = accountList
            .Where(a => !string.IsNullOrWhiteSpace(a.Id))
            .GroupBy(a => a.Id, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);

        var ordered = new List<OtpAccount>();
        var usedIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var id in savedOrderIds ?? [])
        {
            if (string.IsNullOrWhiteSpace(id) || !usedIds.Add(id))
            {
                continue;
            }

            if (accountById.TryGetValue(id, out var account))
            {
                ordered.Add(account);
            }
        }

        ordered.AddRange(accountList
            .Where(a => string.IsNullOrWhiteSpace(a.Id) || !usedIds.Contains(a.Id))
            .OrderByDescending(a => a.CreatedAt));

        return ordered;
    }
}
