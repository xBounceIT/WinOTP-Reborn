using Microsoft.UI.Xaml;

namespace WinOTP.Helpers;

internal static class OtpCardTemplateRootPolicy
{
    public static bool TryGetSearchRoot(object? templateRoot, out DependencyObject searchRoot)
    {
        if (templateRoot is FrameworkElement frameworkElement)
        {
            searchRoot = frameworkElement;
            return true;
        }

        searchRoot = null!;
        return false;
    }

    public static bool IsSupportedRootType(Type? rootType)
    {
        return rootType is not null && typeof(FrameworkElement).IsAssignableFrom(rootType);
    }
}
