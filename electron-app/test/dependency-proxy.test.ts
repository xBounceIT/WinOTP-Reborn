import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Electron Builder downloads and verifies artifacts through the updated proxy agent", async (context) => {
  const artifact = Buffer.from("WinOTP proxy download test");
  const filename = `electron-v43.5.0-${process.platform}-${process.arch}.zip`;
  const digest = createHash("sha256").update(artifact).digest("hex");
  const requests: string[] = [];
  const proxy = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end(request.url?.endsWith("SHASUMS256.txt") ? `${digest} *${filename}\n` : artifact);
  });
  context.after(() => proxy.close());
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");

  const directory = await mkdtemp(path.join(os.tmpdir(), "winotp-proxy-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const previousProxy = process.env.GLOBAL_AGENT_HTTP_PROXY;
  const previousNoProxy = process.env.GLOBAL_AGENT_NO_PROXY;
  context.after(() => {
    if (previousProxy === undefined) delete process.env.GLOBAL_AGENT_HTTP_PROXY;
    else process.env.GLOBAL_AGENT_HTTP_PROXY = previousProxy;
    if (previousNoProxy === undefined) delete process.env.GLOBAL_AGENT_NO_PROXY;
    else process.env.GLOBAL_AGENT_NO_PROXY = previousNoProxy;
  });
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${address.port}`;
  process.env.GLOBAL_AGENT_NO_PROXY = "";

  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
  const downloader = builderRequire("@electron/get");
  downloader.initializeProxy();
  const downloaded = await downloader.downloadArtifact({
    version: "43.5.0",
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    cacheRoot: directory,
    mirrorOptions: { mirror: "http://winotp-download.invalid/" },
    downloadOptions: { quiet: true, timeout: { request: 5_000 }, retry: { limit: 0 } },
  });

  assert.deepEqual(await readFile(downloaded), artifact);
  assert.ok(requests.some((url) => url === `http://winotp-download.invalid/v43.5.0/${filename}`));
  assert.ok(requests.some((url) => url.endsWith("/SHASUMS256.txt")));
});
