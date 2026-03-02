using System.Text.Json;
using System.Text.Json.Serialization;
using WinOTP.Helpers;
using WinOTP.Models;

namespace WinOTP.Services;

public interface IAppSettingsService
{
    bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
    bool IsPinProtectionEnabled { get; set; }
    bool IsPasswordProtectionEnabled { get; set; }
    bool IsWindowsHelloEnabled { get; set; }
    int AutoLockTimeoutMinutes { get; set; }
    bool IsAutomaticBackupEnabled { get; set; }
    string CustomBackupFolderPath { get; set; }
    bool IsUpdateCheckEnabled { get; set; }
    UpdateChannel UpdateChannel { get; set; }
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
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        Converters =
        {
            new JsonStringEnumConverter()
        }
    };

    private readonly string _settingsFilePath;
    private bool _showNextCodeWhenFiveSecondsRemain;
    private bool _isPinProtectionEnabled;
    private bool _isPasswordProtectionEnabled;
    private bool _isWindowsHelloEnabled;
    private int _autoLockTimeoutMinutes;
    private bool _isAutomaticBackupEnabled;
    private string _customBackupFolderPath = string.Empty;
    private bool _isUpdateCheckEnabled;
    private UpdateChannel _updateChannel;

    public event EventHandler<AppSettingsChangedEventArgs>? SettingsChanged;

    public AppSettingsService()
        : this(AppPaths.GetSettingsFilePath())
    {
    }

    internal AppSettingsService(string settingsFilePath)
    {
        var settingsDirectory = Path.GetDirectoryName(settingsFilePath) ?? AppPaths.GetAppDataDirectory();
        Directory.CreateDirectory(settingsDirectory);
        _settingsFilePath = settingsFilePath;
        
        var loadedSettings = LoadSettings();
        _showNextCodeWhenFiveSecondsRemain = loadedSettings.ShowNextCodeWhenFiveSecondsRemain;
        _isPinProtectionEnabled = loadedSettings.IsPinProtectionEnabled;
        _isPasswordProtectionEnabled = loadedSettings.IsPasswordProtectionEnabled;
        _isWindowsHelloEnabled = loadedSettings.IsWindowsHelloEnabled;
        _autoLockTimeoutMinutes = loadedSettings.AutoLockTimeoutMinutes;
        _isAutomaticBackupEnabled = loadedSettings.IsAutomaticBackupEnabled;
        _customBackupFolderPath = NormalizePathSetting(loadedSettings.CustomBackupFolderPath);
        _isUpdateCheckEnabled = loadedSettings.IsUpdateCheckEnabled;
        _updateChannel = loadedSettings.UpdateChannel;
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

    public bool IsAutomaticBackupEnabled
    {
        get => _isAutomaticBackupEnabled;
        set => SetBooleanProperty(ref _isAutomaticBackupEnabled, value, nameof(IsAutomaticBackupEnabled));
    }

    public string CustomBackupFolderPath
    {
        get => _customBackupFolderPath;
        set => SetStringProperty(ref _customBackupFolderPath, NormalizePathSetting(value), nameof(CustomBackupFolderPath));
    }

    public bool IsUpdateCheckEnabled
    {
        get => _isUpdateCheckEnabled;
        set => SetBooleanProperty(ref _isUpdateCheckEnabled, value, nameof(IsUpdateCheckEnabled));
    }

    public UpdateChannel UpdateChannel
    {
        get => _updateChannel;
        set => SetEnumProperty(ref _updateChannel, value, nameof(UpdateChannel));
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

    private void SetStringProperty(ref string field, string value, string propertyName)
    {
        var changed = false;

        lock (Sync)
        {
            if (string.Equals(field, value, StringComparison.Ordinal))
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

    private void SetEnumProperty<TEnum>(ref TEnum field, TEnum value, string propertyName)
        where TEnum : struct, Enum
    {
        var changed = false;

        lock (Sync)
        {
            if (EqualityComparer<TEnum>.Default.Equals(field, value))
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
                return JsonSerializer.Deserialize<AppSettingsData>(json, SerializerOptions) ?? new AppSettingsData();
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
            AutoLockTimeoutMinutes = _autoLockTimeoutMinutes,
            IsAutomaticBackupEnabled = _isAutomaticBackupEnabled,
            CustomBackupFolderPath = _customBackupFolderPath,
            IsUpdateCheckEnabled = _isUpdateCheckEnabled,
            UpdateChannel = _updateChannel
        };
    }

    private static string NormalizePathSetting(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
    }

    private void SaveSettings(AppSettingsData settings)
    {
        try
        {
            var json = JsonSerializer.Serialize(settings, SerializerOptions);
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
        public bool IsAutomaticBackupEnabled { get; set; }
        public string CustomBackupFolderPath { get; set; } = string.Empty;
        public bool IsUpdateCheckEnabled { get; set; } = true;
        public UpdateChannel UpdateChannel { get; set; } = UpdateChannel.Stable;
    }
}
