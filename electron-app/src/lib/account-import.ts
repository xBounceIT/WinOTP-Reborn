import type { OtpAccount, ParsedAccountImport } from "./types.ts";

export const MAX_IMPORT_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORTED_ACCOUNT_COUNT = 1_000;

export class AccountImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountImportFormatError";
  }
}

function getCore() {
  const core = window.winotp?.core;
  if (!core) {
    throw new AccountImportFormatError("The Rust import bridge is unavailable.");
  }
  return core;
}

function isParsedAccountImport(value: unknown): value is ParsedAccountImport {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as ParsedAccountImport).accounts) &&
    Number.isInteger((value as ParsedAccountImport).skippedCount) &&
    (value as ParsedAccountImport).skippedCount >= 0,
  );
}

function normalizeBridgeError(error: unknown): AccountImportFormatError {
  return new AccountImportFormatError(
    error instanceof Error ? error.message : "The selected import file is invalid.",
  );
}

export async function parseLegacyWinOtpJson(content: string): Promise<ParsedAccountImport> {
  try {
    const result = await getCore().parseLegacyJson(content);
    if (!isParsedAccountImport(result)) {
      throw new Error("The Rust import bridge returned invalid data.");
    }
    return result;
  } catch (error) {
    throw normalizeBridgeError(error);
  }
}

export async function parseWinAuthLine(
  rawLine: string | null | undefined,
): Promise<OtpAccount | undefined> {
  if (!rawLine?.trim()) {
    return undefined;
  }

  try {
    return await getCore().parseWinAuthLine(rawLine);
  } catch {
    return undefined;
  }
}

export async function parseWinAuthText(
  content: string | null | undefined,
): Promise<ParsedAccountImport> {
  try {
    const result = await getCore().parseWinAuthText(content ?? "");
    if (!isParsedAccountImport(result)) {
      throw new Error("The Rust import bridge returned invalid data.");
    }
    return result;
  } catch (error) {
    throw normalizeBridgeError(error);
  }
}
