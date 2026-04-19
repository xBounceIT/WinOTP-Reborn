using OtpNet;
using WinOTP.Models;

namespace WinOTP.Services;

public interface ITotpCodeGenerator
{
    string GenerateCode(OtpAccount account);
    string GenerateCodeAt(OtpAccount account, DateTime utcTimestamp);
    int GetRemainingSeconds(OtpAccount account);
}

public class TotpCodeGenerator : ITotpCodeGenerator
{
    private readonly Dictionary<(string AccountId, long Timestep), string> _cache = new();

    public string GenerateCode(OtpAccount account)
    {
        return GenerateCodeAt(account, DateTime.UtcNow);
    }

    public string GenerateCodeAt(OtpAccount account, DateTime utcTimestamp)
    {
        try
        {
            var normalizedTimestamp = utcTimestamp.Kind switch
            {
                DateTimeKind.Utc => utcTimestamp,
                DateTimeKind.Local => utcTimestamp.ToUniversalTime(),
                _ => DateTime.SpecifyKind(utcTimestamp, DateTimeKind.Utc)
            };

            var timestep = new DateTimeOffset(normalizedTimestamp).ToUnixTimeSeconds() / account.Period;

            var cacheKey = (account.Id, timestep);
            if (_cache.TryGetValue(cacheKey, out var cachedCode))
            {
                return cachedCode;
            }

            var secret = Base32Encoding.ToBytes(account.Secret);
            var totp = new Totp(secret,
                step: account.Period,
                totpSize: account.Digits,
                mode: GetHashMode(account.Algorithm));

            var code = totp.ComputeTotp(normalizedTimestamp);
            _cache[cacheKey] = code;
            _cache.Remove((account.Id, timestep - 2));
            return code;
        }
        catch
        {
            return "000000";
        }
    }

    public int GetRemainingSeconds(OtpAccount account)
    {
        try
        {
            if (account.Period <= 0) return 0;
            var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var timeStep = unixTime / account.Period;
            var nextTimeStep = (timeStep + 1) * account.Period;
            var remaining = (int)(nextTimeStep - unixTime);
            return remaining;
        }
        catch
        {
            return 0;
        }
    }

    private static OtpHashMode GetHashMode(OtpAlgorithm algorithm)
    {
        return algorithm switch
        {
            OtpAlgorithm.SHA1 => OtpHashMode.Sha1,
            OtpAlgorithm.SHA256 => OtpHashMode.Sha256,
            OtpAlgorithm.SHA512 => OtpHashMode.Sha512,
            _ => OtpHashMode.Sha1
        };
    }
}
