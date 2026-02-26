using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using WinOTP.Helpers;
using WinOTP.Models;

namespace WinOTP.Pages;

public sealed partial class AddAccountPage : Page
{
    public AddAccountPage()
    {
        this.InitializeComponent();
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (Frame.CanGoBack)
            Frame.GoBack();
    }

    private async void ImportQrButton_Click(object sender, RoutedEventArgs e)
    {
        var window = App.Current.MainWindow!;
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".bmp");
        picker.FileTypeFilter.Add(".gif");
        picker.FileTypeFilter.Add(".webp");
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.PicturesLibrary;

        var file = await picker.PickSingleFileAsync();
        if (file is null) return;

        string? qrText;
        try
        {
            qrText = await QrCodeHelper.DecodeFromFileAsync(file.Path);
        }
        catch
        {
            await ShowErrorAsync("Failed to read the image file.");
            return;
        }

        if (qrText is null)
        {
            await ShowErrorAsync("No QR code found in the selected image.");
            return;
        }

        var account = OtpUriParser.TryParse(qrText);
        if (account is null)
        {
            await ShowErrorAsync("The QR code does not contain a valid OTP URI.");
            return;
        }

        Frame.Navigate(typeof(HomePage), account);
    }

    private async void CaptureScreenButton_Click(object sender, RoutedEventArgs e)
    {
        var mainWindow = App.Current.MainWindow!;

        // Minimize main window to get it out of the way
        var mainPresenter = mainWindow.AppWindow.Presenter as Microsoft.UI.Windowing.OverlappedPresenter;
        mainPresenter?.Minimize();

        // Brief delay to let the minimize animation finish
        await Task.Delay(300);

        // Capture the full screen
        ScreenCapture capture;
        try
        {
            capture = ScreenCaptureHelper.CaptureFullScreen();
        }
        catch
        {
            mainPresenter?.Restore();
            await ShowErrorAsync("Failed to capture the screen.");
            return;
        }

        // Show the overlay for region selection
        var overlay = new ScreenCaptureOverlay();
        var qrText = await overlay.StartCaptureAsync(capture);

        // Restore main window
        mainPresenter?.Restore();
        mainWindow.Activate();

        if (qrText is null)
        {
            // User cancelled or no QR found - only show error if they made a selection
            if (qrText == null && overlay.Title != "cancelled")
            {
                // The overlay returns null for both cancel and no-QR-found.
                // We can't easily distinguish here, so we just stay on this page silently.
            }
            return;
        }

        var account = OtpUriParser.TryParse(qrText);
        if (account is null)
        {
            await ShowErrorAsync("The QR code does not contain a valid OTP URI.");
            return;
        }

        Frame.Navigate(typeof(HomePage), account);
    }

    private void ManualEntryButton_Click(object sender, RoutedEventArgs e)
    {
        Frame.Navigate(typeof(ManualEntryPage));
    }

    private async Task ShowErrorAsync(string message)
    {
        var dialog = new ContentDialog
        {
            Title = "Error",
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.XamlRoot
        };
        await dialog.ShowAsync();
    }
}
