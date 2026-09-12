const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const originalLoad = Module._load;
class ObsidianStub {}
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    TFile: ObsidianStub, Plugin: ObsidianStub, ItemView: ObsidianStub, Menu: ObsidianStub,
    Notice: ObsidianStub, PluginSettingTab: ObsidianStub, Setting: ObsidianStub, Modal: ObsidianStub,
    addIcon() {}, requestUrl() {}
  };
  if (request === "@codemirror/state") return { Prec: { highest(value) { return value; } } };
  if (request === "@codemirror/view") return {
    WidgetType: class {},
    Decoration: { none: [], replace() { return { range() {} }; }, set() { return []; } },
    ViewPlugin: { fromClass(value) { return value; } }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const PluginClass = require("./main.source");
Module._load = originalLoad;

const pluginSource = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8");
assert.match(pluginSource, /workspace\.on\("file-menu"/);
assert.match(pluginSource, /setTitle\(this\.t\("menuExportSharePackage"\)\)/);
assert.match(pluginSource, /exportCurrentNoteSharePackage\(file, "zip"\)/);
assert.match(pluginSource, /exportCurrentNoteSharePackage\(file, "folder"\)/);
assert.doesNotMatch(pluginSource, /confirmAndImportAllUnimportedAttachments|confirmAndCleanupAllImportedLocalCopies/);
assert.doesNotMatch(pluginSource, /fixCurrentNoteEagleThumbnailLinks|convertCurrentNoteEagleBridgeLinksToStandardEmbeds/);

(async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oe-link-plan-check-"));
  try {
    const eagleImage = path.join(root, "eagle", "same.jpg");
    const eagleAudio = path.join(root, "eagle", "audio.mp3");
    const vaultImage = path.join(root, "vault", "same.jpg");
    for (const filePath of [eagleImage, eagleAudio, vaultImage]) {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, Buffer.from(`binary:${filePath}`));
    }
    const noteFile = Object.assign(new ObsidianStub(), { path: "tests/share.md", name: "share.md", basename: "share", extension: "md" });
    const localFile = Object.assign(new ObsidianStub(), { path: "tests/same.jpg", name: "same.jpg", extension: "jpg" });
    const source = [
      "![image](http://localhost:6060/images/IMAGE1.info)",
      "![image again](http://localhost:6060/images/IMAGE1.info)",
      "[audio](http://localhost:6060/images/AUDIO1.info)",
      "![[same.jpg|320]]",
      "![web](https://example.com/image.png)",
      "![[missing.png]]"
    ].join("\n");
    const plugin = Object.create(PluginClass.prototype);
    plugin.app = {
      metadataCache: { getFirstLinkpathDest(target) { return target === "same.jpg" ? localFile : null; } },
      vault: { adapter: { getFullPath(filePath) { return filePath === localFile.path ? vaultImage : ""; } } }
    };
    plugin.t = key => key;
    plugin.queryEagleItemInfo = async id => ({ id });
    plugin.getOriginalPathForEagleItem = async item => item.id === "IMAGE1" ? eagleImage : eagleAudio;

    const plan = await plugin.buildCurrentNoteExportPlan(noteFile, source);
    assert.equal(plan.referenceCount, 5);
    assert.equal(plan.entries.length, 3);
    assert.equal(plan.missing.length, 1);
    assert.equal(plan.renames.length, 1);
    assert.equal((plan.noteText.match(/attachments\/same\.jpg/g) || []).length, 2);
    assert.match(plan.noteText, /attachments\/same-2\.jpg/);
    assert.match(plan.noteText, /attachments\/audio\.mp3/);
    assert.match(plan.noteText, /https:\/\/example\.com\/image\.png/);
    assert.match(plan.noteText, /!\[\[missing\.png\]\]/);
    console.log("export plan checks passed");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
