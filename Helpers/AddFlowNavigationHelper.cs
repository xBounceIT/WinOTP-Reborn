using Microsoft.UI.Xaml.Controls;
using WinOTP.Pages;

namespace WinOTP.Helpers;

internal static class AddFlowNavigationHelper
{
    public const string CleanupCompletedAddFlowParameter = "CleanupCompletedAddFlow";

    public static void RemoveCompletedAddFlowEntries(Frame? frame)
    {
        if (frame == null || frame.BackStack.Count == 0)
        {
            return;
        }

        for (int index = frame.BackStack.Count - 1; index >= 0; index--)
        {
            var entry = frame.BackStack[index];
            if (entry.SourcePageType == typeof(AddAccountPage) ||
                entry.SourcePageType == typeof(ManualEntryPage) ||
                entry.SourcePageType == typeof(ImportPage))
            {
                frame.BackStack.RemoveAt(index);
            }
        }
    }
}
