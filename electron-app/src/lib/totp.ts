import type { OtpAccount } from "@/lib/types";

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanValue = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of cleanValue) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      continue;
    }

    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

export async function generateTotpCode(account: OtpAccount, timestamp = Date.now()) {
  try {
    const secret = decodeBase32(account.secret);
    if (secret.length === 0) {
      return "—".repeat(account.digits);
    }

    const counter = BigInt(Math.floor(timestamp / 1000 / account.period));
    const counterBytes = new ArrayBuffer(8);
    const counterView = new DataView(counterBytes);
    counterView.setUint32(0, Number(counter >> 32n));
    counterView.setUint32(4, Number(counter & 0xffffffffn));

    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { hash: `SHA-${account.algorithm.slice(3)}`, name: "HMAC" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
    const offset = digest[digest.length - 1] & 0x0f;
    const binaryCode =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    const code = binaryCode % 10 ** account.digits;

    return code.toString().padStart(account.digits, "0");
  } catch {
    return "—".repeat(account.digits);
  }
}

export function getRemainingSeconds(account: OtpAccount, timestamp = Date.now()) {
  if (account.period <= 0) {
    return 0;
  }

  const unixTime = Math.floor(timestamp / 1000);
  const timeStep = Math.floor(unixTime / account.period);
  const nextTimeStep = (timeStep + 1) * account.period;
  return nextTimeStep - unixTime;
}
