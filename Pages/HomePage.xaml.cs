using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using WinOTP.Models;

namespace WinOTP.Pages;

public sealed partial class HomePage : Page
{
    public HomePage()
    {
        this.InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        if (e.Parameter is OtpAccount newAccount)
        {
            // TODO: Add to persistent account list
            // For now, just demonstrate that the account was received
            EmptyStatePanel.Visibility = Microsoft.UI.Xaml.Visibility.Collapsed;
        }
    }
}
