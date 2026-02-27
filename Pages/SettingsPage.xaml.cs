using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;
using WinOTP.Helpers;

namespace WinOTP.Pages;

public sealed partial class SettingsPage : Page
{
    private const string RepositoryUrl = "https://github.com/xBounceIT/WinOTP-Reborn";

    public SettingsPage()
    {
        this.InitializeComponent();
        
        // Load version from assembly
        VersionTextBlock.Text = VersionHelper.GetAppVersion();
    }

    private async void GoToRepositoryButton_Click(object sender, RoutedEventArgs e)
    {
        var uri = new System.Uri(RepositoryUrl);
        await Launcher.LaunchUriAsync(uri);
    }
}
