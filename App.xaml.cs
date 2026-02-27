using Microsoft.UI.Xaml;
using WinOTP.Services;

namespace WinOTP;

public partial class App : Application
{
    public new static App Current => (App)Application.Current;
    public MainWindow? MainWindow { get; private set; }
    public ICredentialManagerService CredentialManager { get; } = new CredentialManagerService();
    public ITotpCodeGenerator TotpGenerator { get; } = new TotpCodeGenerator();

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
