const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { isInsideEagleLibrary } = require("./lib/asset-utils");

const source = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8")
  + fs.readFileSync(path.join(__dirname, "lib", "eagle-assets-view.js"), "utf8");

assert.match(source, /libraryReferenceSummaryGeneration/);
assert.match(source, /libraryReferenceSummaryTask/);
assert.match(source, /cachedRead/);
assert.match(source, /mapWithConcurrency\(filePaths, 6,/);
assert.match(source, /if \(known\.length \|\| this\.libraryReferenceSummary\) return known;/);
assert.match(source, /options\.sourceText !== undefined/);
assert.doesNotMatch(source, /enterContextMode\([\s\S]{0,160}?this\.libraryReferenceSummary = null/);
assert.equal(isInsideEagleLibrary("Eagle素材库.library/images/ABC.info/image.png"), true);
assert.equal(isInsideEagleLibrary("素材/Eagle.Library/metadata.json"), true);
assert.equal(isInsideEagleLibrary("附件/library-cover.png"), false);
assert.match(source, /getAllObsidianAssetSourceFiles[\s\S]{0,240}!isInsideEagleLibrary\(file\.path\)/);
assert.match(source, /collectObsidianLibrarySourceAssets[\s\S]{0,180}!isInsideEagleLibrary\(file\.path\)/);

console.log("Vault scan/file read checks passed.");
