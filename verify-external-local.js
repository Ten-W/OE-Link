const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return { TFile: class TFile {} };
  return originalLoad.call(this, request, parent, isMain);
};

const { externalLocalPathFromTarget } = require("./lib/asset-utils");
Module._load = originalLoad;

assert.match(externalLocalPathFromTarget("file:///C:/Assets/example%20image.png"), /^C:[\\/]Assets[\\/]example image\.png$/i);
assert.match(externalLocalPathFromTarget("C:\\Assets\\example.png"), /^C:[\\/]Assets[\\/]example\.png$/i);
assert.equal(externalLocalPathFromTarget("Attachments/example.png"), "");
assert.equal(externalLocalPathFromTarget("https://example.com/example.png"), "");

const source = fs.readFileSync("main.source.js", "utf8") + fs.readFileSync("lib/eagle-assets-view.js", "utf8");
assert.match(source, /importExternalLocalAttachments: false/);
assert.match(source, /findExternalLocalAttachmentLinks\(text\)/);
assert.match(source, /this\.settings\.importExternalLocalAttachments === true/);
assert.match(source, /if \(imported\.sourceFile instanceof TFile\) importedFiles\.push\(imported\)/);
assert.match(source, /nativeImage\.createThumbnailFromPath\(item\.__externalLocalPath/);

console.log("external local attachment checks passed");
