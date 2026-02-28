using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;
using WinOTP.Helpers;
using WinOTP.Services;

namespace WinOTP.Pages;

public sealed partial class SettingsPage : Page
{
    private const string RepositoryUrl = "https://github.com/xBounceIT/WinOTP-Reborn";
    private readonly IAppSettingsService _appSettings;
    private bool _isInitializingToggle;

    public SettingsPage()
    {
        this.InitializeComponent();
        _appSettings = App.Current.AppSettings;

        // Load version from assembly
        VersionTextBlock.Text = VersionHelper.GetAppVersion();
        LoadSettings();
    }

    private async void GoToRepositoryButton_Click(object sender, RoutedEventArgs e)
    {
        var uri = new System.Uri(RepositoryUrl);
        await Launcher.LaunchUriAsync(uri);
    }

    private void LoadSettings()
    {
        _isInitializingToggle = true;
        ShowNextCodeToggle.IsOn = _appSettings.ShowNextCodeWhenFiveSecondsRemain;
        _isInitializingToggle = false;
    }

    private void ShowNextCodeToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializingToggle)
        {
            return;
        }

        _appSettings.ShowNextCodeWhenFiveSecondsRemain = ShowNextCodeToggle.IsOn;
    }
}
