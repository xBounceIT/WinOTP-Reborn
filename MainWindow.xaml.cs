using Microsoft.UI.Xaml;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        this.InitializeComponent();

        var appWindow = this.AppWindow;
        appWindow.Resize(new Windows.Graphics.SizeInt32(400, 600));
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement add account dialog
    }
}
