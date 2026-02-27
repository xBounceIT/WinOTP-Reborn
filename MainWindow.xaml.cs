using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using WinOTP.Pages;

namespace WinOTP;

public sealed partial class MainWindow : Window
{
    private bool _isNavigating;

    public MainWindow()
    {
        this.InitializeComponent();

        // Custom title bar
        this.ExtendsContentIntoTitleBar = true;
        this.SetTitleBar(AppTitleBar);

        // Acrylic backdrop
        this.SystemBackdrop = new Microsoft.UI.Xaml.Media.DesktopAcrylicBackdrop();

        // Window size
        this.AppWindow.Resize(new Windows.Graphics.SizeInt32(450, 600));

        // Frame navigation tracking
        ContentFrame.Navigated += ContentFrame_Navigated;

        // Navigate to Home and select the Home item
        ContentFrame.Navigate(typeof(HomePage));
        NavView.SelectedItem = NavView.MenuItems[0];
    }

    private void ContentFrame_Navigated(object sender, NavigationEventArgs e)
    {
        // Update back button visibility
        NavView.IsBackButtonVisible = ContentFrame.CanGoBack
            ? NavigationViewBackButtonVisible.Visible
            : NavigationViewBackButtonVisible.Collapsed;

        // Sync selection to Home when on HomePage
        if (e.SourcePageType == typeof(HomePage))
        {
            NavView.SelectedItem = NavView.MenuItems[0];
        }
    }

    private void NavView_ItemInvoked(NavigationView sender,
        NavigationViewItemInvokedEventArgs args)
    {
        if (_isNavigating) return;

        var invokedItem = args.InvokedItemContainer as NavigationViewItem;
        if (invokedItem is null) return;

        var tag = invokedItem.Tag as string;

        switch (tag)
        {
            case "Home":
                NavigateIfNeeded(typeof(HomePage));
                break;

            case "AddAccount":
                NavigateToAddAccount();
                break;
        }
    }

    private void NavView_BackRequested(NavigationView sender,
        NavigationViewBackRequestedEventArgs args)
    {
        if (ContentFrame.CanGoBack)
        {
            ContentFrame.GoBack();
        }
    }

    private void NavigateIfNeeded(Type pageType)
    {
        if (ContentFrame.CurrentSourcePageType != pageType)
        {
            ContentFrame.Navigate(pageType);
        }
    }

    private void NavigateToAddAccount()
    {
        if (_isNavigating) return;
        if (ContentFrame.CurrentSourcePageType == typeof(AddAccountPage)) return;

        _isNavigating = true;

        if (!ContentFrame.Navigate(typeof(AddAccountPage)))
        {
            _isNavigating = false;
            return;
        }

        _isNavigating = false;
    }
}
