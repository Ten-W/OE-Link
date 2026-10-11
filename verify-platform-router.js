const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const root = __dirname;
const mainPath = path.join(root, "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const desktopSource = fs.readFileSync(path.join(root, "desktop.js"), "utf8");
const embeddedDesktop = mainSource
  .split("// DESKTOP_BUNDLE_START\n")[1]
  .split("\n// DESKTOP_BUNDLE_END")[0];

assert.strictEqual(embeddedDesktop, desktopSource, "embedded desktop bundle changed");

const forbidden = new Set(["fs", "path", "os", "crypto", "electron"]);
const originalLoad = Module._load;
let isMobile = true;
let allowDesktop = false;
Module._load = function (request, parent, isMain) {
  if (!allowDesktop && forbidden.has(request)) throw new Error(`mobile branch loaded ${request}`);
  if (request === "obsidian") {
    return {
      Platform: { get isMobile() { return isMobile; } },
      Plugin: class Plugin {},
      ItemView: class ItemView {},
      TFile: class TFile {},
      Menu: class Menu {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      Modal: class Modal {},
      Notice: class Notice {},
      requestUrl: async () => ({}),
      editorLivePreviewField: {},
      setIcon() {},
      setTooltip() {},
      addIcon() {},
    };
  }
  if (request === "@codemirror/state") return { Prec: { highest: value => value } };
  if (request === "@codemirror/view") return { Decoration: {}, ViewPlugin: {}, WidgetType: class WidgetType {} };
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const MobilePlugin = require(mainPath);
  assert.strictEqual(typeof MobilePlugin, "function");
  delete require.cache[require.resolve(mainPath)];
  isMobile = false;
  global.localStorage = { getItem: key => key === "oe-link-connection-mode" ? "cloud" : null };
  const DesktopCloudPlugin = require(mainPath);
  assert.strictEqual(DesktopCloudPlugin.name, MobilePlugin.name, "desktop cloud mode should reuse the mobile cloud reader");
  assert.strictEqual(typeof DesktopCloudPlugin._test?.pickWebdavAsset, "function");
  delete require.cache[require.resolve(mainPath)];
  delete global.localStorage;
  allowDesktop = true;
  const DesktopPlugin = require(mainPath);
  assert.strictEqual(typeof DesktopPlugin.prototype.importAttachmentLinks, "function");
  assert.strictEqual(typeof DesktopPlugin.prototype.importCanvasAttachments, "function");
  assert.strictEqual(typeof DesktopPlugin.prototype.buildCurrentNoteExportPlan, "function");
  console.log("Single-file mobile router check passed.");
} finally {
  delete global.localStorage;
  Module._load = originalLoad;
}
