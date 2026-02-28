using System.Text.Json;

namespace WinOTP.Services;

public interface IAppSettingsService
{
    bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
    bool IsPinProtectionEnabled { get; set; }
    bool IsPasswordProtectionEnabled { get; set; }
    bool IsWindowsHelloEnabled { get; set; }
}

public sealed class AppSettingsService : IAppSettingsService
{
    private const string SettingsFileName = "settings.json";
    private static readonly object Sync = new();
    private readonly string _settingsFilePath;
    private bool _showNextCodeWhenFiveSecondsRemain;
    private bool _isPinProtectionEnabled;
    private bool _isPasswordProtectionEnabled;
    private bool _isWindowsHelloEnabled;

    public AppSettingsService()
    {
        var settingsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WinOTP");

        Directory.CreateDirectory(settingsDirectory);
        _settingsFilePath = Path.Combine(settingsDirectory, SettingsFileName);
        
        var loadedSettings = LoadSettings();
        _showNextCodeWhenFiveSecondsRemain = loadedSettings.ShowNextCodeWhenFiveSecondsRemain;
        _isPinProtectionEnabled = loadedSettings.IsPinProtectionEnabled;
        _isPasswordProtectionEnabled = loadedSettings.IsPasswordProtectionEnabled;
        _isWindowsHelloEnabled = loadedSettings.IsWindowsHelloEnabled;
    }

    public bool ShowNextCodeWhenFiveSecondsRemain
    {
        get => _showNextCodeWhenFiveSecondsRemain;
        set
        {
            lock (Sync)
            {
                _showNextCodeWhenFiveSecondsRemain = value;
                SaveSettings(new AppSettingsData
                {
                    ShowNextCodeWhenFiveSecondsRemain = _showNextCodeWhenFiveSecondsRemain,
                    IsPinProtectionEnabled = _isPinProtectionEnabled,
                    IsPasswordProtectionEnabled = _isPasswordProtectionEnabled,
                    IsWindowsHelloEnabled = _isWindowsHelloEnabled
                });
            }
        }
    }

    public bool IsPinProtectionEnabled
    {
        get => _isPinProtectionEnabled;
        set
        {
            lock (Sync)
            {
                _isPinProtectionEnabled = value;
                SaveSettings(new AppSettingsData
                {
                    ShowNextCodeWhenFiveSecondsRemain = _showNextCodeWhenFiveSecondsRemain,
                    IsPinProtectionEnabled = _isPinProtectionEnabled,
                    IsPasswordProtectionEnabled = _isPasswordProtectionEnabled,
                    IsWindowsHelloEnabled = _isWindowsHelloEnabled
                });
            }
        }
    }

    public bool IsPasswordProtectionEnabled
    {
        get => _isPasswordProtectionEnabled;
        set
        {
            lock (Sync)
            {
                _isPasswordProtectionEnabled = value;
                SaveSettings(new AppSettingsData
                {
                    ShowNextCodeWhenFiveSecondsRemain = _showNextCodeWhenFiveSecondsRemain,
                    IsPinProtectionEnabled = _isPinProtectionEnabled,
                    IsPasswordProtectionEnabled = _isPasswordProtectionEnabled,
                    IsWindowsHelloEnabled = _isWindowsHelloEnabled
                });
            }
        }
    }

    public bool IsWindowsHelloEnabled
    {
        get => _isWindowsHelloEnabled;
        set
        {
            lock (Sync)
            {
                _isWindowsHelloEnabled = value;
                SaveSettings(new AppSettingsData
                {
                    ShowNextCodeWhenFiveSecondsRemain = _showNextCodeWhenFiveSecondsRemain,
                    IsPinProtectionEnabled = _isPinProtectionEnabled,
                    IsPasswordProtectionEnabled = _isPasswordProtectionEnabled,
                    IsWindowsHelloEnabled = _isWindowsHelloEnabled
                });
            }
        }
    }

    private AppSettingsData LoadSettings()
    {
        lock (Sync)
        {
            if (!File.Exists(_settingsFilePath))
            {
                return new AppSettingsData();
            }

            try
            {
                var json = File.ReadAllText(_settingsFilePath);
                return JsonSerializer.Deserialize<AppSettingsData>(json) ?? new AppSettingsData();
            }
            catch
            {
                return new AppSettingsData();
            }
        }
    }

    private void SaveSettings(AppSettingsData settings)
    {
        try
        {
            var json = JsonSerializer.Serialize(settings);
            File.WriteAllText(_settingsFilePath, json);
        }
        catch
        {
            // Ignore persistence errors to keep the app usable.
        }
    }

    private sealed class AppSettingsData
    {
        public bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
        public bool IsPinProtectionEnabled { get; set; }
        public bool IsPasswordProtectionEnabled { get; set; }
        public bool IsWindowsHelloEnabled { get; set; }
    }
}
