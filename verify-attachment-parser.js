const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return { TFile: class TFile {} };
  return originalLoad.call(this, request, parent, isMain);
};

const { cleanExternalAttachmentUrl, parseAttachmentReference, findMarkdownAttachmentReferences, preserveAttachmentDisplaySize } = require("./lib/asset-utils");
Module._load = originalLoad;

const remote = parseAttachmentReference({ label: "271", target: "https://example.test/files/图 片.jfif?size=271" });
assert.equal(remote.displayName, "图 片.jfif");
assert.equal(remote.extension, ".jfif");
assert.equal(remote.isExternal, true);

const legacy = parseAttachmentReference({ label: "file-2026..jpg|undefined|393", target: "http://localhost:6060/images/ABC.info" });
assert.equal(legacy.displayName, "file-2026.jpg");
assert.equal(legacy.extension, ".jpg");

const refs = findMarkdownAttachmentReferences("![271](https://example.test/a.jfif) [PDF](<附件/示例.pdf>)");
assert.equal(refs.length, 2);
assert.equal(refs[0].displayName, "a.jfif");
assert.equal(refs[1].displayName, "示例.pdf");
assert.equal(refs[0].isEmbed, true);
assert.equal(refs[1].isEmbed, false);

const extensionlessUrl = "https://images.openai.com/static-rsc-4/Zyu4vhFztiFcoeyE9JskryWrWxoBVQSLC0FXY?purpose=fullsize";
const extensionless = parseAttachmentReference({ label: "Image", target: extensionlessUrl });
assert.equal(extensionless.target, extensionlessUrl);
assert.equal(extensionless.isExternal, true);

const extensionlessRefs = findMarkdownAttachmentReferences(`![Image|315](${extensionlessUrl})`);
assert.equal(extensionlessRefs.length, 1);
assert.equal(extensionlessRefs[0].isEmbed, true);
assert.equal(extensionlessRefs[0].target, extensionlessUrl);

const eagleUrl = "http://localhost:6060/images/MRKSZH7VS66YM.info";
const canvasProxyUrl = `http://localhost:6060/__eaglebridge__/canvas-image?src=${encodeURIComponent(eagleUrl)}`;
assert.equal(cleanExternalAttachmentUrl(canvasProxyUrl), eagleUrl);
assert.equal(cleanExternalAttachmentUrl(`http://localhost:6060/__eaglebridge__/canvas-image?src=${eagleUrl}`), eagleUrl);
assert.equal(
  preserveAttachmentDisplaySize(`![file.jpg|undefined|200](${eagleUrl})`, `![file.jpg](${eagleUrl})`),
  `![file.jpg|200](${eagleUrl})`
);

const source = fs.readFileSync("main.source.js", "utf8") + fs.readFileSync("lib/eagle-assets-view.js", "utf8");
assert.match(source, /__isImage: internetLinks\.some/);
assert.match(source, /if \(item && item\.__isImage\) return true;/);
assert.match(source, /autoImportAttachments: false/);

console.log("Attachment parser checks passed.");
