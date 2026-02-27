using System.Text.Json;

namespace WinOTP.Services;

public interface IAppSettingsService
{
    bool ShowNextCodeWhenFiveSecondsRemain { get; set; }
}

public sealed class AppSettingsService : IAppSettingsService
{
    private const string SettingsFileName = "settings.json";
    private static readonly object Sync = new();
    private readonly string _settingsFilePath;
    private bool _showNextCodeWhenFiveSecondsRemain;

    public AppSettingsService()
    {
        var settingsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WinOTP");

        Directory.CreateDirectory(settingsDirectory);
        _settingsFilePath = Path.Combine(settingsDirectory, SettingsFileName);
        _showNextCodeWhenFiveSecondsRemain = LoadSettings().ShowNextCodeWhenFiveSecondsRemain;
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
                    ShowNextCodeWhenFiveSecondsRemain = value
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
    }
}
