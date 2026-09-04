const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const originalLoad = Module._load;

(async () => {
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return {
    Plugin: class Plugin {}, PluginSettingTab: class PluginSettingTab {}, Setting: class Setting {},
    Menu: class Menu {}, Modal: class Modal {}, Notice: class Notice {}, requestUrl: async () => ({}), setIcon() {}, editorLivePreviewField: {},
  };
  if (request === "@codemirror/state") return { Prec: { highest: value => value } };
  if (request === "@codemirror/view") return { Decoration: {}, ViewPlugin: {}, WidgetType: class WidgetType {} };
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const source = fs.readFileSync(require.resolve("./mobile.js"), "utf8");
  assert.match(source, /const CLIENT_ID = "d112d645-97e6-4b00-a74e-7d4b4eabab79"/);
  assert.match(source, /offline_access Files\.Read User\.Read/);
  assert.doesNotMatch(source, /Files\.ReadWrite|移动端 Vault 同步|syncEnabled|showMobileSettings/);
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /insertAdjacentElement\("afterend", spinner\)/);
  assert.match(source, /prepareAttachmentLink/);
  assert.match(source, /downloadAttachment/);
  assert.doesNotMatch(source, /setName\("当前笔记图片"\)/);
  assert.match(source, /addOption\("webdav", "WebDAV"\)/);
  assert.match(source, /method: "PROPFIND"/);
  assert.doesNotMatch(source, /setName\("加载诊断日志"\)/);
  assert.match(source, /previewOriginalMaxMb: 2/);
  assert.match(source, /maxConcurrentDownloads: 4/);
  assert.doesNotMatch(source, /setName\("当前仓库"\)/);
  assert.match(source, /setName\("语言"\)/);
  assert.match(source, /移动端固定使用云端连接 Eagle 模式/);
  assert.match(source, /请退出 Eagle，或不要安装 OE Link 辅助插件（OE Link Helper）/);
  assert.match(source, /setName\("最多同时下载图片数量"\)/);
  assert.match(source, /while \(this\.activeLoads >= this\.mobile\.maxConcurrentDownloads\)/);
  assert.match(source, /chooseLibrary\(\(\) => this\.display\(\)\)/);
  assert.match(source, /chooseWebdavLibrary\(\)/);
  assert.match(source, /img\.title = "右键或长按可加载 Eagle 原图"/);
  assert.match(source, /img\.title = "已加载 Eagle 原图"/);
  assert.match(source, /handleAttachmentContextMenu/);
  assert.match(source, /"下载原图到本地"/);
  assert.match(source, /setTitle\("用本地应用打开"\)/);
  assert.match(source, /require\("electron"\)\.shell\.openPath\(filePath\)/);
  assert.match(source, /renderMediaAttachment/);
  assert.match(source, /registerEditorExtension\(createCloudLivePreviewExtension\(this\)\)/);
  assert.match(source, /Decoration\.replace\(\{ widget: new CloudAttachmentWidget\(plugin, ref\), inclusive: true \}\)/);
  assert.doesNotMatch(source, /waitForImageMenu|injectImageMenuItems/);
  assert.match(source, /workspace\.on\("editor-menu"/);
  assert.match(source, /pendingEditorAttachment/);
  assert.match(source, /getAvailablePathForAttachment/);
  assert.match(source, /openWithDefaultApp\(path\)/);
  assert.doesNotMatch(source, /img\.onclick = async/);
  assert.match(source, /const targets = this\.findElements\(document, "img\[src\]"\)/);
  assert.match(source, /this\.setImageLoading\(target, true\)/);
  assert.doesNotMatch(source, /loadLog|recordLoad|exportLoadLog/);
  assert.doesNotMatch(source, /stopViewerClick|originalLoading/);
  assert.match(source, /setName\("WebDAV 设置"\)/);
  assert.match(source, /addField\("WebDAV 地址", "https:\/\/example\.com\/dav\/files\/user"/);
  assert.doesNotMatch(source, /setName\("WebDAV (?:地址|用户名|密码)"\)/);
  assert.doesNotMatch(source, /\/content`, true/);
  assert.match(source, /\?select=id,@microsoft\.graph\.downloadUrl/);
  assert.match(source, /requestUrl\(\{ url, method: "GET", throw: false \}\)/);

  const MobilePlugin = require("./mobile.js");
  const {
    extractItemId, getCloudAttachmentKind, parseCloudLinks, parseCloudAttachmentLinks, pickAssetFile, pickWebdavAsset, shouldUseOriginalPreview, joinUrl,
  } = MobilePlugin._test;
  assert.strictEqual(extractItemId("http://localhost:6060/images/MRKSTMYDVP2EJ.info"), "MRKSTMYDVP2EJ");
  assert.strictEqual(pickAssetFile([{ name: "metadata.json", file: {} }, { id: "1", name: "photo.jpg", file: {} }]).id, "1");
  assert.strictEqual(pickAssetFile([{ id: "source", name: "photo.jpg", file: {} }, { id: "preview", name: "photo_thumbnail.png", file: {} }]).id, "preview");
  assert.strictEqual(pickAssetFile([{ id: "preview", name: "photo_thumbnail.png", file: {} }, { id: "source", name: "design.psd", file: {} }], true).id, "source");
  assert.strictEqual(pickWebdavAsset([
    { name: "photo.jpg", url: "original" },
    { name: "photo_thumbnail.png", url: "preview" },
  ], false).url, "preview");
  assert.strictEqual(pickWebdavAsset([
    { name: "design_thumbnail.png", url: "preview" },
    { name: "design.psd", url: "source" },
  ], true).url, "source");
  assert.strictEqual(shouldUseOriginalPreview(5 * 1024 * 1024, 5), true);
  assert.strictEqual(shouldUseOriginalPreview(5 * 1024 * 1024 + 1, 5), false);
  assert.strictEqual(shouldUseOriginalPreview(1, 0), false);
  assert.strictEqual(shouldUseOriginalPreview(undefined, 5), false);
  assert.strictEqual(shouldUseOriginalPreview(0, 5), false);
  assert.strictEqual(getCloudAttachmentKind("声音.mp3"), "audio");
  assert.strictEqual(getCloudAttachmentKind("演示.mp4"), "video");
  assert.strictEqual(getCloudAttachmentKind("资料.pdf"), "pdf");
  assert.strictEqual(getCloudAttachmentKind("合同.doc"), "file");
  assert.deepStrictEqual(parseCloudAttachmentLinks([
    "[合同.doc|0](http://localhost:6060/images/DOC.info)",
    "[声音.mp3](http://localhost:6060/images/AUDIO.info)",
    "![图片.jpg|200](http://localhost:6060/images/IMAGE.info)",
  ].join("\n")).map(ref => [ref.name, ref.kind]), [["合同.doc", "file"], ["声音.mp3", "audio"]]);
  assert.deepStrictEqual(parseCloudLinks("![图片.jpg](http://localhost:6060/images/IMAGE.info)").map(ref => [ref.name, ref.kind]), [["图片.jpg", "image"]]);
  assert.strictEqual(joinUrl("https://example.com/dav/", "/Eagle.library/images"), "https://example.com/dav/Eagle.library/images");

  const makeImage = () => ({
    isConnected: true,
    dataset: { eaglebridgeOriginalSrc: "http://localhost:6060/images/ITEM.info", eaglebridgeOriginalLoaded: "false" },
    src: "preview",
    title: "",
    onclick: null,
    getAttribute(name) { return name === "src" ? this.src : null; },
    classList: { add() {}, remove() {} },
  });
  const image = makeImage();
  const duplicate = makeImage();
  let finishOriginal;
  const originalReady = new Promise(resolve => { finishOriginal = resolve; });
  const loadingStates = [];
  const context = {
    getImage: () => originalReady,
    setImageLoading: (target, loading) => loadingStates.push([target, loading]),
    findElements: () => [image, duplicate],
  };
  global.document = {};
  const loadingOriginal = MobilePlugin.prototype.loadOriginalImage.call(context, "ITEM");
  assert.deepStrictEqual(loadingStates, [[image, true], [duplicate, true]]);
  finishOriginal({ url: "original-url", isOriginal: true });
  await loadingOriginal;
  assert.strictEqual(image.src, "original-url");
  assert.strictEqual(duplicate.src, "original-url");
  assert.strictEqual(image.title, "已加载 Eagle 原图");
  assert.strictEqual(image.dataset.eaglebridgeOriginalLoaded, "true");
  assert.deepStrictEqual(loadingStates.slice(-2), [[image, false], [duplicate, false]]);
  delete global.document;
  console.log("Mobile OneDrive/WebDAV reader check passed.");
} finally {
  Module._load = originalLoad;
}
})().catch(error => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
