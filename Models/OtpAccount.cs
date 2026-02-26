namespace WinOTP.Models;

public enum OtpAlgorithm
{
    SHA1,
    SHA256,
    SHA512
}

public sealed class OtpAccount
{
    public string Issuer { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string Secret { get; set; } = string.Empty;
    public OtpAlgorithm Algorithm { get; set; } = OtpAlgorithm.SHA1;
    public int Digits { get; set; } = 6;
    public int Period { get; set; } = 30;

    public string DisplayLabel =>
        string.IsNullOrEmpty(Issuer) ? AccountName : $"{Issuer} ({AccountName})";
}
