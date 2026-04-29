namespace WinOTP.Helpers;

public static class OtpAccountReorderLayoutPolicy
{
    public readonly record struct ItemBounds(
        string Id,
        double Left,
        double Top,
        double Width,
        double Height,
        int SourceIndex = -1)
    {
        public double Right => Left + Width;
        public double Bottom => Top + Height;
        public double CenterX => Left + Width / 2;
        public double CenterY => Top + Height / 2;
    }

    private sealed class VisualRow
    {
        public double Top { get; set; }
        public double Bottom { get; set; }
        public List<(ItemBounds Bounds, int Index)> Items { get; } = [];
        public int MinEffectiveIndex { get; set; } = int.MaxValue;
        public int MaxEffectiveIndex { get; set; } = int.MinValue;
    }

    public static int GetDropInsertionIndex(
        IReadOnlyList<ItemBounds> itemBounds,
        double x,
        double y)
    {
        if (itemBounds.Count == 0)
        {
            return 0;
        }

        var rows = BuildRows(itemBounds);
        foreach (var row in rows)
        {
            if (y < row.Top)
            {
                return row.MinEffectiveIndex;
            }

            if (y > row.Bottom)
            {
                continue;
            }

            if (row.Items.Count == 1)
            {
                var item = row.Items[0];
                var itemIndex = GetEffectiveIndex(item);
                return y < item.Bounds.CenterY
                    ? itemIndex
                    : itemIndex + 1;
            }

            foreach (var item in row.Items)
            {
                if (x < item.Bounds.CenterX)
                {
                    return GetEffectiveIndex(item);
                }
            }

            return row.MaxEffectiveIndex + 1;
        }

        return rows[^1].MaxEffectiveIndex + 1;
    }

    public static int GetTargetIndex(int currentIndex, int insertionIndex, int count)
    {
        if (currentIndex < 0 || currentIndex >= count)
        {
            return -1;
        }

        var targetIndex = Math.Clamp(insertionIndex, 0, count);
        if (currentIndex < targetIndex)
        {
            targetIndex--;
        }

        return targetIndex == currentIndex || targetIndex < 0 || targetIndex >= count
            ? -1
            : targetIndex;
    }

    public static IReadOnlyList<string> ProjectOrder(
        IReadOnlyList<string> orderedIds,
        string draggedId,
        int insertionIndex)
    {
        var projectedIds = orderedIds.ToList();
        var currentIndex = projectedIds.FindIndex(id => string.Equals(id, draggedId, StringComparison.Ordinal));
        var targetIndex = GetTargetIndex(currentIndex, insertionIndex, projectedIds.Count);
        if (targetIndex < 0)
        {
            return projectedIds;
        }

        projectedIds.RemoveAt(currentIndex);
        projectedIds.Insert(targetIndex, draggedId);
        return projectedIds;
    }

    private static List<VisualRow> BuildRows(IReadOnlyList<ItemBounds> itemBounds)
    {
        var rows = new List<VisualRow>();
        foreach (var item in itemBounds
            .Select((bounds, index) => (Bounds: bounds, Index: index))
            .OrderBy(item => item.Bounds.Top)
            .ThenBy(item => item.Bounds.Left))
        {
            var row = rows.Count > 0 && item.Bounds.Top <= rows[^1].Bottom ? rows[^1] : null;
            if (row == null)
            {
                row = new VisualRow { Top = item.Bounds.Top, Bottom = item.Bounds.Bottom };
                rows.Add(row);
            }

            row.Top = Math.Min(row.Top, item.Bounds.Top);
            row.Bottom = Math.Max(row.Bottom, item.Bounds.Bottom);
            row.Items.Add(item);

            var effectiveIndex = GetEffectiveIndex(item);
            row.MinEffectiveIndex = Math.Min(row.MinEffectiveIndex, effectiveIndex);
            row.MaxEffectiveIndex = Math.Max(row.MaxEffectiveIndex, effectiveIndex);
        }

        return rows;
    }

    private static int GetEffectiveIndex((ItemBounds Bounds, int Index) item)
    {
        return item.Bounds.SourceIndex >= 0
            ? item.Bounds.SourceIndex
            : item.Index;
    }
}
