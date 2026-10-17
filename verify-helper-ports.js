const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8");
const helper = fs.readFileSync(path.join(__dirname, "oe-link-helper/js/plugin.js"), "utf8");
const ports = Array.from({ length: 8 }, (_, index) => 41598 + index);
const required = source.match(/EAGLE_HELPER_PLUGIN_VERSION = "([^"]+)"/)[1];
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); });

// Map virtual helper ports to ephemeral loopback ports; never occupy the user's services.
async function startupScenario(busyCount, foreignStartsFirst, readyState = "loading") {
  const blockers = [], servers = [], attempts = [], errors = [];
  const occupied = new Map();
  let listener, snapshot;
  try {
    for (const port of ports.slice(0, busyCount)) {
      const blocker = http.createServer((req, res) => res.end("foreign service"));
      await listen(blocker);
      blockers.push(blocker);
      occupied.set(port, blocker.address().port);
    }
    const foreignServices = [];
    const startForeignServices = async () => {
      for (const port of [41596, 41597]) {
        const service = http.createServer((req, res) => res.end(JSON.stringify({ service: "foreign", version: "99.0.0" })));
        await listen(service);
        blockers.push(service);
        foreignServices.push(service);
        occupied.set(port, service.address().port);
      }
    };
    if (foreignStartsFirst) await startForeignServices();
    const context = {
      document: { readyState, addEventListener: (name, callback) => { listener = callback; } },
      URL, Buffer, setTimeout, clearTimeout,
      console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(" ")) },
      require: name => name === "http" ? {
        request(options, callback) {
          assert.ok(occupied.has(options.port), "Only probe a test-owned listener");
          assert.equal(options.headers["X-OE-Link-Owner"], undefined, "Never send a credential to an unverified listener");
          return http.request({ ...options, port: occupied.get(options.port) }, callback);
        },
        createServer(handler) {
          const server = http.createServer(handler);
          const original = server.listen.bind(server);
          server.listen = (port, host, callback) => {
            assert.ok(port === 6060 || ports.includes(port), `Never bind Eagle's reserved port ${port}`);
            if (port !== 6060) attempts.push(port);
            return original(occupied.get(port) || 0, host, callback);
          };
          servers.push(server);
          return server;
        }
      } : require(name),
      expose: getState => { snapshot = getState; }
    };
    vm.runInNewContext(helper.replace(/\}\)\(\);\s*$/, "expose(() => ({ server, serverPort, mediaServer })); })();"), context);
    if (listener) listener({ type: "DOMContentLoaded" });
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const state = snapshot();
      if (busyCount === ports.length ? errors.some(text => text.includes("no available control port")) : state.mediaServer?.listening) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!foreignStartsFirst) await startForeignServices();
    assert.ok(foreignServices.every(service => service.listening), "Foreign services and the helper must coexist in either startup order");
    assert.deepEqual(attempts, ports.slice(0, Math.min(busyCount + 1, ports.length)));
    const state = snapshot();
    if (busyCount === ports.length) {
      assert.equal(state.server, null);
      assert.equal(state.mediaServer, null);
      assert.ok(errors.some(text => text.includes("no available control port")));
    } else {
      assert.equal(state.serverPort, ports[busyCount]);
      assert.equal(state.mediaServer.listening, true);
      const health = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${state.server.address().port}/health`, res => {
          let text = "";
          res.on("data", chunk => { text += chunk; });
          res.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
          res.on("error", reject);
        }).on("error", reject);
      });
      assert.equal(health.service, "oe-link-helper");
      assert.equal(health.port, ports[busyCount]);
    }
  } finally {
    await Promise.all([...servers, ...blockers].map(close));
  }
}

async function discoveryChecks() {
  const start = source.indexOf("  async detectEagleHelperBaseUrl() {");
  const end = source.indexOf("\n  async requestEagleHelperJson", start);
  const responses = new Map();
  const detect = Function("EAGLE_HELPER_PORTS", "nativeRequestUrl", "compareVersions", "EAGLE_HELPER_PLUGIN_VERSION",
    `return ({${source.slice(start, end)}}).detectEagleHelperBaseUrl;`)(ports, async ({ url }) => {
    const port = Number(new URL(url).port);
    assert.ok(![41596, 41597].includes(port));
    return { json: responses.get(port) || { status: "error" } };
  }, (version, minimum) => version === minimum ? 0 : version === "99.0.0" ? 1 : -1, required);
  responses.set(41598, { status: "success", version: "99.0.0", service: "mcp-server" });
  responses.set(41599, { status: "success", version: "99.0.0" });
  responses.set(41600, { status: "success", version: "0.2.13", service: "oe-link-helper" });
  responses.set(41601, { status: "success", version: required, service: "oe-link-helper" });
  assert.equal(await detect.call({}), "http://127.0.0.1:41601");
  responses.delete(41601);
  await assert.rejects(detect.call({}), /OE Link Helper/);
  assert.match(source, /length: 8[^\n]+41598/);
  const probeStart = source.indexOf("  async probeDesktopDiagnosticUrl(");
  const probeEnd = source.indexOf("\n  async exportDesktopDiagnosticLog", probeStart);
  const probe = Function("nativeRequestUrl", `return ({${source.slice(probeStart, probeEnd)}}).probeDesktopDiagnosticUrl;`)(
    async () => ({ status: 200, headers: {}, get json() { throw new Error("not JSON"); } })
  );
  const result = await probe("http://127.0.0.1:41598/health");
  assert.equal(result.status, 200);
  assert.equal(result.service, "other-or-unidentified", "HTTP 200 must not imply this is our helper");
}

(async () => {
  await startupScenario(0, true);
  await startupScenario(0, false);
  await startupScenario(0, false, "complete");
  await startupScenario(3, true);
  await startupScenario(8, true);
  await discoveryChecks();
  console.log("Helper reserved-port avoidance, real bind conflicts, exhaustion and identity checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
