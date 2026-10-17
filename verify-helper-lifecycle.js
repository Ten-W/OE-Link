const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const crypto = require("node:crypto");
const helper = fs.readFileSync(path.join(__dirname, "oe-link-helper/js/plugin.js"), "utf8");
const version = helper.match(/HELPER_VERSION = "([^"]+)"/)[1];
const nextVersion = version.replace(/\d+$/, value => Number(value) + 1);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  const deadline = Date.now() + 6000;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check(), "Lifecycle operation did not settle");
}
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); });

async function fixture(test) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oe-lifecycle-test-"));
  const mapping = new Map(), servers = [], instances = [], attempts = [], credentials = [];
  let saveGate;
  try {
    for (const port of [41598, 41599, 41600, 6060, 6061]) {
      const slot = http.createServer();
      await new Promise(resolve => slot.listen(0, "127.0.0.1", resolve));
      mapping.set(port, slot.address().port);
      await close(slot);
    }
    const request = (port, method, route, data, headers = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: mapping.get(port), method, path: route, headers: { "Connection": "close", ...headers } }, res => {
        let text = "";
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(4000, () => req.destroy(new Error("Test request timeout")));
      req.end(data ? JSON.stringify(data) : undefined);
    });
    function spawn({ release = version, library = "same.library", oldStart = false } = {}) {
      let state, unload;
      let operations = {};
      const eagle = {
        library: { path: path.join(directory, library) },
        item: { getById: async () => ({ filePath: path.join(__dirname, "logo.svg"), folders: [], save: async () => { if (saveGate) await saveGate; } }) }
      };
      const context = {
        URL, Buffer, setTimeout, clearTimeout,
        document: { readyState: "loading", addEventListener(name, callback) { operations.launch = callback; } },
        window: { eagle, addEventListener(name, callback) { unload = callback; } }, eagle,
        console: { log() {}, error() {}, warn() {} },
        require(name) {
          if (name === "os") return { ...os, tmpdir: () => directory };
          if (name === "http") return {
            createServer(handler) {
              const server = http.createServer(handler), listen = server.listen.bind(server);
              server.listen = (port, host, callback) => {
                assert.ok(mapping.has(port), "Only bind test-owned ports");
                attempts.push(port);
                return listen(mapping.get(port), host, callback);
              };
              servers.push(server);
              return server;
            },
            request(options, callback) {
              assert.ok(mapping.has(options.port));
              credentials.push({ method: options.method, sent: !!options.headers["X-OE-Link-Owner"] });
              return http.request({ ...options, port: mapping.get(options.port) }, callback);
            }
          };
          return require(name);
        },
        expose(getState, ops) { state = getState; operations = { ...operations, ...ops }; }
      };
      let code = helper.replace(`HELPER_VERSION = "${version}"`, `HELPER_VERSION = "${release}"`);
      if (oldStart) code = code.replace("const startedAt = Date.now();", "const startedAt = Date.now() - 3000;");
      vm.runInNewContext(code.replace(/\}\)\(\);\s*$/, "expose(() => ({ server, serverPort, mediaServer, mediaConfig, starting, stopping, activeRequests }), { startServer, startMediaServer, stopMediaServer, configureMediaService }); })();"), context);
      const instance = { state, operations, unload: () => unload(), eagle };
      instances.push(instance);
      operations.launch({ type: "DOMContentLoaded" });
      return instance;
    }
    await test({
      directory, mapping, servers, attempts, request, spawn,
      token: () => fs.readFileSync(path.join(directory, "oe-link-helper-owner-v1"), "utf8"),
      blockSave: gate => { saveGate = gate; }
    });
    assert.ok(credentials.filter(item => item.method === "GET").every(item => !item.sent), "Never reveal a credential during discovery");
  } finally {
    for (const instance of instances) instance.unload();
    await waitFor(() => instances.every(instance => !instance.state().starting));
    await Promise.all(servers.map(close));
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async () => {
  await fixture(async ({ spawn, attempts }) => {
    const first = spawn();
    await waitFor(() => !first.state().starting);
    const second = spawn();
    await waitFor(() => !second.state().starting);
    assert.equal(second.state().server, null, "Reuse a healthy compatible helper instead of creating another service");
    assert.equal(first.state().server.listening, true);
    assert.equal(attempts.filter(port => port === 6060).length, 1);
  });

  await fixture(async ({ spawn, request }) => {
    const first = spawn();
    await waitFor(() => !first.state().starting);
    await first.operations.configureMediaService({ port: 6061, libraryPaths: ["preserved.library"] });
    const second = spawn({ release: nextVersion });
    await waitFor(() => !second.state().starting);
    assert.equal(first.state().stopping, true, "An authenticated idle older instance should release its services");
    assert.equal(second.state().serverPort, 41598);
    assert.equal(second.state().mediaConfig.port, 6061);
    assert.deepEqual(Array.from(second.state().mediaConfig.libraryPaths), ["preserved.library"]);
    assert.equal((await request(41598, "GET", "/health")).body.version, nextVersion);
  });

  await fixture(async ({ spawn }) => {
    const first = spawn({ oldStart: true });
    await waitFor(() => !first.state().starting);
    await first.operations.stopMediaServer();
    const second = spawn();
    await waitFor(() => !second.state().starting);
    assert.equal(first.state().stopping, true, "An authenticated unhealthy idle instance should allow replacement");
    assert.equal(second.state().serverPort, 41598);
    assert.equal(second.state().mediaServer.listening, true);
  });

  await fixture(async ({ spawn, request, token, blockSave }) => {
    const first = spawn();
    await waitFor(() => !first.state().starting);
    const health = (await request(41598, "GET", "/health")).body;
    const body = { instanceId: health.instanceId, libraryKey: health.libraryKey };
    assert.equal((await request(41598, "POST", "/lifecycle/shutdown", body)).status, 403);
    const auth = { "X-OE-Link-Owner": token() };
    assert.equal((await request(41598, "POST", "/lifecycle/shutdown", body, { ...auth, Origin: "https://example.com" })).status, 403);
    assert.equal((await request(41598, "POST", "/lifecycle/shutdown", { ...body, instanceId: "wrong" }, auth)).status, 409);
    assert.equal((await request(41598, "POST", "/lifecycle/shutdown", { ...body, libraryKey: "wrong" }, auth)).status, 409);
    let release;
    blockSave(new Promise(resolve => { release = resolve; }));
    const write = request(41598, "POST", "/item/add-folder", { itemId: "test", folderId: "folder" });
    await waitFor(() => first.state().activeRequests === 1);
    try {
      assert.equal((await request(41598, "POST", "/lifecycle/shutdown", body, auth)).status, 409);
      const second = spawn({ release: nextVersion });
      await waitFor(() => !second.state().starting);
      assert.equal(first.state().stopping, false, "Never replace an instance while an item save is in flight");
      assert.equal(first.state().mediaServer.listening, true);
      assert.equal(second.state().server, null, "Wait for a busy owned instance rather than occupying another port");
      release();
      await waitFor(() => second.state().mediaServer?.listening);
      assert.equal(second.state().serverPort, 41598, "Finish the deferred handoff once the write completes");
    } finally { release(); }
    assert.equal((await write).status, 200);
  });

  await fixture(async ({ spawn }) => {
    const first = spawn({ library: "other.library" });
    await waitFor(() => !first.state().starting);
    const second = spawn({ release: nextVersion });
    await waitFor(() => !second.state().starting);
    assert.equal(first.state().stopping, false, "Do not replace a helper serving a different Eagle library");
    assert.equal(second.state().serverPort, 41599);
  });

  await fixture(async ({ spawn }) => {
    const first = spawn();
    await waitFor(() => !first.state().starting);
    const second = spawn({ release: nextVersion });
    const third = spawn({ release: nextVersion });
    await waitFor(() => first.state().stopping);
    await waitFor(() => [second, third].some(instance => instance.state().mediaServer?.listening));
    await delay(1300);
    assert.equal([second, third].filter(instance => instance.state().server?.listening).length, 1,
      "Concurrent replacements must converge to one owner, not fill spare ports");
  });

  await fixture(async ({ spawn, attempts, request }) => {
    const first = spawn();
    await Promise.all([
      first.operations.startMediaServer(), first.operations.startMediaServer(),
      first.operations.configureMediaService({ port: 6060, libraryPaths: [] }),
      first.operations.configureMediaService({ port: 6060, libraryPaths: [] })
    ]);
    await waitFor(() => !first.state().starting);
    assert.equal(attempts.filter(port => port === 6060).length, 1, "Concurrent startup/configuration must share one media listener");
    first.unload();
    await waitFor(() => !first.state().server.listening && !first.state().mediaServer.listening);
    await assert.rejects(request(41598, "GET", "/health"), /ECONNREFUSED|socket hang up/);
  });

  await fixture(async ({ spawn, mapping, servers, directory }) => {
    let shutdownCalls = 0;
    const key = crypto.createHash("sha256").update(path.resolve(directory, "same.library").replace(/\\/g, "/").toLowerCase()).digest("hex");
    const foreign = http.createServer((req, res) => {
      assert.equal(req.headers["x-oe-link-owner"], undefined);
      if (req.method === "POST") shutdownCalls++;
      res.end(JSON.stringify({ service: "oe-link-helper", lifecycleProtocol: 1, instanceId: "a".repeat(32), libraryKey: key, ownershipProof: "b".repeat(64), version: "99.0.0", mediaListening: true }));
    });
    servers.push(foreign);
    await new Promise(resolve => foreign.listen(mapping.get(41598), "127.0.0.1", resolve));
    const instance = spawn();
    await waitFor(() => !instance.state().starting);
    assert.equal(instance.state().serverPort, 41599);
    assert.equal(shutdownCalls, 0, "A claimed service name is not proof of ownership");
    assert.equal(foreign.listening, true);
  });
  await fixture(async ({ spawn, mapping, servers, request }) => {
    const first = spawn();
    await waitFor(() => !first.state().starting);
    const captured = (await request(41598, "GET", "/health")).body;
    first.unload();
    await waitFor(() => !first.state().server.listening && !first.state().mediaServer.listening);
    const replay = http.createServer((req, res) => {
      assert.equal(req.method, "GET", "Never send a shutdown credential to a replayed identity");
      assert.equal(req.headers["x-oe-link-owner"], undefined);
      const challenge = new URL(req.url, "http://localhost").searchParams.get("challenge");
      res.end(JSON.stringify({ ...captured, challenge, version: "99.0.0" }));
    });
    servers.push(replay);
    await new Promise(resolve => replay.listen(mapping.get(41598), "127.0.0.1", resolve));
    const second = spawn();
    await waitFor(() => !second.state().starting);
    assert.equal(second.state().serverPort, 41599, "A copied old health response must not prove current ownership");
    assert.equal(replay.listening, true);
  });
  console.log("Helper healthy reuse, authenticated handoff, busy/foreign protection, media concurrency and unload checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
