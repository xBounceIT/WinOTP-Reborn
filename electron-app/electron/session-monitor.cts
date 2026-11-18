const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { resolveRustCoreBinary } = require("./rust-core.cjs");
const SESSION_WATCH_RESTART_DELAY_MS = 5_000;
const SESSION_WATCH_ERROR_RESTART_DELAY_MS = 60_000;
const MAX_SESSION_WATCH_OUTPUT_BYTES = 64 * 1024;

function parseSessionWatchMessage(line) {
  try {
    const event = JSON.parse(line);
    if (event?.ok === true && typeof event.event?.reason === "string") {
      return {
        reason: event.event.reason,
        snapshot: event.event.snapshot === true,
      };
    }
    if (event?.ok === false && typeof event.error === "string" && event.error.trim()) {
      return { error: event.error.trim() };
    }
  } catch {
    // Malformed watcher output must not interrupt later transitions.
  }
  return {};
}

function shouldStartSessionChangeWatcher(platform = process.platform) {
  return platform === "win32" || platform === "linux";
}

function startSessionChangeWatcher(options: any = {}) {
  const resolveBinary = options.resolveRustCoreBinary ?? resolveRustCoreBinary;
  const binaryPath = options.binaryPath ?? resolveBinary(options);
  const onSessionChange = options.onSessionChange ?? (() => undefined);
  const onError = options.onError ?? (() => undefined);
  const createChild =
    options.createChild ?? ((binary, spawnOptions) => spawn(binary, [], spawnOptions));
  const restartDelayMs = options.restartDelayMs ?? SESSION_WATCH_RESTART_DELAY_MS;
  const errorRestartDelayMs = options.errorRestartDelayMs ?? SESSION_WATCH_ERROR_RESTART_DELAY_MS;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_SESSION_WATCH_OUTPUT_BYTES;
  let child;
  let restartTimer;
  let stopped = false;
  let startAttempts = 0;

  const stop = () => {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
    if (child) {
      try {
        child.kill();
      } catch {
        // The watcher may have already exited.
      }
      child = undefined;
    }
  };

  const start = () => {
    if (stopped) {
      return;
    }
    const suppressInitialSnapshot = startAttempts === 0;
    startAttempts += 1;
    let stdoutBuffer = "";
    let watcherReportedError = false;
    try {
      child = createChild(binaryPath, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error("Unable to start the session watcher."));
      restartTimer = setTimeout(start, errorRestartDelayMs);
      return;
    }
    const watcherChild = child;
    const stdoutDecoder = new StringDecoder("utf8");
    let terminatingForOutput = false;
    const terminateForOutput = () => {
      if (terminatingForOutput) {
        return;
      }
      terminatingForOutput = true;
      watcherReportedError = true;
      onError(new Error("The session-change watcher returned too much output."));
      stdoutBuffer = "";
      watcherChild.kill();
    };
    const consumeOutput = (text) => {
      if (stopped || terminatingForOutput) {
        return;
      }
      stdoutBuffer += text;
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (Buffer.byteLength(rawLine) > maxOutputBytes) {
          terminateForOutput();
          return;
        }
        const line = rawLine.trim();
        const message = parseSessionWatchMessage(line);
        if (message.reason && (!message.snapshot || !suppressInitialSnapshot)) {
          onSessionChange(message.reason);
        } else if (message.error) {
          watcherReportedError = true;
          onError(new Error(message.error));
        }
      }
      if (Buffer.byteLength(stdoutBuffer) > maxOutputBytes) {
        terminateForOutput();
      }
    };
    watcherChild.stdout?.on("data", (chunk) => {
      consumeOutput(Buffer.isBuffer(chunk) ? stdoutDecoder.write(chunk) : String(chunk));
    });
    watcherChild.on("error", (error) => {
      watcherReportedError = true;
      if (!stopped) {
        onError(error);
      }
    });
    watcherChild.on("close", (code) => {
      const finalOutput = stdoutDecoder.end();
      consumeOutput(finalOutput);
      if (child === watcherChild) {
        child = undefined;
      }
      if (!stopped) {
        if (code !== 0) {
          if (!watcherReportedError) {
            onError(
              new Error(`The session-change watcher exited with status ${code ?? "unknown"}.`),
            );
          }
          watcherReportedError = true;
        }
        restartTimer = setTimeout(
          start,
          watcherReportedError ? errorRestartDelayMs : restartDelayMs,
        );
      }
    });
    watcherChild.stdin?.end(JSON.stringify({ operation: "session-watch", input: {} }));
  };

  if (!binaryPath) {
    onError(new Error("The WinOTP Rust core is unavailable."));
  } else {
    start();
  }
  return { stop };
}

module.exports = { shouldStartSessionChangeWatcher, startSessionChangeWatcher };
