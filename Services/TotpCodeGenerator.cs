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
        var remaining = GetRemainingSeconds(account);
        return (double)remaining / account.Period;
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
