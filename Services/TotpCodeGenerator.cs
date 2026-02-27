using OtpNet;
using WinOTP.Models;

namespace WinOTP.Services;

public interface ITotpCodeGenerator
{
    string GenerateCode(OtpAccount account);
    int GetRemainingSeconds(OtpAccount account);
    double GetProgressPercentage(OtpAccount account);
}

public class TotpCodeGenerator : ITotpCodeGenerator
{
    public string GenerateCode(OtpAccount account)
    {
        try
        {
            var secret = Base32Encoding.ToBytes(account.Secret);
            var totp = new Totp(secret, 
                step: account.Period,
                totpSize: account.Digits,
                mode: GetHashMode(account.Algorithm));
            
            return totp.ComputeTotp(DateTime.UtcNow);
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

    public double GetProgressPercentage(OtpAccount account)
    {
        if (account.Period <= 0) return 0;

        // Use millisecond precision for smooth progress animation
        var unixTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var periodMs = (long)account.Period * 1000;
        var elapsedInPeriod = unixTimeMs % periodMs;
        var remainingMs = periodMs - elapsedInPeriod;

        return (double)remainingMs / periodMs;
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
