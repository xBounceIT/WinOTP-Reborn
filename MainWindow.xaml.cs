using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using WinOTP.Pages;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    private bool _isAddFlowOpening;

    public MainWindow()
    {
        this.InitializeComponent();

        var appWindow = this.AppWindow;
        appWindow.Resize(new Windows.Graphics.SizeInt32(400, 600));

        ContentFrame.Navigated += ContentFrame_Navigated;
        ContentFrame.Navigate(typeof(HomePage));
    }

    private void ContentFrame_Navigated(object sender, NavigationEventArgs e)
    {
        UpdateAddButtonState(e.SourcePageType);
    }

    private void UpdateAddButtonState(Type? pageType)
    {
        var isHomePage = pageType == typeof(HomePage);
        AddButton.Visibility = isHomePage ? Visibility.Visible : Visibility.Collapsed;
        AddButton.IsEnabled = isHomePage;

        if (isHomePage)
        {
            _isAddFlowOpening = false;
        }
    }

    private void AddButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isAddFlowOpening)
        {
            return;
        }

        _isAddFlowOpening = true;
        AddButton.IsEnabled = false;

        if (!ContentFrame.Navigate(typeof(AddAccountPage)))
        {
            _isAddFlowOpening = false;
            UpdateAddButtonState(ContentFrame.CurrentSourcePageType);
        }
    }
}
