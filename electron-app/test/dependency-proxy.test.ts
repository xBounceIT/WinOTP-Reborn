import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createRequire } from "node:module";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import test from "node:test";

test("Electron Builder downloads and verifies artifacts through the updated proxy agent", async (context) => {
  const artifact = Buffer.from("WinOTP proxy download test");
  const filename = `electron-v43.5.0-${process.platform}-${process.arch}.zip`;
  const digest = createHash("sha256").update(artifact).digest("hex");
  let corruptArtifact = false;
  const requests: string[] = [];
  const proxy = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end(
      request.url?.endsWith("SHASUMS256.txt")
        ? `${digest} *${filename}\n`
        : corruptArtifact
          ? Buffer.from("corrupted artifact")
          : artifact,
    );
  });
  context.after(() => proxy.close());
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(path.join(os.tmpdir(), "winotp-proxy-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const environment = {
    GLOBAL_AGENT_HTTP_PROXY: `http://127.0.0.1:${address.port}`,
    GLOBAL_AGENT_HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
    GLOBAL_AGENT_NO_PROXY: "",
    GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE: "GLOBAL_AGENT_",
    GLOBAL_AGENT_FORCE_GLOBAL_AGENT: "true",
    ELECTRON_GET_NO_PROGRESS: "1",
    NODE_TLS_REJECT_UNAUTHORIZED: "1",
    ROARR_LOG: "1",
  };
  const previousEnvironment = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  context.after(() => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, environment);

  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
  const loggerRequire = createRequire(builderRequire.resolve("global-agent"));
  const logs: string[] = [];
  const loggerState = loggerRequire("roarr").ROARR;
  const previousWrite = loggerState.write;
  loggerState.write = (message: string) => logs.push(message);
  context.after(() => {
    loggerState.write = previousWrite;
  });
  const downloader = builderRequire("@electron/get");
  downloader.initializeProxy();
  function download(
    cacheName: string,
    mirror = "http://winotp-download.invalid/",
    certificateAuthority?: Buffer,
  ): Promise<string> {
    return downloader.downloadArtifact({
      version: "43.5.0",
      artifactName: "electron",
      platform: process.platform,
      arch: process.arch,
      cacheRoot: path.join(directory, cacheName),
      mirrorOptions: { mirror },
      downloadOptions: {
        quiet: true,
        timeout: { request: 5_000 },
        retry: { limit: 0 },
        ...(certificateAuthority ? { https: { certificateAuthority } } : {}),
      },
    });
  }
  const downloaded = await download("");

  assert.deepEqual(await readFile(downloaded), artifact);
  assert.ok(requests.some((url) => url === `http://winotp-download.invalid/v43.5.0/${filename}`));
  assert.ok(requests.some((url) => url.endsWith("/SHASUMS256.txt")));
  assert.ok(logs.some((message) => JSON.parse(message).message === "proxying request"));

  await context.test("rejects an artifact that disagrees with the checksum", async () => {
    corruptArtifact = true;
    try {
      await assert.rejects(download("corrupt"), /did not match expected checksum/);
    } finally {
      corruptArtifact = false;
    }
  });

  await context.test(
    "downloads HTTPS artifacts through CONNECT with certificate validation",
    async (tlsContext) => {
      const cert = await readFile(new URL("./fixtures/proxy-test-cert.pem", import.meta.url));
      const key = await readFile(new URL("./fixtures/proxy-test-key.pem", import.meta.url));
      // This public test key is used only by the loopback TLS server.
      const target = createHttpsServer({ cert, key }, (request, response) => {
        response.end(
          request.url?.endsWith("SHASUMS256.txt") ? `${digest} *${filename}\n` : artifact,
        );
      });
      const sockets = new Set<Duplex>();
      target.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      tlsContext.after(() => {
        for (const socket of sockets) socket.destroy();
        target.close();
      });
      target.listen(0, "127.0.0.1");
      await once(target, "listening");
      const targetAddress = target.address();
      assert.ok(targetAddress && typeof targetAddress !== "string");
      const tunnels: string[] = [];
      proxy.on("connect", (request, client, head) => {
        tunnels.push(request.url ?? "");
        const upstream = connect(targetAddress.port, "127.0.0.1", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        sockets.add(upstream);
        sockets.add(client);
        upstream.once("close", () => {
          sockets.delete(upstream);
          client.destroy();
        });
        client.once("close", () => {
          sockets.delete(client);
          upstream.destroy();
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      });
      const tlsDownloaded = await download("tls", "https://winotp-download.invalid/", cert);
      assert.deepEqual(await readFile(tlsDownloaded), artifact);
      assert.ok(tunnels.includes("winotp-download.invalid:443"));

      await tlsContext.test("rejects an untrusted TLS certificate", async () => {
        await assert.rejects(download("untrusted", "https://winotp-download.invalid/"), {
          code: "DEPTH_ZERO_SELF_SIGNED_CERT",
        });
      });

      await tlsContext.test("rejects a trusted certificate for the wrong hostname", async () => {
        await assert.rejects(download("wrong-host", "https://wrong-host.invalid/", cert), {
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
        });
      });
    },
  );
});
