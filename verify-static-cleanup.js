const assert = require("assert");
const fs = require("fs");
const path = require("path");
const translations = require("./lib/translations");

const sourceFiles = [
  "main.source.js",
  "mobile.js",
  ...fs.readdirSync(path.join(__dirname, "lib")).filter(name => name.endsWith(".js") && name !== "translations.js").map(name => `lib/${name}`)
];
const source = sourceFiles.map(name => fs.readFileSync(path.join(__dirname, name), "utf8")).join("\n");
for (const language of ["en", "zh"]) {
  const unused = Object.keys(translations[language]).filter(key => !source.includes(JSON.stringify(key)));
  assert.deepEqual(unused, [], `Unused ${language} translations: ${unused.join(", ")}`);
}

const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
for (const className of [
  "eaglebridge-action-group", "eaglebridge-library-filter-row", "eaglebridge-library-trash-button",
  "eaglebridge-missing-repair-button", "eaglebridge-refresh-group", "eaglebridge-view-mode-button",
  "eaglebridge-view-mode-group", "eaglebridge-waterfall-repair-button"
]) assert(!css.includes(className), `Stale CSS class: ${className}`);

const mainSource = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8");
const assetViewSource = fs.readFileSync(path.join(__dirname, "lib", "eagle-assets-view.js"), "utf8");
assert.match(mainSource, /collectMarkdownAttachmentLinks\(text, sourceFile, options = \{\}\)/);
assert.match(mainSource, /mapWithConcurrency\(itemIds, 4/);
assert.match(mainSource, /createEagleAssetsView\(\{ VIEW_TYPE, DEFAULT_SETTINGS \}\)/);
assert.doesNotMatch(mainSource, /class EagleAssetsView extends ItemView/);
assert.match(assetViewSource, /class EagleAssetsView extends ItemView/);
assert.doesNotMatch(mainSource, /confirmAndImportAllUnimportedAttachments|fixCurrentNoteEagleThumbnailLinks/);
const buildScript = fs.readFileSync(path.join(__dirname, "scripts", "build-desktop.js"), "utf8");
assert.match(buildScript, /line\.trim\(\) \? `\$\{prefix\}\$\{line\}` : ""/);

console.log("static cleanup checks passed");
