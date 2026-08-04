import { parseOtpUri } from "./otp-uri.ts";
import type { OtpAccount } from "./types.ts";

export const MAX_IMPORT_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORTED_ACCOUNT_COUNT = 1_000;

export interface ParsedAccountImport {
  accounts: OtpAccount[];
  skippedCount: number;
}

export class AccountImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountImportFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringProperty(source: Record<string, unknown>, propertyName: string): string {
  const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === propertyName);
  const value = key ? source[key] : undefined;
  return typeof value === "string" ? value : "";
}

function normalizeImportedSecret(value: string): string {
  return value.replace(/\s/g, "").toUpperCase().replace(/=+$/, "");
}

function normalizeCreatedAt(value: string): string {
  if (!value.trim()) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1970
    ? new Date().toISOString()
    : parsed.toISOString();
}

function createLegacyAccount(source: Record<string, unknown>): OtpAccount | undefined {
  const secret = normalizeImportedSecret(readStringProperty(source, "secret"));
  if (!secret) {
    return undefined;
  }

  return {
    id: crypto.randomUUID(),
    issuer: readStringProperty(source, "issuer").trim(),
    accountName: readStringProperty(source, "name").trim(),
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: normalizeCreatedAt(readStringProperty(source, "created")),
    usageCount: 0,
  };
}

function addImportedAccount(accounts: OtpAccount[], account: OtpAccount) {
  if (accounts.length >= MAX_IMPORTED_ACCOUNT_COUNT) {
    throw new AccountImportFormatError(
      `The import contains more than ${MAX_IMPORTED_ACCOUNT_COUNT.toLocaleString("en-US")} accounts.`,
    );
  }

  accounts.push(account);
}

export function parseLegacyWinOtpJson(content: string): ParsedAccountImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new AccountImportFormatError("The file is not a valid WinOTP backup JSON file.");
  }

  if (!isRecord(parsed)) {
    throw new AccountImportFormatError("The file is not a valid WinOTP backup JSON file.");
  }

  const accounts: OtpAccount[] = [];
  let skippedCount = 0;
  for (const [, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      skippedCount += 1;
      continue;
    }

    const account = createLegacyAccount(value);
    if (account) {
      addImportedAccount(accounts, account);
    } else {
      skippedCount += 1;
    }
  }

  return { accounts, skippedCount };
}

function getQueryValue(uri: string, keyToFind: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }

  for (const pair of parsed.search.replace(/^\?/, "").split("&")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    try {
      const key = decodeURIComponent(pair.slice(0, separatorIndex));
      if (key.toLowerCase() !== keyToFind.toLowerCase()) {
        continue;
      }

      return decodeURIComponent(pair.slice(separatorIndex + 1));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function parseWinAuthLine(rawLine: string | null | undefined): OtpAccount | undefined {
  const line = typeof rawLine === "string" ? rawLine.trim() : "";
  if (!line || !line.toLowerCase().startsWith("otpauth://")) {
    return undefined;
  }

  // WinAuth writes spaces as '+' even in the URI path. '+' is otherwise a
  // literal character in an RFC 3986 URI, so normalize only this import format.
  const normalizedLine = line.replace(/\+/g, "%20");
  const account = parseOtpUri(normalizedLine);
  if (!account) {
    return undefined;
  }

  if (
    !account.issuer &&
    account.accountName &&
    getQueryValue(normalizedLine, "icon")?.toLowerCase() === "winauth"
  ) {
    account.issuer = account.accountName;
    account.accountName = "";
  }

  return account;
}

export function parseWinAuthText(content: string | null | undefined): ParsedAccountImport {
  const lines = (typeof content === "string" ? content : "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const accounts: OtpAccount[] = [];
  let skippedCount = 0;

  for (const line of lines) {
    const account = parseWinAuthLine(line);
    if (account) {
      addImportedAccount(accounts, account);
    } else {
      skippedCount += 1;
    }
  }

  return { accounts, skippedCount };
}
