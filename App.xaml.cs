using Microsoft.UI.Xaml;

namespace WinOTP;

public partial class App : Application
{
    public new static App Current => (App)Application.Current;
    public MainWindow? MainWindow { get; private set; }

    public App()
    {
        this.InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        MainWindow = new MainWindow();
        MainWindow.Activate();
    }
}
