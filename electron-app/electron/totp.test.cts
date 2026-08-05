const assert = require("node:assert/strict");
const test = require("node:test");

const { createTotpPreviewRunner, generateTotpCode, generateTotpCodes } = require("./totp.cjs");

const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const rfcSha256Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const rfcSha512Secret =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

test("generates the RFC 6238 SHA-1 vector", () => {
  assert.equal(
    generateTotpCode(
      {
        secret: rfcSecret,
        algorithm: "SHA1",
        digits: 8,
        period: 30,
      },
      59_000,
    ),
    "94287082",
  );
});

test("supports the RFC 6238 SHA-256 and SHA-512 vectors", () => {
  const shared = { digits: 8, period: 30 };
  assert.equal(
    generateTotpCode({ ...shared, secret: rfcSha256Secret, algorithm: "SHA256" }, 59_000),
    "46119246",
  );
  assert.equal(
    generateTotpCode({ ...shared, secret: rfcSha512Secret, algorithm: "SHA512" }, 59_000),
    "90693936",
  );
});

test("returns a safe placeholder for invalid TOTP input", () => {
  assert.equal(
    generateTotpCode(
      {
        secret: "not-base32!",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
      59_000,
    ),
    "——————",
  );
});

test("generates a batch of TOTP codes through the Rust core", () => {
  const codes = generateTotpCodes(
    [
      { secret: rfcSecret, algorithm: "SHA1", digits: 8, period: 30 },
      { secret: rfcSha256Secret, algorithm: "SHA256", digits: 8, period: 30 },
    ],
    59_000,
  );

  assert.deepEqual(codes, ["94287082", "46119246"]);
});

test("coalesces overlapping TOTP preview sidecar requests", async () => {
  let release;
  let calls = 0;
  const runner = createTotpPreviewRunner(() => {
    calls += 1;
    return calls === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(["next"]);
  });

  const first = runner([], 1);
  const overlapping = runner([], 1);
  const newer = runner([], 2);
  assert.equal(overlapping, first);
  await Promise.resolve();
  release(["first"]);
  assert.deepEqual(await first, ["first"]);
  assert.deepEqual(await overlapping, ["first"]);
  assert.deepEqual(await newer, ["next"]);
  assert.equal(calls, 2);
});

test("collapses queued TOTP preview requests to the latest", async () => {
  let release;
  let calls = 0;
  const runner = createTotpPreviewRunner(() => {
    calls += 1;
    return calls === 1
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(["latest"]);
  });

  const first = runner([], 1);
  const superseded = runner([], 2);
  const latest = runner([], 3);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(["first"]);
  assert.deepEqual(await first, ["first"]);
  await assert.rejects(superseded, /superseded/i);
  assert.deepEqual(await latest, ["latest"]);
  assert.equal(calls, 2);
});
