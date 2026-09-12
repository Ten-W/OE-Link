const assert = require("assert");
const fs = require("fs");
const { normalizeEagleFolderId } = require("./lib/asset-utils");

const source = fs.readFileSync("main.source.js", "utf8") + fs.readFileSync("lib/eagle-assets-view.js", "utf8");
assert.match(source, /contextSourceFilters = new Set\(\["eagle", "local", "external-local", "internet"\]\)/);
assert.match(source, /\["eagle", "Eagle 库内", "is-eagle", summary\.inEagle \+ summary\.trash\]/);
assert.match(source, /Eagle 库内: \$\{summary\.inEagle\}/);
assert.match(source, /\["external-local", "Obsidian 库外", "is-external-local", summary\.externalLocal\]/);
assert.match(source, /eaglebridge-context-trash-count[^\n]+`\+\$\{summary\.trash\}`/);
assert.doesNotMatch(source, /const openEagleButton =/);
assert.match(source, /this\.renderAssetGrid\(content, visibleItems\)/);
assert.match(source, /nodeFs\.readdirSync\(root, \{ withFileTypes: true \}\)/);
assert.strictEqual(normalizeEagleFolderId("MKIFXUOKGLEZW"), "MKIFXUOKGLEZW");
assert.strictEqual(normalizeEagleFolderId("http://localhost:41595/folder?id=MKIFXUOKGLEZW"), "MKIFXUOKGLEZW");
assert.strictEqual(normalizeEagleFolderId("eagle://folder/MKIFXUOKGLEZW"), "MKIFXUOKGLEZW");
console.log("context filters and library detection verified");
