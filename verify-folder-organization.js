const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const originalLoad = Module._load;
class TFile {}
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return { TFile };
  return originalLoad.call(this, request, parent, isMain);
};
const utils = require("./lib/asset-utils");
Module._load = originalLoad;
const source = fs.readFileSync(require.resolve("./main.source.js"), "utf8");
const dependencies = { ...utils, ...require("./lib/oe-link-references"), TFile, console: { warn() {} }, DEFAULT_SETTINGS: { eagleFolderNameTemplate: "{{title}}-{{created}}" } };
const pluginMethods = ["organizeCurrentContextEagleItemsIntoFolder", "updateEagleItemFolder",
  "resolveEagleFolderIdForContext", "resolveEagleFolderIdForVaultPath", "getManagedEagleFolderPathForContext",
  "buildManagedEagleFolderPath", "renderEagleFolderName", "extractEagleBridgeItemIds", "extractEagleBridgeItemReferences"];
function methods() {
  const result = {};
  for (const name of pluginMethods) {
    const prefix = source.includes(`  async ${name}(`) ? `  async ${name}(` : `  ${name}(`;
    const start = source.indexOf(prefix);
    const end = source.indexOf("\n  }", start) + 4;
    assert.ok(start >= 0 && end > start);
    result[name] = Function(...Object.keys(dependencies), `return ({${source.slice(start, end)}}).${name}`)(...Object.values(dependencies));
  }
  return result;
}
const assetUrl = "http://localhost:6060/images/TEST.info";
const wrapper = `http://localhost:6060/__eaglebridge__/canvas-image?src=${encodeURIComponent(assetUrl)}`;

async function scenario(kind, { reject = false, legacy = false, existing = false } = {}) {
  const plugin = methods();
  const file = Object.assign(new TFile(), { path: `Folder/Test.${kind === "canvas" ? "canvas" : "md"}` });
  const text = kind === "canvas" ? JSON.stringify({ nodes: [{ id: "n", url: wrapper }] }) : `![image](${assetUrl})`;
  let item = { id: "TEST", folders: existing ? ["ROOT", "CHILD", "OTHER"] : ["ROOT", "OTHER"] };
  const root = { id: "ROOT", children: existing ? [{ id: "CHILD", name: "Test-20261010" }] : [] };
  let created = 0, writes = 0;
  Object.assign(plugin, {
    settings: { eagleFolderId: "ROOT", autoFolderOnImport: false, eagleApiBaseUrl: "http://localhost:41595", eagleFolderNameTemplate: "{{title}}-{{created}}" },
    app: { vault: { read: async () => text } },
    isEagleBridgeAssetUrl: url => url === assetUrl,
    queryEagleFolders: async () => [root],
    createEagleFolder: async (_name, parent) => { assert.equal(parent, "ROOT"); created++; return { id: "CHILD", name: "Test-20261010" }; },
    rememberManagedEagleFolder: async () => {},
    rememberManagedEagleFolderForSource: async () => {},
    getCurrentContextEagleItems: async () => [structuredClone(item)],
    queryEagleItemInfo: async () => structuredClone(item),
    invalidateEagleItemInfo() {},
    requestEagleApiJson: async request => {
      if (legacy) throw new Error("V2 unavailable");
      assert.match(request.url, /\/api\/v2\/item\/update$/);
      const payload = JSON.parse(request.body);
      assert.deepEqual(payload.folders.slice().sort(), ["CHILD", "OTHER", "ROOT"]);
      if (!reject) item.folders = payload.folders;
      writes++;
    },
    addEagleItemToFolderViaHelper: async () => {
      if (reject) return false;
      item.folders = Array.from(new Set([...item.folders, "CHILD"]));
      return true;
    },
    removeEagleItemFoldersViaHelper: async (_id, ids) => { item.folders = item.folders.filter(id => !ids.includes(id)); }
  });
  const context = { file, kind, identity: "Test-20261010" };
  const result = await plugin.organizeCurrentContextEagleItemsIntoFolder(context, null, { createMissing: true, report: true });
  assert.deepEqual(result, { added: reject || existing ? 0 : 1, already: existing ? 1 : 0, failed: reject ? 1 : 0, total: 1 });
  assert.equal(created, existing ? 0 : 1, "Manual organization must create folders with AUTO off");
  if (reject) assert.deepEqual(item.folders, ["ROOT", "OTHER"]);
  else {
    assert.deepEqual(item.folders.slice().sort(), ["CHILD", "OTHER", "ROOT"]);
    assert.equal(await plugin.organizeCurrentContextEagleItemsIntoFolder(context), 0);
    assert.equal(writes, legacy || existing ? 0 : 1);
  }
}

async function runLive() {
  const path = require("node:path");
  const vaultRoot = "C:/Users/TAI/OneDrive/应用/remotely-save/王腾的第一库";
  const settings = JSON.parse(fs.readFileSync(path.join(vaultRoot, ".obsidian/plugins/oe-link/data.json"), "utf8"));
  const file = Object.assign(new TFile(), { path: "情绪/MBTI.canvas" });
  const text = fs.readFileSync(path.join(vaultRoot, file.path), "utf8");
  const plugin = methods();
  const base = settings.eagleApiBaseUrl.replace(/\/+$/, "");
  const request = async options => {
    const response = await fetch(options.url, { method: options.method || "GET", headers: options.headers, body: options.body });
    const body = await response.json();
    if (!response.ok || body.status !== "success") throw new Error(body.message || `HTTP ${response.status}`);
    return body;
  };
  Object.assign(plugin, {
    settings,
    app: { vault: { read: async () => text } },
    isEagleBridgeAssetUrl: url => /\/images\/[^/?#]+\.info$/.test(url),
    queryEagleFolders: async () => (await request({ url: `${base}/api/folder/list` })).data,
    createEagleFolder: async (name, parent) => (await request({ url: `${base}/api/folder/create`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderName: name, parent }) })).data,
    rememberManagedEagleFolder: async () => {},
    rememberManagedEagleFolderForSource: async () => {},
    queryEagleItemInfo: async id => (await request({ url: `${base}/api/item/info?id=${encodeURIComponent(id)}` })).data,
    getCurrentContextEagleItems: async () => Promise.all(plugin.extractEagleBridgeItemIds(text).map(id => plugin.queryEagleItemInfo(id))),
    requestEagleApiJson: request,
    invalidateEagleItemInfo() {},
    addEagleItemToFolderViaHelper: async () => false
  });
  const before = await plugin.getCurrentContextEagleItems();
  assert.equal(before.length, 16);
  const backupDir = path.resolve(__dirname, "../修改前备份/2026-10-10-folder");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "MBTI-folder-assignments.json");
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, JSON.stringify(before.map(item => ({ id: item.id, folders: item.folders })), null, 2));
  const context = { file, kind: "canvas", identity: "MBTI-20261008" };
  const target = await plugin.resolveEagleFolderIdForContext(context, { createMissing: true });
  assert.notEqual(target, settings.eagleFolderId);
  const changed = await plugin.organizeCurrentContextEagleItemsIntoFolder(context, null, { createMissing: true });
  for (const original of before) {
    const item = await plugin.queryEagleItemInfo(original.id);
    assert.ok(utils.itemHasEagleFolder(item, target));
    for (const id of utils.getEagleItemFolderIds(original)) assert.ok(utils.itemHasEagleFolder(item, id));
  }
  assert.equal(fs.readFileSync(path.join(vaultRoot, file.path), "utf8"), text);
  console.log(`Live Eagle verification passed: ${changed} items organized, all 16 folder assignments verified; Canvas unchanged.`);
}

(async () => {
  for (const kind of ["canvas", "markdown"]) {
    await scenario(kind);
    await scenario(kind, { legacy: true });
    await scenario(kind, { reject: true });
    await scenario(kind, { existing: true });
  }
  console.log("Manual Canvas/note folder creation, existing assignment preservation, counts and fallback checks passed.");
  if (process.argv.includes("--live")) await runLive();
})().catch(error => { console.error(error); process.exitCode = 1; });
