using WinOTP.Helpers;
using Xunit;

namespace WinOTP.Tests;

public sealed class ImportSummaryMessageBuilderTests
{
    [Fact]
    public void Build_SuccessOnly_ReturnsSingleLine()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 3,
            failCount: 0,
            skippedCount: 0);

        Assert.Equal(
            "Import completed:\n• 3 account(s) imported successfully",
            message);
    }

    [Fact]
    public void Build_SuccessAndReplaced_IncludesReplacedLine()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 5,
            failCount: 0,
            skippedCount: 0,
            replacedCount: 2);

        Assert.Contains("• 5 account(s) imported successfully", message);
        Assert.Contains("• 2 existing account(s) replaced", message);
    }

    [Fact]
    public void Build_SuccessAndFailed_IncludesFailedLine()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 4,
            failCount: 1,
            skippedCount: 0);

        Assert.Contains("• 4 account(s) imported successfully", message);
        Assert.Contains("• 1 account(s) failed to import", message);
    }

    [Fact]
    public void Build_SkippedWithoutLabel_OmitsParenSuffix()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 2,
            failCount: 0,
            skippedCount: 3);

        Assert.Contains("• 3 account(s) skipped", message);
        Assert.DoesNotContain("skipped (", message);
    }

    [Fact]
    public void Build_SkippedWithLabel_AppendsLabelInParens()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 2,
            failCount: 0,
            skippedCount: 3,
            skippedLabel: "invalid data");

        Assert.Contains("• 3 account(s) skipped (invalid data)", message);
    }

    [Fact]
    public void Build_AdditionalMessage_AppendedAfterBlankLine()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 1,
            failCount: 0,
            skippedCount: 0,
            additionalMessage: "Automatic backup failed: disk full");

        Assert.EndsWith("\n\nAutomatic backup failed: disk full", message);
    }

    [Fact]
    public void Build_AllSectionsPresent_OrderIsSuccessReplacedFailedSkipped()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 7,
            failCount: 2,
            skippedCount: 1,
            skippedLabel: "duplicates",
            replacedCount: 3,
            additionalMessage: "Backup OK");

        var successIdx = message.IndexOf("imported successfully", StringComparison.Ordinal);
        var replacedIdx = message.IndexOf("existing account(s) replaced", StringComparison.Ordinal);
        var failedIdx = message.IndexOf("failed to import", StringComparison.Ordinal);
        var skippedIdx = message.IndexOf("skipped (duplicates)", StringComparison.Ordinal);
        var additionalIdx = message.IndexOf("Backup OK", StringComparison.Ordinal);

        Assert.True(successIdx >= 0);
        Assert.True(replacedIdx > successIdx);
        Assert.True(failedIdx > replacedIdx);
        Assert.True(skippedIdx > failedIdx);
        Assert.True(additionalIdx > skippedIdx);
    }

    [Fact]
    public void Build_ZeroSuccess_StillShowsHeaderAndZeroLine()
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 0,
            failCount: 4,
            skippedCount: 0);

        Assert.StartsWith("Import completed:", message);
        Assert.Contains("• 0 account(s) imported successfully", message);
        Assert.Contains("• 4 account(s) failed to import", message);
    }

    [Fact]
    public void Build_NullOrEmptyAdditionalMessage_NotAppended()
    {
        var withNull = ImportSummaryMessageBuilder.Build(
            successCount: 1, failCount: 0, skippedCount: 0, additionalMessage: null);
        var withEmpty = ImportSummaryMessageBuilder.Build(
            successCount: 1, failCount: 0, skippedCount: 0, additionalMessage: "");

        Assert.DoesNotContain("\n\n", withNull);
        Assert.DoesNotContain("\n\n", withEmpty);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(99, true)]
    public void Build_ReplacedLinePresence_DependsOnPositiveCount(int replacedCount, bool expected)
    {
        var message = ImportSummaryMessageBuilder.Build(
            successCount: 1,
            failCount: 0,
            skippedCount: 0,
            replacedCount: replacedCount);

        Assert.Equal(expected, message.Contains("existing account(s) replaced"));
    }
}
