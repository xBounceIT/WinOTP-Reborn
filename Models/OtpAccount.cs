namespace WinOTP.Models;

public enum OtpAlgorithm
{
    SHA1,
    SHA256,
    SHA512
}

public enum SortOption
{
    DateAddedDesc,
    DateAddedAsc,
    AlphabeticalAsc,
    AlphabeticalDesc
}

public sealed class OtpAccount
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Issuer { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string Secret { get; set; } = string.Empty;
    public OtpAlgorithm Algorithm { get; set; } = OtpAlgorithm.SHA1;
    public int Digits { get; set; } = 6;
    public int Period { get; set; } = 30;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string DisplayLabel =>
        string.IsNullOrEmpty(Issuer) ? AccountName : $"{Issuer} ({AccountName})";

    public string ResourceKey => $"WinOTP:{Id}";
}
