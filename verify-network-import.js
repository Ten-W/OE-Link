const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const originalLoad = Module._load;
class TFile {}
Module._load = function(request, parent, isMain) {
  return request === "obsidian" ? { TFile } : originalLoad.call(this, request, parent, isMain);
};
const utils = require("./lib/asset-utils");
Module._load = originalLoad;
const source = fs.readFileSync(require.resolve("./main.source.js"), "utf8");
const deps = { ...utils, TFile, nodeFs: fs, nodePath: path, nodeCrypto: crypto,
  sleep: async () => {}, Notice: class {}, console: { warn() {} },
  requestUrl: async ({ url }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { arrayBuffer: await response.arrayBuffer() };
  }
};
function method(name) {
  const marker = source.includes(`  async ${name}(`) ? `  async ${name}(` : `  ${name}(`;
  const start = source.indexOf(marker), end = source.indexOf("\n  }", start) + 4;
  assert.ok(start >= 0 && end > start, name);
  return Function(...Object.keys(deps), `return ({${source.slice(start, end)}}).${name}`)(...Object.values(deps));
}

async function verify() {
  const matched = { id: "MATCH", size: 10 };
  const plugin = {
    settings: { eagleApiBaseUrl: "http://localhost:41595", autoTagOnRefresh: false },
    requestEagleHelperJson: async () => { throw new Error("helper offline"); },
    requestEagleApiJson: async ({ url }) => url.includes("offset=0")
      ? { data: Array.from({ length: 200 }, (_, i) => ({ id: `OTHER${i}`, size: 9 })) }
      : { data: [{ id: "WRONG", size: 10 }, matched] },
    getOriginalPathForEagleItem: async item => item.id,
    getLocalFileContentHash: async file => file === "MATCH" ? "hash" : "different",
    findEagleItemsByContentSignature: method("findEagleItemsByContentSignature"),
    getImportContextTags: method("getImportContextTags"),
    getInternetAttachmentExtension: () => "",
    getInternetContentSignature: async () => ({ hash: "hash", size: 10 }),
    addUrlToEagle: async () => assert.fail("An existing exact-content item must not be imported again"),
    ensureImportedEagleItemTags: async (_context, item) => item,
    getAuthoritativeEagleItem: async item => item,
    ensureContextEagleFolder: async (_context, item) => item,
    getEagleBridgeUrl: item => `http://localhost:6060/images/${item.id}.info`,
    getEagleItemEmbedUrl: async () => "",
    getCanonicalEagleFileName: () => "photo.jpg",
    buildReplacement: (_file, values) => `![photo.jpg](${values.bridgeUrl})`
  };
  assert.deepEqual(await plugin.findEagleItemsByContentSignature({ hash: "hash", size: 10 }), [matched]);
  const context = { file: { path: "note.md" }, tags: ["Obsidian-note"] };
  assert.deepEqual(plugin.getImportContextTags(context), []);
  const imported = await method("importOneInternetAttachment").call(plugin, context,
    { name: "photo", url: "https://example.test/opaque-image?purpose=inline" });
  assert.match(imported.replacement, /MATCH\.info/);
  assert.equal(imported.sourceFile.name, "photo.jpg", "Canvas must use the actual image extension, not the extensionless URL label");
  plugin.getInternetContentSignature = async () => { throw new Error("download failed"); };
  await assert.rejects(method("importOneInternetAttachment").call(plugin, context, { url: "https://example.test/missing" }), /download failed/);
  plugin.getOriginalPathForEagleItem = async () => "";
  await assert.rejects(plugin.findEagleItemsByContentSignature({ hash: "hash", size: 10 }), /已停止导入/);
  let attempts = 0;
  const delayed = await method("resolveInternetItemAfterAdd").call({
    getItemFromAddResult: async () => null,
    findEagleItemsByContentSignature: async () => ++attempts === 12 ? [matched] : []
  }, { status: "success" }, { hash: "hash", size: 10 });
  assert.equal(delayed.id, "MATCH", "Slow Eagle indexing must still resolve verified bytes");

  let added = 0, folderChecks = 0;
  const newImport = { ...plugin,
    getInternetContentSignature: async () => ({ hash: "new-hash", size: 20 }),
    findEagleItemsByContentSignature: async () => [],
    withContextEagleFolder: async data => ({ ...data, folderId: "NOTE-FOLDER" }),
    addUrlToEagle: async data => {
      added++;
      assert.deepEqual(data.tags, []);
      assert.equal(data.folderId, "NOTE-FOLDER");
      return { data: { id: "NEW" } };
    },
    resolveInternetItemAfterAdd: async result => result.data,
    ensureImportedEagleItemTags: method("ensureImportedEagleItemTags"),
    ensureContextEagleFolder: async (_context, item) => { folderChecks++; return item; }
  };
  const newResult = await method("importOneInternetAttachment").call(newImport, context, { url: "https://example.test/new" });
  assert.equal(added, 1);
  assert.equal(folderChecks, 1);
  assert.match(newResult.replacement, /NEW\.info/);
  newImport.findEagleItemsByContentSignature = async () => { throw new Error("verification unavailable"); };
  await assert.rejects(method("importOneInternetAttachment").call(newImport, context, { url: "https://example.test/blocked" }), /verification unavailable/);
  assert.equal(added, 1, "Failed verification must stop before adding another image");

  if (process.argv.includes("--live")) {
    const notePath = process.env.OE_TEST_NOTE;
    assert.ok(notePath, "OE_TEST_NOTE is required for read-only live verification");
    const text = fs.readFileSync(notePath, "utf8");
    const urls = Array.from(text.matchAll(/!\[[^\]]*\]\((https:\/\/images\.openai\.com\/[^\s)]+)\)/g), match => match[1]);
    const referencedIds = Array.from(new Set(Array.from(text.matchAll(/\/images\/([A-Za-z0-9]+)\.info/g), match => match[1])));
    assert.equal(urls.length + referencedIds.length, 14);
    plugin.requestEagleApiJson = async ({ url }) => {
      const response = await fetch(url);
      assert.ok(response.ok);
      const body = await response.json();
      assert.equal(body.status, "success");
      return body;
    };
    plugin.getEagleItemThumbnailUrl = async item => {
      const body = await plugin.requestEagleApiJson({ url: `${plugin.settings.eagleApiBaseUrl}/api/item/thumbnail?id=${item.id}` });
      return body.data;
    };
    plugin.getOriginalPathForEagleItem = method("getOriginalPathForEagleItem");
    plugin.getLocalFileContentHash = method("getLocalFileContentHash");
    plugin.getInternetContentSignature = method("getInternetContentSignature");
    plugin.ensureImportedEagleItemTags = method("ensureImportedEagleItemTags");
    const ids = new Set();
    for (const url of urls) {
      const result = await method("importOneInternetAttachment").call(plugin, context, { url, name: "photo" });
      assert.ok(result.item.annotation?.includes("训练计划261011.md"));
      assert.match(result.replacement, /\.info\)/);
      ids.add(result.item.id);
    }
    for (const id of referencedIds) {
      const item = (await plugin.requestEagleApiJson({ url: `${plugin.settings.eagleApiBaseUrl}/api/item/info?id=${id}` })).data;
      assert.ok(item.annotation?.includes("训练计划261011.md"));
      const original = await plugin.getOriginalPathForEagleItem(item);
      assert.ok(original);
      const signature = { hash: await plugin.getLocalFileContentHash(original), size: fs.statSync(original).size };
      const matches = await plugin.findEagleItemsByContentSignature(signature);
      assert.ok(matches.some(candidate => candidate.id === id));
      ids.add(id);
    }
    assert.equal(ids.size, 14, "Each original network image must resolve to its own existing Eagle item");
    assert.equal(fs.readFileSync(notePath, "utf8"), text);
    console.log("Read-only live import resolution verified: all 14 existing images, no uploads, tags or note writes.");
  }
  console.log("Network import checks passed.");
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
