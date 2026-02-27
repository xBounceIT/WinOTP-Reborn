using WinOTP.Helpers;
using WinOTP.Models;
using Xunit;

namespace WinOTP.Tests;

public sealed class OtpAccountStorageMapperTests
{
    [Fact]
    public void TryParseStoredJson_ValidPayloadWithComputedFields_Succeeds()
    {
        var json =
            """
            {
              "Id":"c9818037446a4dc08da9a067461694fc",
              "Issuer":"ACME Co",
              "AccountName":"jdoe@example.com",
              "Secret":"AUSJD7LZ5H27TAC7NW2JMATDMVDUPUG",
              "Algorithm":0,
              "Digits":6,
              "Period":30,
              "CreatedAt":"2026-02-27T09:29:59.3184826Z",
              "DisplayLabel":"ACME Co (jdoe@example.com)",
              "ResourceKey":"WinOTP:c9818037446a4dc08da9a067461694fc"
            }
            """;

        var ok = OtpAccountStorageMapper.TryParseStoredJson(json, "c9818037446a4dc08da9a067461694fc", out var account, out var issue);

        Assert.True(ok);
        Assert.NotNull(account);
        Assert.Null(issue);
        Assert.Equal("ACME Co", account.Issuer);
        Assert.Equal("jdoe@example.com", account.AccountName);
        Assert.Equal(6, account.Digits);
        Assert.Equal(30, account.Period);
    }

    [Fact]
    public void TryParseStoredJson_InvalidJson_ReturnsIssue()
    {
        var ok = OtpAccountStorageMapper.TryParseStoredJson("{\"Id\":", "cred-1", out var account, out var issue);

        Assert.False(ok);
        Assert.Null(account);
        Assert.NotNull(issue);
        Assert.Equal(CredentialIssueCode.InvalidJson, issue.Code);
    }

    [Fact]
    public void TryParseStoredJson_InvalidSecret_ReturnsInvalidDataIssue()
    {
        var json =
            """
            {
              "Id":"abc123",
              "Issuer":"ACME Co",
              "AccountName":"jdoe@example.com",
              "Secret":"NOT-BASE32-!",
              "Algorithm":0,
              "Digits":6,
              "Period":30
            }
            """;

        var ok = OtpAccountStorageMapper.TryParseStoredJson(json, "abc123", out var account, out var issue);

        Assert.False(ok);
        Assert.Null(account);
        Assert.NotNull(issue);
        Assert.Equal(CredentialIssueCode.InvalidData, issue.Code);
    }

    [Fact]
    public void TryParseStoredJson_NormalizesInvalidDigitsAndPeriodAndAlgorithm()
    {
        var json =
            """
            {
              "Id":"abc123",
              "Issuer":"ACME Co",
              "AccountName":"jdoe@example.com",
              "Secret":"JBSWY3DPEHPK3PXP",
              "Algorithm":999,
              "Digits":7,
              "Period":0
            }
            """;

        var ok = OtpAccountStorageMapper.TryParseStoredJson(json, "abc123", out var account, out var issue);

        Assert.True(ok);
        Assert.NotNull(account);
        Assert.Null(issue);
        Assert.Equal(OtpAlgorithm.SHA1, account.Algorithm);
        Assert.Equal(6, account.Digits);
        Assert.Equal(30, account.Period);
    }

    [Fact]
    public void TrySanitizeForStorage_EmptyIdUsesFallbackAndSecretIsTrimmedUppercase()
    {
        var source = new OtpAccount
        {
            Id = " ",
            Issuer = "  ACME  ",
            AccountName = " jdoe@example.com ",
            Secret = " jbsw y3dp ehpk3pxp ",
            Algorithm = OtpAlgorithm.SHA256,
            Digits = 8,
            Period = 45,
            CreatedAt = default
        };

        var ok = OtpAccountStorageMapper.TrySanitizeForStorage(source, "fallback-id", out var sanitized, out var error);

        Assert.True(ok);
        Assert.Equal(string.Empty, error);
        Assert.Equal("fallback-id", sanitized.Id);
        Assert.Equal("ACME", sanitized.Issuer);
        Assert.Equal("jdoe@example.com", sanitized.AccountName);
        Assert.Equal("JBSWY3DPEHPK3PXP", sanitized.Secret);
        Assert.Equal(OtpAlgorithm.SHA256, sanitized.Algorithm);
        Assert.Equal(8, sanitized.Digits);
        Assert.Equal(45, sanitized.Period);
        Assert.NotEqual(default, sanitized.CreatedAt);
    }

    [Fact]
    public void TrySanitizeForStorage_InvalidSecret_FailsValidation()
    {
        var source = new OtpAccount
        {
            Id = "id-1",
            Secret = "abc-123"
        };

        var ok = OtpAccountStorageMapper.TrySanitizeForStorage(source, "id-1", out var sanitized, out var error);

        Assert.False(ok);
        Assert.Equal("Secret is missing or not valid Base32.", error);
        Assert.NotNull(sanitized);
    }
}
