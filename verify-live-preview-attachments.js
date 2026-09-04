const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return { editorLivePreviewField: {}, Notice: class Notice {}, setIcon() {}, TFile: class TFile {} };
  if (request === "@codemirror/state") return { Prec: { highest: value => value } };
  if (request === "@codemirror/view") return { Decoration: {}, ViewPlugin: {}, WidgetType: class WidgetType {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { getAttachmentKind, normalizeLegacyNonImageEmbeds, parseRenderableAttachmentLinks } = require("./lib/live-preview-attachments");
Module._load = originalLoad;

const plugin = {
  isEagleBridgeAssetUrl: value => /localhost:6060\/images\/.+\.info/.test(value),
  isPreviewableAttachmentImage: value => /\.png$/i.test(value)
};
const refs = parseRenderableAttachmentLinks([
  "[合同.doc](http://localhost:6060/images/DOC1.info)",
  "![声音.mp3](http://localhost:6060/images/MP31.info)",
  "[库外.pdf](<file:///D:/资料/库外.pdf>)",
  "![图片.png](http://localhost:6060/images/IMG1.info)"
].join("\n"), plugin);

assert.deepEqual(refs.map(ref => [ref.name, ref.kind]), [["合同.doc", "file"], ["声音.mp3", "audio"], ["库外.pdf", "pdf"]]);
assert.equal(getAttachmentKind("演示.mp4"), "video");
assert.equal(getAttachmentKind("演示.webm"), "video");
assert.equal(getAttachmentKind("合同.doc|0"), "file");
const legacy = normalizeLegacyNonImageEmbeds("![合同.doc|0](http://localhost:6060/images/DOC1.info)\n![图片.png|200](http://localhost:6060/images/IMG1.info)", plugin);
assert.equal(legacy.count, 1);
assert.equal(legacy.text, "[合同.doc|0](http://localhost:6060/images/DOC1.info)\n![图片.png|200](http://localhost:6060/images/IMG1.info)");
const widgetSource = require("fs").readFileSync(require.resolve("./lib/live-preview-attachments"), "utf8");
assert.match(widgetSource, /ignoreEvent\(\) \{\s*return true;/);
assert.match(widgetSource, /Decoration\.replace\(\{ widget: new AttachmentWidget\(plugin, ref\), inclusive: true \}\)/);
assert.match(widgetSource, /return Prec\.highest\(ViewPlugin\.fromClass/);
console.log("live preview attachment checks passed");
