using Microsoft.UI.Xaml;
using WinOTP.Services;

namespace WinOTP;

public partial class App : Application
{
    public new static App Current => (App)Application.Current;
    public MainWindow? MainWindow { get; private set; }
    public IAppLogger Logger { get; } = new AppLogger();
    public ICredentialManagerService CredentialManager { get; }
    public IAppSettingsService AppSettings { get; }
    public ITotpCodeGenerator TotpGenerator { get; } = new TotpCodeGenerator();

    public App()
    {
        this.InitializeComponent();
        CredentialManager = new CredentialManagerService(Logger);
        AppSettings = new AppSettingsService();
        UnhandledException += OnUnhandledException;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        MainWindow = new MainWindow();
        MainWindow.Activate();
    }

    private void OnUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        Logger.Error("Unhandled exception reached App boundary.", e.Exception);
    }
}
