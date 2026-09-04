const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
class ObsidianStub {}
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    TFile: ObsidianStub,
    Plugin: ObsidianStub,
    ItemView: ObsidianStub,
    Menu: ObsidianStub,
    Notice: ObsidianStub,
    PluginSettingTab: ObsidianStub,
    Setting: ObsidianStub,
    Modal: ObsidianStub,
    addIcon() {},
    requestUrl() {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const {
  getAttachmentReferenceSignature,
  preserveAttachmentDisplaySize,
  makeMarkdownTableSafeReference
} = require("./lib/asset-utils");
const PluginClass = require("./main.source");
Module._load = originalLoad;

const image = "http://localhost:6060/images/ABC123.info";
assert.strictEqual(
  getAttachmentReferenceSignature(`![name|315](${image})`),
  getAttachmentReferenceSignature(`![name|393](${image})`)
);
assert.notStrictEqual(
  getAttachmentReferenceSignature(`![name|315](${image})`),
  getAttachmentReferenceSignature("![name|315](https://example.com/other.jpg)")
);
assert.strictEqual(
  getAttachmentReferenceSignature('{"nodes":[{"id":"n1","file":"image.png","width":100,"x":1}]}', "canvas"),
  getAttachmentReferenceSignature('{"nodes":[{"id":"n1","file":"image.png","width":500,"x":99}]}', "canvas")
);
assert.strictEqual(
  preserveAttachmentDisplaySize("![old|315](old.png)", `![new](${image})`),
  `![new|315](${image})`
);
assert.strictEqual(
  preserveAttachmentDisplaySize('<img src="old.png" width="420">', `![new](${image})`),
  `![new|420](${image})`
);
const tableSource = "| dog<br>![old.png|200](old.png) | text |";
assert.strictEqual(
  makeMarkdownTableSafeReference(tableSource, tableSource.indexOf("!["), `![dog.png|200](${image})`),
  `![dog.png\\|200](${image})`
);
const plugin = Object.create(PluginClass.prototype);
plugin.isEagleBridgeAssetUrl = () => true;
plugin.settings = { replacementTemplate: "![{filename}]({bridgeUrl})", tagManagementEnabled: true, autoTagOnRefresh: false };
assert.strictEqual(plugin.buildReplacement({ name: "dog.png" }, { bridgeUrl: image }), `![dog.png](${image})`);
assert.strictEqual(plugin.buildReplacement({ name: "contract.doc" }, { bridgeUrl: image }), `[contract.doc](${image})`);
assert.deepStrictEqual(plugin.getImportContextTags({ tags: ["Obsidian-dog-20260122"] }), ["Obsidian-dog-20260122"]);
plugin.settings.tagManagementEnabled = false;
assert.deepStrictEqual(plugin.getImportContextTags({ tags: ["Obsidian-dog-20260122"] }), []);
const damagedTable = `| 巴哥犬<br>![狗-1.png                                     | 200](${image}) | 简介 |`;
assert.strictEqual(
  plugin.normalizeLegacyEagleBridgeReferenceLabels(damagedTable).text,
  `| 巴哥犬<br>![狗-1.png\\|200](${image}) | 简介 |`
);
console.log("Reference semantic checks passed.");
