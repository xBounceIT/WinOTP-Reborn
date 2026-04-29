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

    [Fact]
    public void GetDropInsertionIndex_SeparatesRowsWithSlightOverlap()
    {
        var bounds = new[]
        {
            Item("acct-1", 0, 0),
            Item("acct-2", 0, 130)
        };

        Assert.Equal(1, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 100));
        Assert.Equal(1, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 180));
        Assert.Equal(2, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 240));
    }

    [Fact]
    public void GetDropInsertionIndex_HandlesMixedRowHeights()
    {
        var bounds = new[]
        {
            Item("acct-1", 0, 0, height: 140),
            Item("acct-2", 370, 0, height: 145),
            Item("acct-3", 0, 160, height: 140)
        };

        Assert.Equal(2, OtpAccountReorderLayoutPolicy.GetDropInsertionIndex(bounds, 10, 200));
    }

    [Theory]
    [InlineData(3, 1, true, 1)]
    [InlineData(1, 4, true, 3)]
    [InlineData(1, 1, false, -1)]
    [InlineData(1, 2, false, -1)]
    public void TryGetTargetIndex_NormalizesInsertionIndexAfterRemovingDraggedItem(
        int currentIndex,
        int insertionIndex,
        bool expectedResult,
        int expectedTargetIndex)
    {
        var result = OtpAccountReorderLayoutPolicy.TryGetTargetIndex(currentIndex, insertionIndex, 4, out var targetIndex);

        Assert.Equal(expectedResult, result);
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
        int sourceIndex = -1,
        double height = 140)
    {
        return new OtpAccountReorderLayoutPolicy.ItemBounds(id, left, top, 360, height, sourceIndex);
    }
}
