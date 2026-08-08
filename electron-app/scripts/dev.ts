import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteEntry = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const electronEntry = path.join(projectRoot, "node_modules", "electron", "cli.js");
const preferredPort = Number.parseInt(process.env.VITE_DEV_PORT ?? "5173", 10);

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort: number) {
  for (let port = Number.isInteger(startPort) ? startPort : 5173; port <= 65_535; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error("No available loopback port was found for the Vite development server.");
}

function waitForPort(port: number, timeoutMs = 30_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          finish(new Error(`Vite did not start on port ${port}.`));
          return;
        }
        retryTimer = setTimeout(attempt, 100);
      });
    };

    attempt();
  });
}

function terminate(child: ChildProcess | undefined) {
  if (!child || !child.pid || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill("SIGTERM");
}

async function run() {
  const port = await findAvailablePort(preferredPort);
  const rendererUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    VITE_DEV_PORT: String(port),
    VITE_DEV_SERVER_URL: rendererUrl,
  };
  const vite = spawn(
    process.execPath,
    [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: projectRoot, env: environment, stdio: "inherit", windowsHide: true },
  );
  let electron: ChildProcess | undefined;
  let stopping = false;

  const stop = (exitCode: number) => {
    if (stopping) {
      return;
    }
    stopping = true;
    terminate(electron);
    terminate(vite);
    process.exitCode = exitCode;
  };

  vite.once("exit", (code) => {
    if (!stopping) {
      stop(code ?? 1);
    }
  });

  try {
    await waitForPort(port);
    if (stopping) {
      return;
    }

    electron = spawn(process.execPath, [electronEntry, ".", "--dev"], {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
      windowsHide: false,
    });
    electron.once("exit", (code) => stop(code ?? 0));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    stop(1);
  }

  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
