const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8")
  + fs.readFileSync(path.join(__dirname, "lib", "eagle-assets-view.js"), "utf8");
const chooseRange = (candidates, cachedRange) => {
  const exact = candidates.find(candidate => cachedRange && candidate.start === cachedRange.start && candidate.end === cachedRange.end);
  return exact || (candidates.length === 1 ? candidates[0] : null);
};

assert.deepStrictEqual(chooseRange([{ start: 20, end: 40 }], null), { start: 20, end: 40 });
assert.deepStrictEqual(chooseRange([{ start: 5, end: 9 }, { start: 20, end: 24 }], { start: 20, end: 24 }), { start: 20, end: 24 });
assert.strictEqual(chooseRange([{ start: 5, end: 9 }, { start: 20, end: 24 }], null), null);
assert.match(source, /return exact \|\| \(candidates\.length === 1 \? candidates\[0\] : null\);/);
assert.ok(
  source.indexOf("const visibleAsset = this.chooseNearestRenderedAsset") < source.indexOf("for (let attempt = 0; attempt < 2; attempt += 1)"),
  "Rendered images must be used before the editor-scroll fallback."
);
console.log("Asset source range checks passed.");
