const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const CORE_BINARY_NAME = process.platform === "win32" ? "winotp-core.exe" : "winotp-core";
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;

class RustCoreUnavailableError extends Error {
  constructor(message = "The WinOTP Rust core is unavailable.") {
    super(message);
    this.name = "RustCoreUnavailableError";
  }
}

function classifyLaunchError(error) {
  if (error?.code === "ENOENT") {
    return new RustCoreUnavailableError(error.message);
  }
  return error instanceof Error ? error : new Error("The WinOTP Rust core could not be started.");
}

function getCoreBinaryCandidates({
  environment = process.env,
  platform = process.platform,
  dirname = __dirname,
} = {}) {
  const binaryName = platform === "win32" ? "winotp-core.exe" : "winotp-core";
  const candidates = [];
  if (environment.WINOTP_CORE_BINARY) {
    candidates.push(environment.WINOTP_CORE_BINARY);
  }

  candidates.push(path.join(dirname, "..", "native", binaryName));
  candidates.push(path.join(dirname, "..", "..", "native", binaryName));
  candidates.push(path.join(dirname, "..", "..", "rust", "target", "release", binaryName));
  candidates.push(path.join(dirname, "..", "..", "rust", "target", "debug", binaryName));

  if (environment.RESOURCES_PATH) {
    candidates.push(path.join(environment.RESOURCES_PATH, "updater", binaryName));
  }
  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "updater", binaryName));
  }
  return [...new Set(candidates)];
}

function resolveRustCoreBinary(options = {}) {
  return getCoreBinaryCandidates(options).find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function hasRustCoreBinary(options = {}) {
  return Boolean(resolveRustCoreBinary(options));
}

function parseRustCoreOutput(stdout) {
  const output = String(stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  if (!output) {
    throw new Error("The WinOTP Rust core returned no response.");
  }

  let response;
  try {
    response = JSON.parse(output);
  } catch {
    throw new Error("The WinOTP Rust core returned invalid JSON.");
  }
  if (response?.ok !== true) {
    throw new Error(String(response?.error ?? "The WinOTP Rust core rejected the request."));
  }
  return response.result;
}

function serializeRustCoreRequest(operation, input, maxInputBytes = DEFAULT_MAX_INPUT_BYTES) {
  const request = JSON.stringify({ operation, input });
  if (Buffer.byteLength(request, "utf8") > maxInputBytes) {
    throw new Error("The WinOTP Rust core request is too large.");
  }
  return request;
}

function runRustCore(operation, input = {}, options = {}) {
  const request = serializeRustCoreRequest(
    operation,
    input,
    options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
  );
  const binaryPath = options.binaryPath ?? resolveRustCoreBinary(options);
  if (!binaryPath) {
    throw new RustCoreUnavailableError();
  }

  const child = spawnSync(binaryPath, [], {
    input: request,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (child.error) {
    throw classifyLaunchError(child.error);
  }
  if (child.status !== 0) {
    throw new Error(`The WinOTP Rust core exited with status ${child.status ?? "unknown"}.`);
  }

  return parseRustCoreOutput(child.stdout);
}

function runRustCoreAsync(operation, input = {}, options = {}) {
  let request;
  try {
    request = serializeRustCoreRequest(
      operation,
      input,
      options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    );
  } catch (error) {
    return Promise.reject(error);
  }

  const binaryPath = options.binaryPath ?? resolveRustCoreBinary(options);
  if (!binaryPath) {
    return Promise.reject(new RustCoreUnavailableError());
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
  const {
    binaryPath: _binaryPath,
    timeoutMs: _timeoutMs,
    maxBuffer: _maxBuffer,
    app: _app,
    environment: _environment,
    platform: _platform,
    dirname: _dirname,
    maxInputBytes: _maxInputBytes,
    ...spawnOptions
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binaryPath, [], {
        ...spawnOptions,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(classifyLaunchError(error));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout;

    const terminate = () => {
      try {
        child.kill();
      } catch {
        // The process may have already exited.
      }
    };

    const settle = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const appendOutput = (current, chunk) => {
      const next = `${current}${String(chunk)}`;
      if (Buffer.byteLength(next, "utf8") > maxBuffer) {
        terminate();
        settle(new Error("The WinOTP Rust core returned too much data."));
        return undefined;
      }
      return next;
    };

    child.stdout.on("data", (chunk) => {
      if (!settled) {
        stdout = appendOutput(stdout, chunk) ?? stdout;
      }
    });
    child.stderr.on("data", (chunk) => {
      if (!settled) {
        stderr = appendOutput(stderr, chunk) ?? stderr;
      }
    });
    child.on("error", (error) => {
      settle(classifyLaunchError(error));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim();
        settle(
          new Error(
            detail
              ? `The WinOTP Rust core exited with status ${code ?? "unknown"}: ${detail}`
              : `The WinOTP Rust core exited with status ${code ?? "unknown"}.`,
          ),
        );
        return;
      }

      try {
        settle(undefined, parseRustCoreOutput(stdout));
      } catch (error) {
        settle(error);
      }
    });
    child.stdin.on("error", (error) => {
      settle(
        new Error(
          error instanceof Error
            ? `The WinOTP Rust core request failed: ${error.message}`
            : "The WinOTP Rust core request failed.",
        ),
      );
    });

    timeout = setTimeout(() => {
      terminate();
      settle(new Error("The WinOTP Rust core timed out."));
    }, timeoutMs);

    child.stdin.end(request);
  });
}

function tryRunRustCore(operation, input = {}, options = {}) {
  const binaryPath = resolveRustCoreBinary(options);
  if (!binaryPath) {
    return undefined;
  }
  try {
    return runRustCore(operation, input, { ...options, binaryPath });
  } catch (error) {
    if (error instanceof RustCoreUnavailableError) {
      return undefined;
    }
    throw error;
  }
}

module.exports = {
  CORE_BINARY_NAME,
  DEFAULT_MAX_INPUT_BYTES,
  RustCoreUnavailableError,
  getCoreBinaryCandidates,
  hasRustCoreBinary,
  resolveRustCoreBinary,
  runRustCore,
  runRustCoreAsync,
  serializeRustCoreRequest,
  tryRunRustCore,
};
