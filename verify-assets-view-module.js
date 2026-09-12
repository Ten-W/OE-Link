const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    ItemView: class ItemView {}, Menu: class Menu {}, Modal: class Modal {}, Notice: class Notice {}, TFile: class TFile {}, setTooltip() {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { createEagleAssetsView } = require("./lib/eagle-assets-view");
Module._load = originalLoad;

const View = createEagleAssetsView({
  VIEW_TYPE: "test-assets-view",
  DEFAULT_SETTINGS: { assetCardSize: 120, assetListRowHeight: 58 }
});
const view = new View({}, { settings: {} });
const values = {};
const grid = { style: { setProperty(name, value) { values[name] = value; } } };
assert.equal(view.getViewType(), "test-assets-view");
view.applyAssetCardSize(grid, "normal");
view.applyAssetCardSize(grid, "list");
assert.deepEqual(values, {
  "--eaglebridge-asset-card-size": "120px",
  "--eaglebridge-asset-list-row-height": "58px",
  "--eaglebridge-asset-list-column-width": "290px"
});
console.log("asset view module checks passed");
