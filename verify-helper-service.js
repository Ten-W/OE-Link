const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const Module = require("node:module");

const helper = fs.readFileSync(path.join(__dirname, "oe-link-helper/js/plugin.js"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "oe-link-helper/manifest.json"), "utf8"));
assert.equal(helper.match(/const HELPER_VERSION = "([^"]+)"/)[1], manifest.version);
assert.equal(source.match(/const EAGLE_HELPER_PLUGIN_VERSION = "([^"]+)"/)[1], manifest.version);

const resolveStart = source.indexOf("  resolveEagleHelperPluginsDir() {");
const resolveEnd = source.indexOf("\n  async installOrUpdateEagleHelperPlugin", resolveStart);
const resolve = Function("nodeFs", "DEFAULT_SETTINGS", `return ({${source.slice(resolveStart, resolveEnd)}}).resolveEagleHelperPluginsDir;`)(
  { existsSync: value => ["current-user/Plugins", "custom/Plugins"].includes(value), statSync: () => ({ isDirectory: () => true }) },
  { eagleHelperPluginsDir: "current-user/Plugins" }
);
assert.equal(resolve.call({ settings: { eagleHelperPluginsDir: "old-user/Plugins" } }), "current-user/Plugins");
assert.equal(resolve.call({ settings: { eagleHelperPluginsDir: "custom/Plugins" } }), "custom/Plugins");

async function installationChecks() {
  const bundle = fs.readFileSync(path.join(__dirname, "desktop.js"), "utf8");
  const files = JSON.parse(bundle.match(/"\.\/lib\/eagle-helper-files": function\(module\) \{ module.exports = (.*); \}/)[1]);
  for (const [name, contents] of Object.entries(files)) {
    assert.equal(contents, fs.readFileSync(path.join(__dirname, "oe-link-helper", name), "utf8"));
  }
  const start = source.indexOf("  async installOrUpdateEagleHelperPlugin() {");
  const end = source.indexOf("\n  getLanguage()", start);
  const load = Module._load;
  let utils;
  try {
    Module._load = function(name, parent, isMain) {
      return name === "obsidian" ? { TFile: class {} } : load.call(this, name, parent, isMain);
    };
    utils = require("./lib/asset-utils");
  } finally { Module._load = load; }
  const { readJsonFile, compareVersions } = utils;
  const install = Function("require", "nodeFs", "nodePath", "readJsonFile", "compareVersions", "Notice", "EAGLE_HELPER_PLUGIN_ID", "EAGLE_HELPER_PLUGIN_VERSION",
    `return ({${source.slice(start, end)}}).installOrUpdateEagleHelperPlugin;`)(
    () => files, fs, path, readJsonFile, compareVersions, class {}, "oe-link-helper", manifest.version
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oe-helper-test-"));
  const target = path.join(directory, "oe-link-helper");
  let saves = 0;
  try {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({ id: "oe-link-helper", version: "0.2.13" }));
    const plugin = {
      settings: { eagleHelperPluginsDir: "old-user/Plugins" },
      resolveEagleHelperPluginsDir: () => directory,
      saveSettings: async () => { saves++; }, t: key => key
    };
    assert.equal(await install.call(plugin), true, "A community install without a helper folder must update the old helper");
    for (const [name, contents] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(target, name), "utf8"), contents);
    assert.equal(plugin.settings.eagleHelperPluginsDir, directory);
    assert.equal(saves, 1);
    assert.equal(await install.call(plugin), false, "An already-current helper must not be overwritten");
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function mediaChecks() {
  const samplePath = path.join(__dirname, "logo.svg");
  const expected = fs.readFileSync(samplePath);
  const eagle = { item: { getById: async () => ({ filePath: samplePath }) } };
  const context = {
    document: { readyState: "loading", addEventListener() {} },
    require, console, URL, eagle, window: { eagle },
    expose: handler => { context.handle = handler; }
  };
  vm.runInNewContext(helper.replace(/\}\)\(\);\s*$/, "expose(handleMediaRequest); })();"), context);
  const server = http.createServer((req, res) => {
    context.handle(req, res).catch(error => { res.destroy(error); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = (method, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: "/images/test.info", method, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(1500, () => req.destroy(new Error(`${method} response did not finish`)));
    req.end();
  });
  try {
    const head = await request("HEAD");
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers["content-length"]), expected.length);
    assert.equal(head.body.length, 0, "HEAD must end without sending a body");
    assert.deepEqual((await request("GET")).body, expected, "Full image downloads must remain unchanged");
    const range = await request("GET", { Range: "bytes=0-7" });
    assert.equal(range.status, 206);
    assert.deepEqual(range.body, expected.subarray(0, 8));
    assert.equal((await request("GET", { Range: `bytes=${expected.length}-` })).status, 416);
    assert.equal((await request("OPTIONS")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

installationChecks().then(mediaChecks).then(() => console.log("Helper startup, bundled installation, cross-device directory fallback and HTTP media checks passed."))
  .catch(error => { console.error(error); process.exitCode = 1; });
