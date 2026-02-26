using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using WinOTP.Models;

namespace WinOTP.Pages;

public sealed partial class ManualEntryPage : Page
{
    public ManualEntryPage()
    {
        this.InitializeComponent();
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (Frame.CanGoBack)
            Frame.GoBack();
    }

    private void AddAccountButton_Click(object sender, RoutedEventArgs e)
    {
        ErrorInfoBar.IsOpen = false;

        var secret = SecretBox.Text.Trim().Replace(" ", "").ToUpperInvariant();
        var accountName = AccountNameBox.Text.Trim();

        if (string.IsNullOrEmpty(accountName))
        {
            ShowError("Account name is required.");
            return;
        }

        if (string.IsNullOrEmpty(secret))
        {
            ShowError("Secret key is required.");
            return;
        }

        if (!IsValidBase32(secret))
        {
            ShowError("Secret key must be valid Base32 (A-Z, 2-7).");
            return;
        }

        var account = new OtpAccount
        {
            Issuer = IssuerBox.Text.Trim(),
            AccountName = accountName,
            Secret = secret,
            Algorithm = (OtpAlgorithm)AlgorithmCombo.SelectedIndex,
            Digits = DigitsCombo.SelectedIndex == 0 ? 6 : 8,
            Period = (int)PeriodBox.Value
        };

        Frame.Navigate(typeof(HomePage), account);
    }

    private static bool IsValidBase32(string input)
    {
        var trimmed = input.TrimEnd('=');
        return trimmed.Length > 0 && trimmed.All(c => (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7'));
    }

    private void ShowError(string message)
    {
        ErrorInfoBar.Message = message;
        ErrorInfoBar.IsOpen = true;
    }
}
