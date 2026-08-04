const crypto = require("node:crypto");

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const hashAlgorithms = {
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
};

function decodeBase32(value) {
  const cleanValue = String(value ?? "")
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/=+$/, "");
  if (!cleanValue || !/^[A-Z2-7]+$/.test(cleanValue)) {
    return Buffer.alloc(0);
  }

  const bytes = [];
  let buffer = 0;
  let bits = 0;

  for (const character of cleanValue) {
    buffer = buffer * 32 + base32Alphabet.indexOf(character);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(buffer / 2 ** bits) & 0xff);
      buffer %= 2 ** bits;
    }
  }

  return Buffer.from(bytes);
}

function placeholderCode(digits) {
  return "—".repeat(digits === 8 ? 8 : 6);
}

function generateTotpCode(account, timestamp = Date.now()) {
  const digits = account?.digits === 8 ? 8 : 6;

  try {
    const secret = decodeBase32(account?.secret);
    const period = Number(account?.period);
    const algorithm = hashAlgorithms[String(account?.algorithm ?? "").toUpperCase()];
    const counter = Math.floor(Number(timestamp) / 1000 / period);

    if (
      secret.length === 0 ||
      !algorithm ||
      !Number.isInteger(period) ||
      period <= 0 ||
      !Number.isSafeInteger(counter) ||
      counter < 0
    ) {
      return placeholderCode(digits);
    }

    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac(algorithm, secret).update(counterBytes).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    if (offset + 4 > digest.length) {
      return placeholderCode(digits);
    }

    const binaryCode = digest.readUInt32BE(offset) & 0x7fffffff;
    return String(binaryCode % 10 ** digits).padStart(digits, "0");
  } catch {
    return placeholderCode(digits);
  }
}

module.exports = { generateTotpCode };
