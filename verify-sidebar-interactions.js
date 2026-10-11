const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;
class Stub {}
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    Plugin: Stub, ItemView: Stub, TFile: Stub, Menu: Stub, Notice: Stub,
    PluginSettingTab: Stub, Modal: Stub, Setting: Stub, addIcon() {}, requestUrl() {}
  };
  if (request === "@codemirror/state") return { Prec: { highest: value => value } };
  if (request === "@codemirror/view") return { WidgetType: Stub, Decoration: {}, ViewPlugin: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("./main.source");
const { createEagleAssetsView } = require("./lib/eagle-assets-view");
Module._load = originalLoad;
const plugin = Object.create(Plugin.prototype);
plugin.getFullPath = file => `C:/vault/${file.path}`;
const image = src => ({ src, names: ["same.png"] });
assert.equal(plugin.getAssetIdentityScore({ id: "ABC" }, image("http://localhost:6060/images/ABC.info")), 120);
assert.equal(plugin.getAssetIdentityScore({ id: "ABC" }, image("http://localhost:6060/images/ABCD.info")), 0);
const local = { __assetSource: "local", __localFile: { path: "folder/same.png" }, name: "same.png" };
assert.equal(plugin.getAssetIdentityScore(local, image("app://local/C:/vault/folder/same.png?123")), 110);
assert.equal(plugin.getAssetIdentityScore(local, image("app://local/C:/vault/other/same.png")), 0);
assert.equal(plugin.getAssetIdentityScore({ __assetSource: "internet", url: "https://example.com/A.png" }, image("https://example.com/a.png")), 0);
assert.equal(plugin.getAssetIdentityScore({ __assetSource: "external-local", __externalLocalPath: "C:/a b.png" }, image("file:///C:/a%20b.png")), 110);
assert.equal(plugin.getAssetIdentityScore({ __assetSource: "external-local", __externalLocalPath: "C:/a#b.png" }, image("file:///C:/a%23b.png")), 110);

const repeated = [{ start: 10, end: 20 }, { start: 110, end: 120 }];
const file = { path: "test.md" };
const cm = { dom: { contains: () => true }, posAtDOM: () => 112, state: { doc: { lineAt: () => ({ from: 100, to: 130 }) } } };
plugin.app = { workspace: { getLeavesOfType: () => [{ view: { file, containerEl: { contains: () => true }, editor: { cm } } }] } };
assert.equal(plugin.chooseRenderedImageReference(file, {}, repeated), repeated[1]);
cm.dom.contains = () => false;
assert.equal(plugin.chooseRenderedImageReference(file, {}, repeated), null);

const View = createEagleAssetsView({ VIEW_TYPE: "test", DEFAULT_SETTINGS: {} });
const view = Object.create(View.prototype);
Object.assign(view, { currentFilePath: "test.md", isLibraryMode: false, assetSelectionContextKey: "test.md", selectedAssetItems: new Map([["k", { old: true }]]), assetSelectionAnchorKey: "k", getAssetSelectionKey: item => item.key, updateAssetSelectionUi() {} });
const replacement = { key: "k", fresh: true };
view.reconcileAssetSelection([replacement]);
assert.equal(view.selectedAssetItems.get("k"), replacement);
view.currentFilePath = "other.md";
view.reconcileAssetSelection([replacement]);
assert.equal(view.selectedAssetItems.size, 0);

(async () => {
  let revealed;
  plugin.app.vault = { read: async () => "source" };
  plugin.extractEagleBridgeItemReferences = () => [{ id: "ABC", start: 10, end: 20 }, { id: "ABC", start: 110, end: 120 }];
  plugin.queryNoteAttachmentItemsForFile = async () => [];
  assert.equal((await plugin.getSourceAttachmentReferences(file)).length, 2,
    "Direct Eagle references and repeated occurrences must not disappear from navigation");
  plugin.getSourceAttachmentReferences = async () => [
    { id: "ABC", __sourceStart: 10, __sourceEnd: 20 },
    { id: "ABC", __sourceStart: 110, __sourceEnd: 120 }
  ];
  plugin.getEagleBridgeUrl = () => "http://localhost:6060/images/ABC.info";
  plugin.revealAssetInSource = async (path, item) => { revealed = { path, item }; };
  await plugin.revealReferencedAsset(file, { id: "ABC", __sourceStart: 110, __sourceEnd: 120 }, { view: { file } });
  assert.equal(revealed.item.__sourceStart, 110);
  await plugin.revealReferencedAsset({ path: "other.md" }, { id: "ABC" });
  assert.equal(revealed.path, "other.md");
  assert.equal(revealed.item.__sourceStart, 10);
  let refreshes = 0, cancellations = 0;
  plugin.referenceViewOperationDepth = 0;
  plugin.referenceViewRefreshScheduler = { cancel: () => cancellations++ };
  plugin.refreshReferenceViewsForCurrentNote = async () => refreshes++;
  await plugin.runWithReferenceViewRefreshPaused(() => plugin.runWithReferenceViewRefreshPaused(async () => 1));
  assert.equal(refreshes, 1, "Nested imports must have one refresh owner");
  assert.ok(cancellations >= 2);
  assert.equal(plugin.referenceViewOperationDepth, 0);
  console.log("Shared identity, reference navigation, selection and refresh checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
