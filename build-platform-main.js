const fs = require("fs");
const path = require("path");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const mobile = read("mobile.js");
const desktop = read("desktop.js");
const controller = read("lib/connection-controller.js");

const output = `const { Platform } = require("obsidian");

function loadMode(mode) {
if (mode === "cloud") {
  const mobileModule = { exports: {} };
  ((module, require) => {
${mobile}
  })(mobileModule, require);
  return mobileModule.exports;
} else {
  const desktopModule = { exports: {} };
  ((module, require) => {
// DESKTOP_BUNDLE_START
${desktop}
// DESKTOP_BUNDLE_END
  })(desktopModule, require);
  return desktopModule.exports;
}
}
const controllerModule = { exports: {} };
((module, require) => {
${controller}
})(controllerModule, require);
module.exports = controllerModule.exports.createConnectionController(loadMode);
`;

fs.writeFileSync(path.join(__dirname, "main.js"), output);

const { version } = JSON.parse(read("manifest.json"));
const releaseRoot = path.join(__dirname, "..", "发行版本", version, "oe-link");
fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css", "logo.svg"]) {
  fs.copyFileSync(path.join(__dirname, name), path.join(releaseRoot, name));
}
const privateSettingsPath = path.join(releaseRoot, "data.json");
if (fs.existsSync(privateSettingsPath)) fs.unlinkSync(privateSettingsPath);
fs.cpSync(path.join(__dirname, "oe-link-helper"), path.join(releaseRoot, "oe-link-helper"), { recursive: true, force: true });
