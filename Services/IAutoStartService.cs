namespace WinOTP.Services;

public interface IAutoStartService
{
    Task<bool> EnableAutoStartAsync();
    Task<bool> DisableAutoStartAsync();
    bool IsAutoStartEnabled();
}
