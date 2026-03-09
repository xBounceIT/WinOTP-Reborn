using Microsoft.Win32;
using System.Diagnostics.CodeAnalysis;

namespace WinOTP.Services;

public sealed class AutoStartService : IAutoStartService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AppName = "WinOTP_Reborn";
    private readonly IAppLogger _logger;

    public AutoStartService(IAppLogger logger)
    {
        _logger = logger;
    }

    [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility", Justification = "App is Windows-only")]
    public Task<bool> EnableAutoStartAsync()
    {
        return Task.Run(() =>
        {
            try
            {
                var executablePath = Environment.ProcessPath;
                if (string.IsNullOrEmpty(executablePath))
                {
                    _logger.Error("Could not determine executable path for AutoStart.");
                    return false;
                }

                using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
                if (key == null)
                {
                    _logger.Error($"Could not open registry key: {RunKeyPath}");
                    return false;
                }

                // Append a specific argument if needed, e.g., --hidden, but for now just launch the app
                key.SetValue(AppName, $"\"{executablePath}\"");
                _logger.Info("AutoStart enabled successfully in registry.");
                return true;
            }
            catch (Exception ex)
            {
                _logger.Error("Failed to enable AutoStart in registry.", ex);
                return false;
            }
        });
    }

    [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility", Justification = "App is Windows-only")]
    public Task<bool> DisableAutoStartAsync()
    {
        return Task.Run(() =>
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
                if (key == null)
                {
                    _logger.Error($"Could not open registry key: {RunKeyPath}");
                    return false; // Or true if it doesn't exist so it can't run anyway
                }

                key.DeleteValue(AppName, throwOnMissingValue: false);
                _logger.Info("AutoStart disabled successfully in registry.");
                return true;
            }
            catch (Exception ex)
            {
                _logger.Error("Failed to disable AutoStart in registry.", ex);
                return false;
            }
        });
    }

    [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility", Justification = "App is Windows-only")]
    public bool IsAutoStartEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            if (key == null)
            {
                return false;
            }

            var value = key.GetValue(AppName) as string;
            return !string.IsNullOrEmpty(value);
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to check if AutoStart is enabled in registry.", ex);
            return false;
        }
    }
}
