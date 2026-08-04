import type { OtpAccount, OtpAlgorithm } from "@/lib/types";

type QueryParams = Map<string, string>;

function parseAlgorithm(value: string | null): OtpAlgorithm {
  switch (value?.toUpperCase()) {
    case "SHA256":
      return "SHA256";
    case "SHA512":
      return "SHA512";
    default:
      return "SHA1";
  }
}

function parsePositiveInteger(value: string | null): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\+?\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : undefined;
}

function parseQuery(search: string): QueryParams | undefined {
  const params = new Map<string, string>();
  const query = search.replace(/^\?/, "");
  if (!query) {
    return params;
  }

  for (const pair of query.split("&")) {
    if (!pair) {
      continue;
    }

    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    try {
      const key = decodeURIComponent(pair.slice(0, separatorIndex)).toLowerCase();
      const value = decodeURIComponent(pair.slice(separatorIndex + 1));
      params.set(key, value);
    } catch {
      return undefined;
    }
  }

  return params;
}

function getQueryParam(params: QueryParams, key: string): string | null {
  return params.get(key.toLowerCase()) ?? null;
}

export function parseOtpUri(uri: string): OtpAccount | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri.trim());
  } catch {
    return undefined;
  }

  if (parsed.protocol.toLowerCase() !== "otpauth:" || parsed.hostname.toLowerCase() !== "totp") {
    return undefined;
  }

  const queryParams = parseQuery(parsed.search);
  if (!queryParams) {
    return undefined;
  }

  const secret = (getQueryParam(queryParams, "secret") ?? "")
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/=+$/, "");
  if (!secret || !/^[A-Z2-7]+$/.test(secret)) {
    return undefined;
  }

  let label: string;
  try {
    label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return undefined;
  }

  const colonIndex = label.indexOf(":");
  const labelIssuer = colonIndex >= 0 ? label.slice(0, colonIndex).trim() : "";
  const accountName = (colonIndex >= 0 ? label.slice(colonIndex + 1) : label).trim();
  const queryIssuer = getQueryParam(queryParams, "issuer")?.trim();
  const issuer = queryIssuer || labelIssuer;
  if (!issuer && !accountName) {
    return undefined;
  }

  const digitsValue = parsePositiveInteger(getQueryParam(queryParams, "digits"));
  const digits = digitsValue === 8 ? 8 : 6;
  const period = parsePositiveInteger(getQueryParam(queryParams, "period")) ?? 30;

  return {
    id: crypto.randomUUID(),
    issuer,
    accountName,
    secret,
    algorithm: parseAlgorithm(getQueryParam(queryParams, "algorithm")),
    digits,
    period,
    createdAt: new Date().toISOString(),
    usageCount: 0,
  };
}
