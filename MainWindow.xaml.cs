using Microsoft.UI.Xaml;
using WinOTP.Pages;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        this.InitializeComponent();

        var appWindow = this.AppWindow;
        appWindow.Resize(new Windows.Graphics.SizeInt32(400, 600));

        ContentFrame.Navigate(typeof(HomePage));
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        ContentFrame.Navigate(typeof(AddAccountPage));
    }
}
