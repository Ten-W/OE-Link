const assert = require("node:assert/strict");
const fs = require("node:fs");
const source = fs.readFileSync(`${__dirname}/lib/eagle-assets-view.js`, "utf8");
const start = source.indexOf("  tryOpenNativeImagePreview(");
const end = source.indexOf("\n  async getAssetReferenceLink", start);
const calls = [], notices = [];
const handler = function(event, image) {
  assert.equal(event, null);
  assert.deepEqual(this.sections[0].el.findAll("img"), [image]);
  calls.push(image);
};
const api = { prototype: { handleMediaClick: handler } };
const methods = Function("MarkdownPreviewRenderer", "getAssetDisplayName", "stripInfoSuffix", "getEagleItemId", "normalizeFileUrl", "Notice",
  `return (class {${source.slice(start, end)}}).prototype`)(api, item => item.name, id => id, item => item.id,
  path => `file:///${path}`, class { constructor(text) { notices.push(text); } });
const doc = { createElement: () => ({ ownerDocument: doc }) };
const originalImage = { src: "http://localhost/images/test.info" };
const card = { ownerDocument: doc, querySelector: () => originalImage };
let reveals = 0;
const view = Object.assign(Object.create(methods), {
  containerEl: { ownerDocument: doc }, currentFilePath: "test.canvas",
  isPreviewableAssetItem: () => true,
  plugin: {
    sourceRevealGeneration: 0,
    app: { workspace: { getLeavesOfType: () => [] } },
    getEagleBridgeUrl: () => originalImage.src,
    revealAssetInSource: async () => { reveals++; return {}; }
  }
});

(async () => {
  await view.openAssetPreview({ id: "test", name: "test.png" }, card);
  assert.equal(calls.pop(), originalImage);
  assert.equal(reveals, 0, "Canvas images must not depend on a Markdown zoom button");
  view.currentFilePath = "test.md";
  await view.openAssetPreview({ id: "test", __sourceStart: 10 }, card);
  assert.equal(reveals, 1, "Keep the established note reveal behavior");
  assert.equal(calls.pop(), originalImage);
  view.isLibraryMode = true;
  view.plugin.getEagleBridgeUrl = () => "";
  for (const item of [
    { __assetSource: "local", resourceURL: "app://original.png" },
    { __assetSource: "external-local", __externalLocalPath: "C:/original.gif", resourceURL: "data:thumbnail" },
    { __assetSource: "internet", url: "https://example.com/original.png" }
  ]) {
    await view.openAssetPreview(item, card);
    const image = calls.pop();
    assert.equal(image.src, item.__externalLocalPath ? "file:///C:/original.gif" : item.resourceURL || item.url);
    assert.notEqual(image, originalImage, "Never enlarge a different asset's thumbnail");
    if (item.__assetSource === "internet") assert.equal(image.referrerPolicy, "no-referrer");
  }
  api.prototype.handleMediaClick = undefined;
  assert.equal(view.tryOpenNativeImagePreview("app://test", {}, card), false);
  view.plugin.app.workspace.getLeavesOfType = () => [{ view: { previewMode: { renderer: { handleMediaClick: handler } } } }];
  assert.equal(view.tryOpenNativeImagePreview(originalImage.src, {}, card), true);
  calls.length = 0;
  view.isLibraryMode = false;
  view.plugin.revealAssetInSource = async () => { await Promise.resolve(); view.plugin.sourceRevealGeneration++; return {}; };
  await view.openAssetPreview({ __sourceStart: 0 }, card);
  assert.equal(calls.length, 0, "Canceled note navigation must not open a stale preview");
  assert.equal(notices.length, 0);
  console.log("Native image preview checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
