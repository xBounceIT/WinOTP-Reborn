const { runRustCore, runRustCoreAsync } = require("./rust-core.cjs");

const TOTP_BATCH_SIZE = 256;

function placeholderCode(digits) {
  return "—".repeat(digits === 8 ? 8 : 6);
}

function generateTotpCode(account, timestamp = Date.now()) {
  try {
    const result = runRustCore("totp-code", {
      account,
      unixSeconds: Math.floor(Number(timestamp) / 1000),
    });
    if (!result || typeof result.code !== "string") {
      throw new Error("The WinOTP Rust core returned invalid TOTP data.");
    }
    return result.code;
  } catch {
    return placeholderCode(account?.digits);
  }
}

function generateTotpCodes(accounts, timestamp = Date.now()) {
  const source = Array.isArray(accounts) ? accounts : [];
  if (source.length === 0) {
    return [];
  }

  const codes = [];
  for (let offset = 0; offset < source.length; offset += TOTP_BATCH_SIZE) {
    const chunk = source.slice(offset, offset + TOTP_BATCH_SIZE);
    try {
      const rustResults = runRustCore("totp-codes", {
        accounts: chunk,
        unixSeconds: Math.floor(Number(timestamp) / 1000),
      });
      if (!Array.isArray(rustResults) || rustResults.length !== chunk.length) {
        throw new Error("The WinOTP Rust core returned invalid TOTP data.");
      }
      codes.push(
        ...rustResults.map((result, index) =>
          result?.ok === true && typeof result.code === "string"
            ? result.code
            : placeholderCode(chunk[index]?.digits),
        ),
      );
    } catch {
      codes.push(...chunk.map((account) => placeholderCode(account?.digits)));
    }
  }
  return codes;
}

async function generateTotpPreviews(accounts, timestamp = Date.now()) {
  const source = Array.isArray(accounts) ? accounts : [];
  if (source.length === 0) {
    return [];
  }

  const previews = [];
  for (let offset = 0; offset < source.length; offset += TOTP_BATCH_SIZE) {
    const chunk = source.slice(offset, offset + TOTP_BATCH_SIZE);
    try {
      const rustResults = await runRustCoreAsync("totp-previews", {
        accounts: chunk,
        unixSeconds: Math.floor(Number(timestamp) / 1000),
      });
      if (!Array.isArray(rustResults) || rustResults.length !== chunk.length) {
        throw new Error("The WinOTP Rust core returned invalid TOTP preview data.");
      }
      previews.push(
        ...rustResults.map((result, index) =>
          result?.ok === true &&
          typeof result.code === "string" &&
          typeof result.nextCode === "string" &&
          Number.isInteger(result.remainingSeconds)
            ? result
            : {
                code: placeholderCode(chunk[index]?.digits),
                nextCode: placeholderCode(chunk[index]?.digits),
                remainingSeconds: 0,
              },
        ),
      );
    } catch {
      previews.push(
        ...chunk.map((account) => ({
          code: placeholderCode(account?.digits),
          nextCode: placeholderCode(account?.digits),
          remainingSeconds: 0,
        })),
      );
    }
  }
  return previews;
}

function createTotpPreviewRunner(generator: (...args: any[]) => any = generateTotpPreviews) {
  let activeKey;
  let activeRequest;
  let queued; // { key, args, resolve, reject, promise } for the latest pending request

  function drainQueue() {
    if (activeRequest || !queued) {
      return;
    }
    const { key, args, resolve, reject, promise } = queued;
    queued = undefined;
    activeKey = key;
    activeRequest = promise;
    Promise.resolve()
      .then(() => generator(...args))
      .then(resolve, reject);
    const clearActive = () => {
      if (activeRequest === promise) {
        activeKey = undefined;
        activeRequest = undefined;
      }
      drainQueue();
    };
    void promise.then(clearActive, clearActive);
  }

  return (...args: any[]) => {
    const key = JSON.stringify(args);
    if (activeRequest && activeKey === key) {
      return activeRequest;
    }
    if (queued) {
      if (queued.key === key) {
        return queued.promise;
      }
      queued.promise.catch(() => undefined);
      queued.reject(new Error("TOTP preview request superseded by a newer request."));
      queued = undefined;
    }
    const promise = new Promise((resolve, reject) => {
      queued = { key, args, resolve, reject };
    });
    queued.promise = promise;
    drainQueue();
    return promise;
  };
}

module.exports = {
  createTotpPreviewRunner,
  generateTotpCode,
  generateTotpCodes,
  generateTotpPreviews,
};
