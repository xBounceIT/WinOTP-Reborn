using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace WinOTP.Helpers;

internal static class DialogHelper
{
    public static Task ShowErrorAsync(XamlRoot xamlRoot, string message)
        => ShowOkAsync(xamlRoot, "Error", message);

    public static Task ShowInfoAsync(XamlRoot xamlRoot, string message)
        => ShowOkAsync(xamlRoot, "Information", message);

    public static async Task ShowOkAsync(XamlRoot xamlRoot, string title, string message)
    {
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = xamlRoot
        };

        await dialog.ShowAsync();
    }
}
