using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpAccountReorderLayoutPolicyTests
{
    [Fact]
    public void GetDropInsertionIndex_UsesVerticalMidpointsInSingleColumn()
    {
        var bounds = new[]
        {
            Item("acct-1", 0, 0),
            Item("acct-2", 0, 150),
            Item("acct-3", 0, 300)
        };

        Assert.Equal(0, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 20));
        Assert.Equal(1, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 170));
        Assert.Equal(3, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 450));
    }

    [Fact]
    public void GetDropInsertionIndex_InsertsAfterLastSingleColumnItemFromLowerHalf()
    {
        var bounds = new[]
        {
            Item("acct-1", 0, 0),
            Item("acct-2", 0, 150),
            Item("acct-3", 0, 300)
        };

        Assert.Equal(3, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 380));
    }

    [Fact]
    public void GetDropInsertionIndex_UsesRowAwareHorizontalPositionInWrappedLayout()
    {
        var bounds = new[]
        {
            Item("acct-1", 0, 0),
            Item("acct-2", 370, 0),
            Item("acct-3", 0, 150),
            Item("acct-4", 370, 150)
        };

        Assert.Equal(1, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 500, 40));
        Assert.Equal(2, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 720, 40));
        Assert.Equal(3, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 500, 190));
    }

    [Fact]
    public void GetDropInsertionIndex_UsesSourceIndexesForVirtualizedVisibleItems()
    {
        var bounds = new[]
        {
            Item("acct-4", 0, 0, sourceIndex: 3),
            Item("acct-5", 0, 150, sourceIndex: 4),
            Item("acct-6", 0, 300, sourceIndex: 5)
        };

        Assert.Equal(3, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, -10));
        Assert.Equal(6, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 450));
    }

    [Theory]
    [InlineData(3, 1, 1)]
    [InlineData(1, 4, 3)]
    [InlineData(1, 1, -1)]
    [InlineData(1, 2, -1)]
    public void GetTargetIndex_NormalizesInsertionIndexAfterRemovingDraggedItem(
        int currentIndex,
        int insertionIndex,
        int expectedTargetIndex)
    {
        var targetIndex = OtpAccountReorderLayoutPolicy.GetTargetIndex(currentIndex, insertionIndex, 4);

        Assert.Equal(expectedTargetIndex, targetIndex);
    }

    [Fact]
    public void ProjectOrder_ReturnsPreviewOrderWithoutMutatingSource()
    {
        string[] source = ["acct-1", "acct-2", "acct-3", "acct-4"];

        var projected = OtpAccountReorderLayoutPolicy.ProjectOrder(source, "acct-2", 4);

        Assert.Equal(["acct-1", "acct-3", "acct-4", "acct-2"], projected);
        Assert.Equal(["acct-1", "acct-2", "acct-3", "acct-4"], source);
    }

    private static OtpAccountReorderLayoutPolicy.ItemBounds Item(
        string id,
        double left,
        double top,
        int sourceIndex = -1)
    {
        return new OtpAccountReorderLayoutPolicy.ItemBounds(id, left, top, 360, 140, sourceIndex);
    }
}
