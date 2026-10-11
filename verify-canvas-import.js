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
function method(name, next, dependencies) {
  const start = source.indexOf(`  async ${name}(`);
  const end = source.indexOf(`\n  async ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return Function(...Object.keys(dependencies), `return ({${source.slice(start, end)}}).${name}`)(...Object.values(dependencies));
}
const importCanvas = method("importCanvasAttachments", "cleanupLocalCopiesForContext", {
  TFile, Notice: class Notice {}, nodeFs: fs, nodePath: require("node:path"),
  ...Object.fromEntries(["cleanExternalAttachmentUrl", "externalLocalPathFromTarget", "cleanAttachmentTarget",
    "isSupportedCanvasAttachment", "isExternalLink", "getInternetAttachmentDisplayName",
    "normalizeCanvasNodeSize", "isPreviewableImage"].map(name => [name, utils[name]]))
});
const assetUrl = "http://localhost:6060/images/TEST.info";
const wrapper = `http://localhost:6060/__eaglebridge__/canvas-image?src=${encodeURIComponent(assetUrl)}`;
const nodes = [
  { id: "a", type: "file", file: "image.png", x: 0, y: 10, width: 100, height: 80 },
  { id: "b", type: "link", url: wrapper, x: 20, y: 30, width: 100, height: 80 }
];
const signature = data => utils.getAttachmentReferenceSignature(JSON.stringify(data), "canvas");
assert.equal(signature({ nodes }), signature({ nodes: nodes.slice().reverse().map(n => ({ ...n, x: 999, height: 333 })) }));
assert.notEqual(signature({ nodes }), signature({ nodes: [nodes[1]] }));
assert.notEqual(signature({ nodes }), signature({ nodes: [{ ...nodes[0], file: "other.png" }, nodes[1]] }));

async function scenario(edit, { bridgeOnly = false, malformed = false, cancel = false } = {}) {
  const sourceFile = Object.assign(new TFile(), { path: "image.png", name: "image.png" });
  const context = { file: { path: "test.canvas" } };
  const initial = { nodes: bridgeOnly ? [nodes[1]] : structuredClone(nodes), edges: [] };
  let latest = JSON.stringify(initial);
  let imports = 0, writes = 0, refreshes = 0, trashed = [];
  const plugin = {
    settings: {},
    t: key => key,
    app: {
      vault: {
        read: async () => latest,
        process: async (_file, callback) => {
          const next = callback(latest);
          if (next !== latest) writes++;
          latest = next;
        },
        modify: async () => assert.fail("Import must not overwrite an old Canvas snapshot")
      },
      metadataCache: { getFirstLinkpathDest: target => target === "image.png" ? sourceFile : null }
    },
    isEagleBridgeAssetUrl: url => url === assetUrl,
    importOneAttachment: async () => {
      imports++;
      const data = JSON.parse(latest);
      edit(data);
      latest = malformed ? "invalid JSON" : JSON.stringify(data);
      return { sourceFile, item: { id: "TEST" } };
    },
    importOneInternetAttachment: async () => assert.fail("Existing Eagle wrapper must not be imported as a network image"),
    getEagleBridgeUrl: () => assetUrl,
    buildCanvasEagleBridgeUrl: () => wrapper,
    trashImportedFiles: async files => { trashed = files; },
    scheduleReferenceViewRefresh: () => refreshes++
  };
  if (malformed) {
    await assert.rejects(importCanvas.call(plugin, context, "", { silent: true }), SyntaxError);
    assert.equal(writes, 0);
    assert.equal(trashed.length, 0);
    return;
  }
  const result = await importCanvas.call(plugin, context, "", { silent: true, shouldContinue: () => !cancel || imports === 0 });
  return { result, data: JSON.parse(latest), imports, writes, refreshes, trashed };
}

(async () => {
  const stable = await scenario(() => {}, { bridgeOnly: true });
  assert.equal(stable.imports, 0);
  assert.equal(stable.writes, 0);
  const moved = await scenario(data => {
    Object.assign(data.nodes[0], { x: 700, y: 900, width: 400, height: 300, color: "4" });
    data.nodes.reverse();
    data.edges.push({ id: "edge", fromNode: "a", toNode: "b" });
  });
  assert.equal(moved.result.success, 1);
  assert.equal(moved.data.nodes[0].id, "b");
  const converted = moved.data.nodes[1];
  assert.equal(converted.url, wrapper);
  assert.equal(converted.file, undefined);
  assert.deepEqual([converted.x, converted.y, converted.width, converted.height, converted.color], [700, 900, 400, 300, "4"]);
  assert.equal(moved.data.edges.length, 1);
  assert.equal(moved.trashed.length, 1);
  const removed = await scenario(data => { data.nodes.shift(); });
  assert.equal(removed.writes, 0);
  assert.equal(removed.result.changed, false);
  assert.equal(removed.result.failed, 1);
  assert.equal(removed.trashed.length, 0);
  const retargeted = await scenario(data => { data.nodes[0].file = "replacement.png"; });
  assert.equal(retargeted.writes, 0);
  assert.equal(retargeted.result.failed, 1);
  assert.equal(retargeted.data.nodes[0].file, "replacement.png");
  assert.equal(retargeted.trashed.length, 0);
  const duplicate = await scenario(data => { data.nodes.push({ ...data.nodes[0], id: "new" }); });
  assert.equal(duplicate.result.success, 1);
  assert.equal(duplicate.data.nodes.at(-1).file, "image.png");
  assert.equal(duplicate.trashed.length, 0, "A newly added local reference must retain its attachment");
  const cancelled = await scenario(data => { data.nodes[0].x = 321; }, { cancel: true });
  assert.equal(cancelled.result.success, 1, "Refresh cancellation must retain an already verified Canvas import");
  assert.equal(cancelled.data.nodes[0].x, 321);
  assert.equal(cancelled.trashed.length, 0);
  await scenario(() => {}, { malformed: true });
  console.log("Canvas import concurrency and reference ordering checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
