const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return { Modal: class Modal {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { chooseExportFormat } = require("./lib/export-package-modal");
Module._load = originalLoad;

Promise.all([
  chooseExportFormat({}, { missing: [], renames: [] }, {}, "zip"),
  chooseExportFormat({}, { missing: [], renames: [] }, {}, "folder")
]).then(formats => {
  assert.deepEqual(formats, ["zip", "folder"]);
  console.log("direct export format checks passed");
}).catch(error => { console.error(error); process.exitCode = 1; });
