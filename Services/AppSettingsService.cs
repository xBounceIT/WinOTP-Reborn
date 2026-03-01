using System.Text.Json;

namespace WinOTP.Services;

public interface IAppSettingsService
{
    bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
    bool IsPinProtectionEnabled { get; set; }
    bool IsPasswordProtectionEnabled { get; set; }
    bool IsWindowsHelloEnabled { get; set; }
    int AutoLockTimeoutMinutes { get; set; }
    event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;
}

public sealed class AppSettingsChangedEventArgs : EventArgs
{
    public AppSettingsChangedEventArgs(string propertyName)
    {
        PropertyName = propertyName;
    }

    public string PropertyName { get; }
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
    private int _autoLockTimeoutMinutes;

    public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;

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
        _autoLockTimeoutMinutes = loadedSettings.AutoLockTimeoutMinutes;
    }

    public bool ShowNextCodeWhenFiveSecondsRemain
    {
        get => _showNextCodeWhenFiveSecondsRemain;
        set => SetBooleanProperty(ref _showNextCodeWhenFiveSecondsRemain, value, nameof(ShowNextCodeWhenFiveSecondsRemain));
    }

    public bool IsPinProtectionEnabled
    {
        get => _isPinProtectionEnabled;
        set => SetBooleanProperty(ref _isPinProtectionEnabled, value, nameof(IsPinProtectionEnabled));
    }

    public bool IsPasswordProtectionEnabled
    {
        get => _isPasswordProtectionEnabled;
        set => SetBooleanProperty(ref _isPasswordProtectionEnabled, value, nameof(IsPasswordProtectionEnabled));
    }

    public bool IsWindowsHelloEnabled
    {
        get => _isWindowsHelloEnabled;
        set => SetBooleanProperty(ref _isWindowsHelloEnabled, value, nameof(IsWindowsHelloEnabled));
    }

    public int AutoLockTimeoutMinutes
    {
        get => _autoLockTimeoutMinutes;
        set => SetIntProperty(ref _autoLockTimeoutMinutes, value, nameof(AutoLockTimeoutMinutes));
    }

    private void SetBooleanProperty(ref bool field, bool value, string propertyName)
    {
        var changed = false;

        lock (Sync)
        {
            if (field == value)
            {
                return;
            }

            field = value;
            SaveSettings(CreateSnapshot());
            changed = true;
        }

        if (changed)
        {
            SettingsChanged?.Invoke(this, new AppSettingsChangedEventArgs(propertyName));
        }
    }

    private void SetIntProperty(ref int field, int value, string propertyName)
    {
        var changed = false;

        lock (Sync)
        {
            if (field == value)
            {
                return;
            }

            field = value;
            SaveSettings(CreateSnapshot());
            changed = true;
        }

        if (changed)
        {
            SettingsChanged?.Invoke(this, new AppSettingsChangedEventArgs(propertyName));
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

    private AppSettingsData CreateSnapshot()
    {
        return new AppSettingsData
        {
            ShowNextCodeWhenFiveSecondsRemain = _showNextCodeWhenFiveSecondsRemain,
            IsPinProtectionEnabled = _isPinProtectionEnabled,
            IsPasswordProtectionEnabled = _isPasswordProtectionEnabled,
            IsWindowsHelloEnabled = _isWindowsHelloEnabled,
            AutoLockTimeoutMinutes = _autoLockTimeoutMinutes
        };
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
        public int AutoLockTimeoutMinutes { get; set; }
    }
}
