using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

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

    public static bool TryGetSearchRootFromContainer(object? container, out DependencyObject searchRoot)
    {
        if (container is GridViewItem gridViewItem && gridViewItem.ContentTemplateRoot is FrameworkElement gElement)
        {
            searchRoot = gElement;
            return true;
        }

        if (container is ListViewItem listViewItem && listViewItem.ContentTemplateRoot is FrameworkElement lElement)
        {
            searchRoot = lElement;
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
