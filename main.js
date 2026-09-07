const { Platform } = require("obsidian");

const useCloudMode = Platform.isMobile
  || globalThis.localStorage?.getItem("oe-link-connection-mode") === "cloud";

if (useCloudMode) {
  const mobileModule = { exports: {} };
  ((module, require) => {
const { editorLivePreviewField, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, requestUrl, setIcon } = require("obsidian");
const { Prec } = require("@codemirror/state");
const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const READ_SCOPE = "offline_access Files.Read User.Read";
const CLIENT_ID = "d112d645-97e6-4b00-a74e-7d4b4eabab79";
const CONNECTION_MODE_KEY = "oe-link-connection-mode";
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jfif", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["3gp", "aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]);
const VIDEO_EXTENSIONS = new Set(["avi", "flv", "m4v", "mkv", "mov", "mp4", "ogv", "webm", "wmv"]);
const DEFAULT_MOBILE = {
  sourceType: "onedrive",
  driveId: "", libraryItemId: "", libraryName: "", libraryPath: "",
  webdavUrl: "", webdavUsername: "", webdavLibraryPath: "",
  previewOriginalMaxMb: 2,
  maxConcurrentDownloads: 4,
};

function extractItemId(value) {
  let text = String(value || "");
  for (let i = 0; i < 3; i += 1) {
    const match = text.match(/(?:localhost|127\.0\.0\.1):\d+\/images\/([A-Za-z0-9_-]+)\.info/i);
    if (match) return match[1];
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch (_) {
      break;
    }
  }
  return "";
}

function decodeLinkTarget(value) {
  try { return decodeURIComponent(String(value || "")); } catch (_) { return String(value || ""); }
}

function pickAssetFile(children, original = false) {
  const files = (children || []).filter(item => item.file && item.name !== "metadata.json");
  if (original) return files.find(item => !/(?:^|_)thumbnail\./i.test(item.name) && !item.name.startsWith("_")) || files[0] || null;
  return files.find(item => /(?:^|_)thumbnail\./i.test(item.name))
    || files.find(item => IMAGE_EXTENSIONS.has(item.name.split(".").pop().toLowerCase()))
    || files[0]
    || null;
}

function shouldUseOriginalPreview(size, maxMb) {
  const bytes = Number(size);
  const limit = Number(maxMb);
  return Number.isFinite(bytes) && bytes > 0 && Number.isFinite(limit) && limit > 0
    && bytes <= limit * 1024 * 1024;
}

function pickWebdavAsset(entries, original = false) {
  const files = (entries || []).filter(entry => !entry.isDirectory && entry.name !== "metadata.json");
  if (original) return files.find(entry => !/(?:^|_)thumbnail\./i.test(entry.name) && !entry.name.startsWith("_")) || files[0] || null;
  if (!original) {
    const thumbnail = files.find(entry => /(?:^|_)thumbnail\./i.test(entry.name));
    if (thumbnail) return thumbnail;
  }
  return files.find(entry => !entry.name.startsWith("_") && IMAGE_EXTENSIONS.has(entry.name.split(".").pop().toLowerCase()))
    || files.find(entry => IMAGE_EXTENSIONS.has(entry.name.split(".").pop().toLowerCase()))
    || files[0]
    || null;
}

function mimeFromName(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "jfif"].includes(ext)) return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  if (IMAGE_EXTENSIONS.has(ext)) return `image/${ext}`;
  if (ext === "pdf") return "application/pdf";
  if (["mp4", "webm", "mov"].includes(ext)) return `video/${ext === "mov" ? "quicktime" : ext}`;
  if (["mp3", "wav", "ogg"].includes(ext)) return `audio/${ext}`;
  return "application/octet-stream";
}

function getCloudAttachmentKind(name) {
  const extension = String(name || "").split(".").pop().toLowerCase();
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (extension === "pdf") return "pdf";
  return "file";
}

function parseCloudLinks(text) {
  const refs = [];
  const source = String(text || "");
  const re = /!?\[([^\]\n]*)\]\((?:<)?(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/images\/[A-Za-z0-9_-]+\.info)(?:>)?\)/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const name = String(match[1] || "attachment").replace(/\\([\[\]|])/g, "$1").replace(/\|\d+$/, "").trim();
    const extension = name.split(".").pop().toLowerCase();
    refs.push({ from: match.index, to: match.index + match[0].length, itemId: extractItemId(match[2]), name, url: match[2], kind: IMAGE_EXTENSIONS.has(extension) ? "image" : getCloudAttachmentKind(name) });
  }
  return refs;
}

function parseCloudAttachmentLinks(text) {
  return parseCloudLinks(text).filter(ref => ref.kind !== "image");
}

class CloudAttachmentWidget extends WidgetType {
  constructor(plugin, ref) {
    super();
    this.plugin = plugin;
    this.ref = ref;
  }

  eq(other) {
    return this.ref.url === other.ref.url && this.ref.name === other.ref.name;
  }

  toDOM() {
    return this.plugin.createCloudAttachmentElement(this.ref);
  }

  ignoreEvent() {
    return true;
  }
}

function createCloudLivePreviewExtension(plugin) {
  const build = view => {
    if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
    const selections = view.state.selection.ranges;
    const ranges = parseCloudAttachmentLinks(view.state.doc.toString())
      .filter(ref => !selections.some(selection => selection.empty
        ? selection.from >= ref.from && selection.from < ref.to
        : selection.from < ref.to && selection.to > ref.from))
      .map(ref => Decoration.replace({ widget: new CloudAttachmentWidget(plugin, ref), inclusive: true }).range(ref.from, ref.to));
    return Decoration.set(ranges, true);
  };
  return Prec.highest(ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = build(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = build(update.view);
    }
  }, { decorations: value => value.decorations }));
}

function joinUrl(base, path = "") {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function basicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

class DeviceCodeModal extends Modal {
  constructor(app, details) {
    super(app);
    this.details = details;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "连接 Microsoft OneDrive" });
    contentEl.createEl("p", { text: this.details.message });
    new Setting(contentEl).setName("验证码").setDesc(this.details.user_code).addButton(button => button
      .setButtonText("复制").onClick(() => {
        navigator.clipboard.writeText(this.details.user_code);
        new Notice("验证码已复制");
      }));
    new Setting(contentEl).addButton(button => button.setButtonText("打开登录页面").setCta()
      .onClick(() => window.open(this.details.verification_uri, "_blank")));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FolderPickerModal extends Modal {
  constructor(app, plugin, options, onChoose) {
    super(app);
    this.plugin = plugin;
    this.options = options;
    this.onChoose = onChoose;
    this.stack = [];
  }

  async onOpen() {
    await this.showFolder(null, this.options.rootTitle || "OneDrive");
  }

  async showFolder(item, title) {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "eaglebridge-mobile-folder-header" });
    header.createEl("h2", { text: this.options.title });
    const actions = header.createDiv({ cls: "eaglebridge-mobile-folder-actions" });
    if (this.stack.length) {
      const back = actions.createEl("button", { text: "返回上一级" });
      back.addEventListener("click", async () => {
        const previous = this.stack.pop();
        await this.showFolder(previous.item, previous.title);
      });
    }
    if (item && this.options.accept(item)) {
      const select = actions.createEl("button", { text: "选择当前文件夹", cls: "mod-cta" });
      select.addEventListener("click", () => {
        this.onChoose(item);
        this.close();
      });
    }
    contentEl.createEl("p", { text: title });
    const status = contentEl.createEl("p", { text: "正在读取文件夹..." });
    try {
      const children = this.options.loadChildren
        ? await this.options.loadChildren(item)
        : (await this.plugin.graph(item
          ? `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}/children?$select=id,name,folder,parentReference`
          : "/me/drive/root/children?$select=id,name,folder,parentReference")).value;
      status.remove();
      for (const child of children || []) {
        if (!this.options.loadChildren && !child.folder) continue;
        const row = contentEl.createEl("button", { text: child.name, cls: "eaglebridge-mobile-folder-row" });
        row.addEventListener("click", async () => {
          this.stack.push({ item, title });
          await this.showFolder(child, `${title} / ${child.name}`);
        });
      }
    } catch (error) {
      status.setText(`读取失败：${error.message}`);
      if (!this.stack.length && this.options.onRootError) {
        this.close();
        this.options.onRootError(error);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class WebdavPathModal extends Modal {
  constructor(app, initialPath, onChoose) {
    super(app);
    this.path = initialPath || "";
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "输入 Eagle 素材库路径" });
    new Setting(contentEl).setName("文件夹路径").setDesc("相对于 WebDAV 根地址，例如 Eagle素材库.library")
      .addText(text => text.setValue(this.path).onChange(value => { this.path = value; }));
    new Setting(contentEl).addButton(button => button.setButtonText("使用此路径").setCta().onClick(() => {
      const path = this.path.trim().replace(/^\/+|\/+$/g, "");
      if (!path) return new Notice("请输入 Eagle 素材库路径");
      this.onChoose(path);
      this.close();
    }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MobileSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const mobile = this.plugin.mobile;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OE Link 云端连接模式" });
    new Setting(containerEl).setName("语言").setDesc("选择插件界面语言。自动模式会跟随 Obsidian 或系统语言。")
      .addDropdown(dropdown => dropdown
        .addOption("auto", "自动")
        .addOption("zh", "中文")
        .addOption("en", "English")
        .setValue(this.plugin.settings.language || "auto")
        .onChange(async value => {
          this.plugin.settings.language = value || "auto";
          await this.plugin.saveMobile();
          this.display();
        }));
    const modeDescription = document.createDocumentFragment();
    modeDescription.append(Platform.isMobile ? "移动端固定使用云端连接 Eagle 模式。" : "当前为云端连接 Eagle 模式。");
    if (!Platform.isMobile) {
      const warning = document.createElement("span");
      warning.className = "eaglebridge-cloud-warning";
      warning.textContent = " 云端连接模式下，请退出 Eagle，或不要安装 OE Link 辅助插件（OE Link Helper），否则会导致图片显示错误。";
      modeDescription.append(warning);
    }
    const modeSetting = new Setting(containerEl).setName("连接模式").setDesc(modeDescription);
    if (!Platform.isMobile) modeSetting.addButton(button => button
      .setButtonText("返回本地连接模式")
      .onClick(() => this.plugin.switchConnectionMode("local")));
    new Setting(containerEl).setName("素材来源").setDesc("只读访问 Eagle 素材，不负责同步 Obsidian 仓库。")
      .addDropdown(dropdown => dropdown
        .addOption("onedrive", "OneDrive")
        .addOption("webdav", "WebDAV")
        .setValue(mobile.sourceType)
        .onChange(async value => {
          mobile.sourceType = value;
          this.plugin.clearCache();
          await this.plugin.saveMobile();
          this.display();
        }));
    if (mobile.sourceType === "webdav") {
      const webdavSetting = new Setting(containerEl).setName("WebDAV 设置");
      webdavSetting.settingEl.addClass("eaglebridge-mobile-webdav-setting");
      webdavSetting.controlEl.empty();
      const fields = webdavSetting.controlEl.createDiv({ cls: "eaglebridge-mobile-webdav-fields" });
      const addField = (label, placeholder, value, type, onChange) => {
        const field = fields.createDiv({ cls: "eaglebridge-mobile-webdav-field" });
        const input = field.createEl("input", { type });
        input.setAttr("aria-label", label);
        input.value = value;
        input.placeholder = placeholder;
        input.addEventListener("input", () => onChange(input.value));
      };
      addField("WebDAV 地址", "WebDAV 地址，例如：https://example.com/dav/files/user", mobile.webdavUrl, "text", async value => {
        mobile.webdavUrl = value.trim();
        await this.plugin.saveMobile();
      });
      addField("用户名", "用户名", mobile.webdavUsername, "text", async value => {
        mobile.webdavUsername = value;
        await this.plugin.saveMobile();
      });
      addField("密码", "密码，未修改则保持原密码", "", "password", value => this.plugin.setWebdavPassword(value));
      new Setting(containerEl).setName("Eagle 素材库路径").setDesc("相对于 WebDAV 根地址的 .library 文件夹路径。")
        .addText(text => text.setPlaceholder("Eagle素材库.library").setValue(mobile.webdavLibraryPath).onChange(async value => {
          mobile.webdavLibraryPath = value.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveMobile();
        }))
        .addButton(button => button.setButtonText("选择文件夹").onClick(() => this.plugin.chooseWebdavLibrary()))
        .addButton(button => button.setButtonText("测试读取").onClick(() => this.plugin.testLibrary()));
    } else {
    new Setting(containerEl).setName("Microsoft 账户").setDesc(this.plugin.connected ? "已连接" : "尚未连接")
      .addButton(button => button.setButtonText(this.plugin.connected ? "重新授权" : "连接").setCta().onClick(async () => {
        try {
          await this.plugin.connect();
          this.display();
        } catch (error) {
          console.error("OE Link Microsoft login failed", error);
          new Notice(`连接失败：${error?.message || error}`, 10000);
        }
      }))
      .addButton(button => button.setButtonText("断开").onClick(async () => {
        await this.plugin.disconnect();
        this.display();
      }));
    new Setting(containerEl).setName("OneDrive Eagle 素材库").setDesc(mobile.libraryPath || "尚未选择 .library 文件夹")
      .addButton(button => button.setButtonText("选择文件夹").onClick(() => this.plugin.chooseLibrary(() => this.display())))
      .addButton(button => button.setButtonText("测试读取").onClick(() => this.plugin.testLibrary()));
    }
    new Setting(containerEl).setName("预览原图直载上限（MB）")
      .setDesc("图片不超过此大小时直接读取原图；超过时优先读取 Eagle 缩略图。填 0 时所有图片都优先使用缩略图。")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.step = "1";
        text.setValue(String(mobile.previewOriginalMaxMb)).onChange(async value => {
          const parsed = Number(value);
          mobile.previewOriginalMaxMb = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
          this.plugin.clearCache();
          await this.plugin.saveMobile();
        });
      });
    new Setting(containerEl).setName("最多同时下载图片数量")
      .setDesc("限制 OneDrive 或 WebDAV 同时执行的图片下载任务数量。")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "16";
        text.inputEl.step = "1";
        text.setValue(String(mobile.maxConcurrentDownloads)).onChange(async value => {
          const parsed = Number(value);
          mobile.maxConcurrentDownloads = Number.isFinite(parsed) && parsed >= 1
            ? Math.min(16, Math.floor(parsed)) : 4;
          await this.plugin.saveMobile();
        });
      });
    new Setting(containerEl).setName("移动图片缓存")
      .setDesc(`当前会话已缓存 ${this.plugin.cache.size} 张图片；退出 Obsidian 后自动释放。`)
      .addButton(button => button.setButtonText("清除缓存").onClick(() => {
        this.plugin.clearCache();
        this.display();
      }));
  }
}

class EagleBridgeMobilePlugin extends Plugin {
  async onload() {
    this.settings = (await this.loadData()) || {};
    this.mobile = { ...DEFAULT_MOBILE, ...(this.settings.mobile || {}) };
    const previewLimit = Number(this.mobile.previewOriginalMaxMb);
    this.mobile.previewOriginalMaxMb = Number.isFinite(previewLimit) && previewLimit >= 0 ? previewLimit : 2;
    const concurrency = Number(this.mobile.maxConcurrentDownloads);
    this.mobile.maxConcurrentDownloads = Number.isFinite(concurrency) && concurrency >= 1
      ? Math.min(16, Math.floor(concurrency)) : 4;
    this.cache = new Map();
    this.pending = new Map();
    this.activeLoads = 0;
    this.loadWaiters = [];
    this.observedImages = new WeakMap();
    this.imageSpinners = new WeakMap();
    this.imageObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      const center = window.innerHeight / 2;
      for (const entry of entries) {
        const state = this.observedImages.get(entry.target);
        if (state && !entry.isIntersecting) state.leftViewport = true;
      }
      entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - center) - Math.abs(b.boundingClientRect.top - center))
        .forEach(entry => {
          const img = entry.target;
          const state = this.observedImages.get(img);
          if (!state || state.loading || state.loaded || (state.failed && !state.leftViewport)) return;
          state.leftViewport = false;
          void this.loadImage(img, state.force || state.failed);
        });
    }, { rootMargin: "600px 0px", threshold: 0.01 });
    this.accessToken = "";
    this.connected = Boolean(await this.getRefreshToken());
    this.addSettingTab(new MobileSettingTab(this.app, this));
    this.registerEditorExtension(createCloudLivePreviewExtension(this));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => this.addEditorAttachmentMenuItems(menu, editor)));
    this.registerMarkdownPostProcessor(el => this.processAssets(el));
    this.registerDomEvent(document, "contextmenu", event => { void this.handleAttachmentContextMenu(event); }, true);
    this.domObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) void this.processAssets(record.target);
        for (const node of record.addedNodes) if (node instanceof Element) void this.processAssets(node);
      }
    });
    this.domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
    void this.processAssets(document);
  }

  onunload() {
    this.imageObserver?.disconnect();
    this.domObserver?.disconnect();
    this.clearCache();
  }

  get secretKey() {
    return "oe-link-onedrive-refresh-token";
  }

  async saveMobile() {
    this.settings = { ...this.settings, mobile: { ...this.mobile } };
    await this.saveData(this.settings);
  }

  switchConnectionMode(mode) {
    globalThis.localStorage?.setItem(CONNECTION_MODE_KEY, mode);
    const pluginId = this.manifest.id;
    setTimeout(async () => {
      await this.app.plugins.disablePlugin(pluginId);
      await this.app.plugins.enablePlugin(pluginId);
      this.app.setting?.openTabById(pluginId);
    }, 0);
  }

  async getRefreshToken() {
    return (await this.app.secretStorage?.getSecret(this.secretKey)) || "";
  }

  async setRefreshToken(token) {
    await this.app.secretStorage?.setSecret(this.secretKey, token || "");
  }

  get webdavSecretKey() {
    return "oe-link-webdav-password";
  }

  async getWebdavPassword() {
    return (await this.app.secretStorage?.getSecret(this.webdavSecretKey)) || "";
  }

  async setWebdavPassword(password) {
    await this.app.secretStorage?.setSecret(this.webdavSecretKey, password || "");
  }

  async connect() {
    const device = await requestUrl({
      url: `${LOGIN}/devicecode`, method: "POST", contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: READ_SCOPE }).toString(), throw: false,
    });
    if (device.status < 200 || device.status >= 300) {
      throw new Error(device.json?.error_description || device.text || `Microsoft 登录失败 (${device.status})`);
    }
    const modal = new DeviceCodeModal(this.app, device.json);
    modal.open();
    const deadline = Date.now() + device.json.expires_in * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, (device.json.interval || 5) * 1000));
      const token = await this.tokenRequest({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: device.json.device_code,
      }, true);
      if (!token) continue;
      modal.close();
      await this.acceptToken(token);
      new Notice("OneDrive 已连接");
      return;
    }
    modal.close();
    throw new Error("Microsoft 登录已超时");
  }

  async disconnect() {
    this.accessToken = "";
    await this.setRefreshToken("");
    this.connected = false;
    this.clearCache();
    new Notice("OneDrive 已断开");
  }

  async tokenRequest(fields, allowPending = false) {
    const response = await requestUrl({
      url: `${LOGIN}/token`, method: "POST", contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams(fields).toString(), throw: false,
    });
    if (response.status >= 200 && response.status < 300) return response.json;
    if (allowPending && ["authorization_pending", "slow_down"].includes(response.json?.error)) return null;
    throw new Error(response.json?.error_description || `Microsoft 登录失败 (${response.status})`);
  }

  async acceptToken(token) {
    this.accessToken = token.access_token;
    if (token.refresh_token) await this.setRefreshToken(token.refresh_token);
    this.connected = true;
  }

  async ensureAccessToken() {
    if (this.accessToken) return this.accessToken;
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) throw new Error("请先在设置中连接 Microsoft OneDrive");
    const token = await this.tokenRequest({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken, scope: READ_SCOPE });
    await this.acceptToken(token);
    return this.accessToken;
  }

  async graph(path, binary = false, retried = false) {
    return this.graphRequest(path, { binary, retried });
  }

  async graphRequest(path, options = {}) {
    const token = await this.ensureAccessToken();
    const response = await requestUrl({
      url: path.startsWith("http") ? path : `${GRAPH}${path}`,
      method: options.method || "GET", headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      contentType: options.contentType, body: options.body, throw: false,
    });
    if (response.status === 401 && !options.retried) {
      this.accessToken = "";
      return this.graphRequest(path, { ...options, retried: true });
    }
    if (response.status < 200 || response.status >= 300) throw new Error(response.json?.error?.message || `OneDrive 读取失败 (${response.status})`);
    return options.binary ? response.arrayBuffer : response.json;
  }

  async downloadUrl(url) {
    const response = await requestUrl({ url, method: "GET", throw: false });
    if (response.status < 200 || response.status >= 300) throw new Error(`OneDrive 下载失败 (${response.status})`);
    return response.arrayBuffer;
  }

  async downloadDriveItem(drive, itemId) {
    const item = await this.graph(`/drives/${drive}/items/${encodeURIComponent(itemId)}?select=id,@microsoft.graph.downloadUrl`);
    const url = item["@microsoft.graph.downloadUrl"];
    if (!url) throw new Error("OneDrive 未返回文件下载地址");
    return this.downloadUrl(url);
  }

  chooseLibrary(onSelected) {
    new FolderPickerModal(this.app, this, {
      title: "选择 Eagle .library 文件夹", selectDescription: "使用这个 Eagle 素材库",
      accept: item => String(item.name).toLowerCase().endsWith(".library"),
    }, async item => {
      this.mobile.driveId = item.parentReference.driveId;
      this.mobile.libraryItemId = item.id;
      this.mobile.libraryName = item.name;
      this.mobile.libraryPath = item.parentReference.path
        ? `${item.parentReference.path.replace(/^\/drive\/root:/, "")}/${item.name}` : item.name;
      await this.saveMobile();
      new Notice(`已选择 ${item.name}`);
      onSelected?.();
    }).open();
  }

  chooseWebdavLibrary() {
    const savePath = async path => {
      this.mobile.webdavLibraryPath = path.trim().replace(/^\/+|\/+$/g, "");
      this.clearCache();
      await this.saveMobile();
      new Notice(`已选择 ${this.mobile.webdavLibraryPath}`);
    };
    const manual = () => new WebdavPathModal(this.app, this.mobile.webdavLibraryPath, savePath).open();
    if (!this.mobile.webdavUrl) {
      manual();
      return;
    }
    new FolderPickerModal(this.app, this, {
      title: "选择 Eagle .library 文件夹",
      rootTitle: "WebDAV",
      accept: item => String(item.name).toLowerCase().endsWith(".library"),
      loadChildren: async item => {
        const parentPath = item?.path || "";
        const url = item?.url || this.mobile.webdavUrl;
        const entries = await this.webdavList(url);
        return entries.filter(entry => entry.isDirectory).map(entry => ({
          ...entry,
          path: [parentPath, entry.name].filter(Boolean).join("/")
        }));
      },
      onRootError: manual
    }, item => savePath(item.path)).open();
  }

  async testLibrary() {
    try {
      if (this.mobile.sourceType === "webdav") {
        const entries = await this.webdavList(joinUrl(this.mobile.webdavUrl, this.mobile.webdavLibraryPath));
        if (!entries.some(entry => entry.isDirectory && entry.name === "images")) throw new Error("所选目录不是 Eagle .library 文件夹");
        new Notice("WebDAV Eagle 素材库读取正常");
      } else {
        if (!this.mobile.libraryItemId) throw new Error("请先选择 Eagle .library 文件夹");
        await this.graph(`/drives/${encodeURIComponent(this.mobile.driveId)}/items/${encodeURIComponent(this.mobile.libraryItemId)}?$select=id,name`);
        new Notice("OneDrive Eagle 素材库读取正常");
      }
    } catch (error) {
      new Notice(error.message);
    }
  }

  findElements(root, selector) {
    return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  }

  async processAssets(root, force = false) {
    const images = this.findElements(root, "img[src]").filter(img => extractItemId(img.dataset.eaglebridgeOriginalSrc || img.getAttribute("src")));
    if (!this.imageObserver) {
      await Promise.all(images.map(img => this.loadImage(img, force)));
    } else {
      for (const img of images) {
        const current = this.observedImages.get(img);
        if (current && !force) continue;
        this.observedImages.set(img, { force: force || current?.force || false, loading: false, loaded: false, failed: false, leftViewport: true });
        this.imageObserver.observe(img);
      }
    }
    for (const link of this.findElements(root, "a[href]")) this.prepareAttachmentLink(link);
  }

  setImageLoading(img, loading) {
    const old = this.imageSpinners.get(img);
    old?.remove();
    this.imageSpinners.delete(img);
    if (!loading || !img.parentElement) return;
    const spinner = document.createElement("span");
    spinner.className = "eaglebridge-mobile-spinner";
    spinner.setAttribute("aria-label", "正在加载");
    img.insertAdjacentElement("afterend", spinner);
    this.imageSpinners.set(img, spinner);
  }

  prepareAttachmentLink(link) {
    if (link.dataset.oeLinkDownloadReady || link.querySelector("img")) return;
    const itemId = extractItemId(link.getAttribute("href"));
    if (!itemId) return;
    link.dataset.oeLinkDownloadReady = "true";
    const name = String(link.textContent || `${itemId}.bin`).replace(/\|\d+$/, "").trim();
    const kind = getCloudAttachmentKind(name);
    if (kind !== "file") {
      void this.renderMediaAttachment(link, itemId, name, kind);
      return;
    }
    this.renderFileAttachment(link, itemId, name);
  }

  renderFileAttachment(link, itemId, name) {
    link.className = "eaglebridge-file-embed";
    link.dataset.eaglebridgeItemId = itemId;
    link.dataset.eaglebridgeName = name;
    link.removeAttribute("target");
    link.replaceChildren();
    const icon = document.createElement("span");
    icon.className = "eaglebridge-file-embed-icon";
    setIcon(icon, "file");
    const label = document.createElement("span");
    label.textContent = name;
    link.append(icon, label);
    link.title = "点按用本地应用打开";
    link.onclick = event => {
      event.preventDefault();
      void this.openAttachment(itemId, link);
    };
  }

  createCloudAttachmentElement(ref) {
    const container = document.createElement("span");
    container.className = "eaglebridge-cloud-live-preview-attachment";
    const link = document.createElement("a");
    link.href = ref.url;
    link.dataset.oeLinkDownloadReady = "true";
    link.textContent = ref.name;
    container.appendChild(link);
    if (ref.kind === "file") this.renderFileAttachment(link, ref.itemId, ref.name);
    else void this.renderMediaAttachment(link, ref.itemId, ref.name, ref.kind);
    return container;
  }

  async renderMediaAttachment(link, itemId, name, kind) {
    link.classList.add("eaglebridge-mobile-attachment-loading");
    try {
      const asset = await this.getImage(itemId, true, false);
      const media = document.createElement(kind === "pdf" ? "iframe" : kind);
      media.src = asset.url;
      media.className = kind === "pdf" ? "eaglebridge-pdf-embed" : "eaglebridge-media-embed";
      media.dataset.eaglebridgeItemId = itemId;
      media.dataset.eaglebridgeName = name;
      media.setAttribute("aria-label", name);
      if (kind === "pdf") media.setAttribute("title", name);
      else {
        media.controls = true;
        media.preload = "metadata";
      }
      link.replaceWith(media);
    } catch (error) {
      link.classList.remove("eaglebridge-mobile-attachment-loading");
      link.title = `附件预览失败：${error.message}`;
      this.renderFileAttachment(link, itemId, name);
    }
  }

  async downloadAttachment(itemId, link) {
    link.classList.add("eaglebridge-mobile-attachment-loading");
    try {
      const asset = await this.getImage(itemId, true, false);
      await this.downloadAsset(asset, itemId);
    } catch (error) {
      new Notice(`附件下载失败：${error.message}`);
    } finally {
      link.classList.remove("eaglebridge-mobile-attachment-loading");
    }
  }

  async openAttachment(itemId, element) {
    element?.classList.add("eaglebridge-mobile-attachment-loading");
    try {
      const asset = await this.getImage(itemId, true, false);
      if (Platform.isMobile) return await this.openMobileAsset(asset, itemId);
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const directory = path.join(os.tmpdir(), "oe-link");
      fs.mkdirSync(directory, { recursive: true });
      const safeName = String(asset.name || `${itemId}.bin`).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
      const filePath = path.join(directory, `${itemId}-${safeName}`);
      fs.writeFileSync(filePath, Buffer.from(await asset.blob.arrayBuffer()));
      const error = await require("electron").shell.openPath(filePath);
      if (error) throw new Error(error);
    } catch (error) {
      new Notice(`打开附件失败：${error.message}`);
    } finally {
      element?.classList.remove("eaglebridge-mobile-attachment-loading");
    }
  }

  async openMobileAsset(asset, itemId) {
    const directory = `${this.app.vault.configDir}/plugins/${this.manifest.id}/open-cache`;
    try { await this.app.vault.adapter.mkdir(directory); } catch (_) {}
    const safeName = String(asset.name || `${itemId}.bin`).replace(/[\\/:*?"<>|]/g, "_");
    const path = `${directory}/${itemId}-${safeName}`;
    await this.app.vault.adapter.writeBinary(path, await asset.blob.arrayBuffer());
    await this.app.openWithDefaultApp(path);
  }

  async downloadAsset(asset, itemId) {
    if (Platform.isMobile) {
      const activeFile = this.app.workspace.getActiveFile();
      const name = String(asset.name || `${itemId}.bin`).replace(/[\\/:*?"<>|]/g, "_");
      const path = await this.app.fileManager.getAvailablePathForAttachment(name, activeFile?.path || "");
      await this.app.vault.createBinary(path, await asset.blob.arrayBuffer());
      new Notice(`已下载到 Obsidian：${path}`);
      return path;
    }
    const download = document.createElement("a");
    download.href = asset.url;
    download.download = asset.name || `${itemId}.bin`;
    document.body.appendChild(download);
    download.click();
    download.remove();
  }

  async loadOriginalImage(itemId) {
    const targets = this.findElements(document, "img[src]").filter(candidate =>
      extractItemId(candidate.dataset.eaglebridgeOriginalSrc || candidate.getAttribute("src")) === itemId
    );
    for (const target of targets) {
      target.classList.add("eaglebridge-mobile-loading");
      this.setImageLoading(target, true);
    }
    try {
      const asset = await this.getImage(itemId, true, false);
      for (const target of targets) {
        if (!target.isConnected) continue;
        target.src = asset.url;
        target.dataset.eaglebridgeOriginalLoaded = "true";
        target.title = "已加载 Eagle 原图";
      }
      return asset;
    } finally {
      for (const target of targets) {
        target.classList.remove("eaglebridge-mobile-loading");
        this.setImageLoading(target, false);
      }
    }
  }

  getCloudReferenceAtCursor(editor) {
    const cursor = editor?.getCursor();
    const line = cursor && editor.getLine(cursor.line);
    return parseCloudLinks(line).find(ref => ref.from <= cursor.ch && cursor.ch <= ref.to) || null;
  }

  getLocalAttachmentAtCursor(editor) {
    const cursor = editor?.getCursor();
    const line = cursor && editor.getLine(cursor.line);
    if (!line) return null;
    const matches = [];
    for (const re of [/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g, /!?\[[^\]\n]*\]\((?:<)?([^)>\s]+)(?:>)?\)/g]) {
      let match;
      while ((match = re.exec(line)) !== null) matches.push({ from: match.index, to: match.index + match[0].length, target: match[1] });
    }
    const match = matches.find(item => item.from <= cursor.ch && cursor.ch <= item.to);
    if (!match || /^(?:https?|data|blob):/i.test(match.target)) return null;
    const activeFile = this.app.workspace.getActiveFile();
    return this.app.metadataCache.getFirstLinkpathDest(decodeLinkTarget(match.target), activeFile?.path || "");
  }

  addCloudAttachmentMenuItems(menu, itemId, isImage, element) {
    if (isImage && element?.dataset.eaglebridgeOriginalLoaded !== "true") menu.addItem(item => item
      .setTitle("加载原图").setIcon("zoom-in").onClick(() => this.loadOriginalImage(itemId)));
    menu.addItem(item => item.setTitle(isImage ? "下载原图到本地" : "下载到本地").setIcon("download").onClick(async () => {
      await this.downloadAsset(await this.getImage(itemId, true, false), itemId);
    }));
    if (!isImage) menu.addItem(item => item.setTitle("用本地应用打开").setIcon("external-link")
      .onClick(() => this.openAttachment(itemId, element)));
  }

  addEditorAttachmentMenuItems(menu, editor) {
    const pending = this.pendingEditorAttachment;
    this.pendingEditorAttachment = null;
    const ref = pending && Date.now() - pending.at < 1000 ? pending.ref : this.getCloudReferenceAtCursor(editor);
    if (ref) return this.addCloudAttachmentMenuItems(menu, ref.itemId, ref.kind === "image");
    const file = this.getLocalAttachmentAtCursor(editor);
    if (file && file.extension !== "md") menu.addItem(item => item.setTitle("用本地应用打开").setIcon("external-link")
      .onClick(() => this.app.openWithDefaultApp(file.path)));
  }

  resolveLocalAttachment(element) {
    const activeFile = this.app.workspace.getActiveFile();
    const source = element.matches?.("[src], [href], [data-href]") ? element : element.querySelector?.("[src], [href], [data-href]");
    const candidates = ["data-href", "aria-label", "alt", "src", "href"].map(name =>
      String(source?.getAttribute?.(name) || element.getAttribute?.(name) || "").trim()
    ).concat(String(element.textContent || "").trim()).filter(Boolean);
    for (const candidate of candidates) {
      const clean = decodeLinkTarget(candidate).split(/[?#]/)[0];
      const file = this.app.metadataCache.getFirstLinkpathDest(clean, activeFile?.path || "");
      if (file && file.extension !== "md") return file;
    }
    return null;
  }

  async handleAttachmentContextMenu(event) {
    const attachment = event.target && event.target.closest && event.target.closest(
      "img[src], audio, video, .file-embed, .media-embed, .pdf-embed, .internal-embed, .eaglebridge-file-embed, .eaglebridge-media-embed, .eaglebridge-pdf-embed"
    );
    if (!attachment) return;
    const isImage = attachment.tagName === "IMG";
    const itemId = isImage
      ? extractItemId(attachment.dataset.eaglebridgeOriginalSrc || attachment.getAttribute("src"))
      : String(attachment.dataset.eaglebridgeItemId || "");
    if (!attachment.closest(".markdown-preview-view")) {
      if (itemId) this.pendingEditorAttachment = {
        at: Date.now(),
        ref: { itemId, kind: isImage ? "image" : getCloudAttachmentKind(attachment.dataset.eaglebridgeName) }
      };
      return;
    }
    const localFile = itemId ? null : this.resolveLocalAttachment(attachment);
    if (!itemId && !localFile) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    if (itemId) this.addCloudAttachmentMenuItems(menu, itemId, isImage, attachment);
    else menu.addItem(item => item.setTitle("用本地应用打开").setIcon("external-link")
      .onClick(() => this.app.openWithDefaultApp(localFile.path)));
    menu.showAtMouseEvent(event);
  }

  async loadImage(img, force = false) {
    if (!img.isConnected) return;
    const original = img.dataset.eaglebridgeOriginalSrc || img.getAttribute("src");
    const itemId = extractItemId(original);
    if (!itemId || !this.hasLibrary()) return;
    const state = this.observedImages.get(img) || { force, leftViewport: false };
    if (state.loading) return;
    state.loading = true;
    state.failed = false;
    this.observedImages.set(img, state);
    img.dataset.eaglebridgeOriginalSrc = original;
    img.classList.add("eaglebridge-mobile-loading");
    this.setImageLoading(img, true);
    try {
      const preview = await this.getImage(itemId, false, force);
      img.src = preview.url;
      img.onclick = null;
      img.classList.remove("eaglebridge-mobile-loading", "eaglebridge-mobile-error");
      state.loaded = true;
      state.force = false;
      this.imageObserver?.unobserve(img);
      if (preview.isOriginal) {
        img.dataset.eaglebridgeOriginalLoaded = "true";
        img.title = "已加载 Eagle 原图";
        return;
      }
      img.dataset.eaglebridgeOriginalLoaded = "false";
      img.title = "右键或长按可加载 Eagle 原图";
    } catch (error) {
      img.classList.remove("eaglebridge-mobile-loading");
      img.classList.add("eaglebridge-mobile-error");
      state.failed = true;
      state.leftViewport = false;
      img.title = `${error.message}；重新滚入视野或点按重试`;
      img.onclick = () => {
        state.leftViewport = true;
        void this.loadImage(img, true);
      };
    } finally {
      state.loading = false;
      this.setImageLoading(img, false);
    }
  }

  async getImage(itemId, original, force) {
    const key = `${this.mobile.sourceType}:${itemId}:${original ? "original" : "preview"}`;
    if (force) this.dropCache(key);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.fetchImage(itemId, original).then(result => {
      this.cache.set(key, result);
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async fetchImage(itemId, original) {
    return this.withLoadSlot(() => this.mobile.sourceType === "webdav"
      ? this.fetchWebdavImage(itemId, original)
      : this.fetchOneDriveImage(itemId, original));
  }

  async fetchOneDriveImage(itemId, original) {
    const drive = encodeURIComponent(this.mobile.driveId);
    const library = encodeURIComponent(this.mobile.libraryItemId);
    const info = `${encodeURIComponent(itemId)}.info`;
    const children = await this.graph(`/drives/${drive}/items/${library}:/images/${info}:/children?$select=id,name,file,size`);
    const source = pickAssetFile(children.value, true);
    const eagleThumbnail = pickAssetFile(children.value, false);
    if (!source) throw new Error(`Eagle 素材 ${itemId} 中没有可读取的文件`);
    const sourceIsImage = IMAGE_EXTENSIONS.has(source.name.split(".").pop().toLowerCase());
    const directOriginal = original || (sourceIsImage && shouldUseOriginalPreview(source.size, this.mobile.previewOriginalMaxMb));
    let asset = source;
    let isOriginal = directOriginal;
    let bytes;
    if (!directOriginal && eagleThumbnail && /(?:^|_)thumbnail\./i.test(eagleThumbnail.name)) {
      asset = eagleThumbnail;
      bytes = await this.downloadDriveItem(drive, asset.id);
    } else if (!directOriginal && sourceIsImage) {
      try {
        const thumbnail = await this.graph(`/drives/${drive}/items/${encodeURIComponent(source.id)}/thumbnails/0/large`);
        if (!thumbnail.url) throw new Error("OneDrive 未返回缩略图下载地址");
        bytes = await this.downloadUrl(thumbnail.url);
      } catch (_) {
        bytes = null;
      }
    }
    if (!bytes) {
      asset = source;
      isOriginal = true;
      bytes = await this.downloadDriveItem(drive, asset.id);
    }
    const blob = new Blob([bytes], { type: mimeFromName(asset.name) });
    return { url: URL.createObjectURL(blob), name: asset.name, blob, isOriginal };
  }

  hasLibrary() {
    return this.mobile.sourceType === "webdav"
      ? Boolean(this.mobile.webdavUrl && this.mobile.webdavLibraryPath)
      : Boolean(this.mobile.libraryItemId);
  }

  async webdavHeaders() {
    const headers = {};
    const password = await this.getWebdavPassword();
    if (this.mobile.webdavUsername || password) headers.Authorization = basicAuth(this.mobile.webdavUsername, password);
    return headers;
  }

  async webdavRequest(url, options = {}) {
    const response = await requestUrl({
      url,
      method: options.method || "GET",
      headers: { ...(await this.webdavHeaders()), ...(options.headers || {}) },
      contentType: options.contentType,
      body: options.body,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`WebDAV 读取失败 (${response.status})`);
    return options.binary ? response.arrayBuffer : response.text;
  }

  async webdavList(url) {
    const xml = await this.webdavRequest(url, {
      method: "PROPFIND",
      headers: { Depth: "1" },
      contentType: "application/xml",
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/><getcontentlength/></prop></propfind>',
    });
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("WebDAV 返回了无效的目录信息");
    return [...document.getElementsByTagNameNS("*", "response")].slice(1).map(response => {
      const value = name => response.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() || "";
      const href = value("href");
      const rawName = value("displayname") || href.split("/").filter(Boolean).pop() || "";
      let name = rawName;
      try { name = decodeURIComponent(rawName); } catch (_) {}
      return {
        name,
        url: new URL(href, url).href,
        isDirectory: Boolean(response.getElementsByTagNameNS("*", "collection").length),
        size: Number(value("getcontentlength")) || 0,
      };
    });
  }

  async fetchWebdavImage(itemId, original) {
    const folder = joinUrl(this.mobile.webdavUrl, `${this.mobile.webdavLibraryPath}/images/${itemId}.info`);
    const entries = await this.webdavList(folder);
    const source = pickWebdavAsset(entries, true);
    const eagleThumbnail = pickWebdavAsset(entries, false);
    if (!source) throw new Error(`Eagle 素材 ${itemId} 中没有可读取的文件`);
    const sourceIsImage = IMAGE_EXTENSIONS.has(source.name.split(".").pop().toLowerCase());
    const directOriginal = original || (sourceIsImage && shouldUseOriginalPreview(source.size, this.mobile.previewOriginalMaxMb));
    const asset = directOriginal ? source : eagleThumbnail;
    const isOriginal = asset === source || !/(?:^|_)thumbnail\./i.test(asset.name);
    const bytes = await this.webdavRequest(asset.url, { binary: true });
    const blob = new Blob([bytes], { type: mimeFromName(asset.name) });
    return { url: URL.createObjectURL(blob), name: asset.name, blob, isOriginal };
  }

  async withLoadSlot(callback) {
    while (this.activeLoads >= this.mobile.maxConcurrentDownloads) {
      await new Promise(resolve => this.loadWaiters.push(resolve));
    }
    this.activeLoads += 1;
    try {
      return await callback();
    } finally {
      this.activeLoads -= 1;
      this.loadWaiters.shift()?.();
    }
  }

  dropCache(key) {
    const cached = this.cache.get(key);
    if (cached?.url) URL.revokeObjectURL(cached.url);
    this.cache.delete(key);
  }

  clearCache() {
    for (const key of [...this.cache.keys()]) this.dropCache(key);
  }
}

EagleBridgeMobilePlugin._test = {
  extractItemId, getCloudAttachmentKind, parseCloudLinks, parseCloudAttachmentLinks, pickAssetFile, pickWebdavAsset, shouldUseOriginalPreview, joinUrl,
};
module.exports = EagleBridgeMobilePlugin;

  })(mobileModule, require);
  module.exports = mobileModule.exports;
} else {
// DESKTOP_BUNDLE_START
// OE Link desktop bundle.
// Generated from main.source.js and lib/*.js by scripts/build-desktop.js.
// Do not edit this file directly; edit the modular sources and rebuild.
(function(nativeRequire, nativeModule) {
  "use strict";

  const factories = {
  "./main": function(module, exports, require, __filename, __dirname) {
    const { Plugin, ItemView, Menu, Notice, addIcon, requestUrl: nativeRequestUrl, TFile } = require("obsidian");
    const nodePath = require("path");
    const { setTooltip } = require("obsidian");
    const nodeFs = require("fs");
    const nodeOs = require("os");
    const nodeCrypto = require("crypto");
    const { getDefaultEaglePluginsDir, normalizeEagleFolderId } = require("./lib/asset-utils");
    
    const VIEW_TYPE = "eaglebridge-note-assets-view";
    const CONNECTION_MODE_KEY = "oe-link-connection-mode";
    const EAGLE_HELPER_PLUGIN_ID = "oe-link-helper";
    const EAGLE_HELPER_PLUGIN_VERSION = "0.2.13";
    const EAGLE_HELPER_PORTS = Array.from({ length: 10 }, (_, index) => 41596 + index);
    
    function getRequestServiceName(request) {
      const url = String(request && request.url || "");
      if (/127\.0\.0\.1:41(?:59[6-9]|60[0-5])/i.test(url)) return "OE Link 辅助插件";
      if (/:41595(?:\/|$)/.test(url)) return "Eagle API";
      if (/:6060(?:\/|$)/.test(url)) return "OE Link 素材服务";
      return "网络素材服务";
    }
    
    async function requestResponse(request, serviceName = getRequestServiceName(request), attempt = 0) {
      let response;
      try {
        response = await nativeRequestUrl(request);
      } catch (error) {
        if (attempt === 0 && String(request && request.method || "GET").toUpperCase() === "GET") {
          await new Promise(resolve => setTimeout(resolve, 160));
          return requestResponse(request, serviceName, 1);
        }
        throw new Error(`${serviceName} request failed: ${error && error.message ? error.message : error}`);
      }
      if (response && Number(response.status) >= 500 && attempt === 0 && String(request && request.method || "GET").toUpperCase() === "GET") {
        await new Promise(resolve => setTimeout(resolve, 160));
        return requestResponse(request, serviceName, 1);
      }
      if (!response || Number(response.status) >= 400) {
        const detail = response && response.text ? String(response.text).slice(0, 240) : "";
        throw new Error(`${serviceName} request failed, status ${response && response.status ? response.status : "unknown"}${detail ? `: ${detail}` : ""}`);
      }
      return response;
    }
    
    // Preserve legacy raw-response call sites while putting every request behind
    // the same network and HTTP-status error boundary.
    const requestUrl = request => requestResponse(request);
    
    const DEFAULT_SETTINGS = {
      language: "auto",
      assetViewMode: "normal",
      assetCardSize: 120,
      assetListRowHeight: 58,
      eagleApiBaseUrl: "http://localhost:41595",
      eagleFolderId: "",
      tagManagementEnabled: true,
      folderManagementEnabled: true,
      autoTagOnRefresh: false,
      autoFolderOnImport: false,
      autoImportAttachments: false,
      importExternalLocalAttachments: false,
      useObsidianFolderTree: false,
      eagleFolderNameTemplate: "{{title}}-{{created}}",
      managedEagleFolders: {},
      // Stable source-to-folder records let a global rebuild rename existing
      // dedicated folders instead of creating a new folder for every rule change.
      managedEagleFoldersBySource: {},
      // Exact Eagle item IDs and managed tags observed for each source document.
      // This lets deletion clean only that document's folder membership safely.
      managedSourceAssetAssociations: {},
      noteIdentityDates: {},
      canvasIdentityDates: {},
      noteTagNameTemplate: "Obsidian-{{title}}-{{created}}",
      canvasTagNameTemplate: "Obsidian-cavs-{{title}}-{{created}}",
      eagleBridgeBaseUrl: "http://localhost:6060",
      eagleBridgeLibraryPaths: [],
      eagleProtocolUrl: "eagle://",
      eagleHelperPluginsDir: getDefaultEaglePluginsDir(),
      trashAfterImport: false,
      autoRefreshReferenceView: false,
      replacementTemplate: "![{filename}]({bridgeUrl})"
    };
    
    const {
      SUPPORTED_ATTACHMENT_EXTENSIONS, PREVIEWABLE_IMAGE_EXTENSIONS, getAssetSummary, normalizeAssetViewMode,
      clampNumber, buildEagleFolderUrl, formatIdentityDate, normalizeIdentityTitle,
      buildTitleDateIdentity, isIdentityDate, getFileIdentityDate, getStableIdentityDate,
      isObsidianManagedTag, isProbablyMarkdownTableRow, isProbablyMarkdownTableLine, getLineAtIndex,
      indexToLineCh, getLineBefore, getLineAfter, hasUnescapedPipe,
      isMarkdownTableSeparatorLine, escapeMarkdownTablePipes, makeMarkdownTableSafeReference, splitList, stripExtension,
      getSourceParentPath, getSourceParentPathFromPath, getSourceManagedFolderPath, getSourceManagedFolderPathFromPath,
      vaultPathBasename, normalizeVaultPath, isInsideEagleLibrary, findEagleFolderById, findEagleFolderWithParentById,
      normalizeFolderName, normalizeCreatedEagleFolder, collectEagleFolderIds, isSupportedSourceFile,
      isExternalLink, supportedAttachmentExtensions, isSupportedAttachment, isSupportedCanvasAttachment,
      isPreviewableImage, normalizeCanvasNodeSize, createFilePlaceholder, createNotePlaceholder,
      getAssetDisplayName, isStableEagleItem, isLikelySameAssetByName, isLikelySameAssetByAnyName,
      getDuplicateRepairSearchNames, getDuplicateRepairExpectedExtension, uniqueItemsById, mapWithConcurrency,
      getEagleItemNameCandidates, normalizeMatchName, getEagleItemMatchSignature, isSameEagleAssetSignature,
      firstNumberValue, getNestedNumberValue, getAssetExtension, getWikiAttachmentTarget,
      cleanEagleBridgeLabel, sanitizeEagleBridgeEmbedLabel, getDisplayNameWithoutObsidianSize, getExtensionFromDisplayName, getInternetAttachmentDisplayName,
      getFileNameFromUrl, isLikelyImageSizeLabel, cleanLocalCopyCandidateName, normalizeExtension, parseAttachmentReference,
      cleanAttachmentTarget, cleanExternalAttachmentUrl, stripAttachmentSubpath, stripMarkdownLinkTitle, findSupportedAttachmentExtensionEnd,
      findMarkdownAttachmentReferences, getAttachmentReferenceSignature, preserveAttachmentDisplaySize,
      findClosingBracket, findMarkdownTargetEnd, decodeAttachmentPath,
      getItemTime, getEagleItemId, extractEagleBridgeItemIdFromText, isEagleItemTrashed,
      itemHasEagleFolder, getEagleItemFolderIds, findOriginalFileInEagleInfoDir, replaceEagleBridgeIdsInText,
      readJsonFile, copyDirectory, compareVersions,
      isTruthyFlag, getTrashBadgeAnchor, removeTrashBadgesForImage, removeFollowingTrashBadges,
      stripInfoSuffix, sleep, normalizeFileUrl, fileUrlToLocalPath, externalLocalPathFromTarget,
      eagleLocalPathToFsPath, normalizeFileUrlPath, safeDecode, escapeRegExp,
      buildHtmlImage, buildStandardEagleBridgeEmbed, escapeHtmlAttr, unescapeHtmlAttr
    } = require("./lib/asset-utils");
    
    const TRANSLATIONS = require("./lib/translations");
    const { EagleItemRepository } = require("./lib/eagle-item-repository");
    const { KeyedTaskScheduler } = require("./lib/keyed-task-scheduler");
    const { chooseInObsidianModal } = require("./lib/choice-modal");
    const { EagleBridgeProgressModal } = require("./lib/progress-modal");
    const { createEagleAssetsSettingTab } = require("./lib/settings-tab");
    const { createAttachmentElement, createLivePreviewAttachmentExtension, getAttachmentKind, normalizeLegacyNonImageEmbeds } = require("./lib/live-preview-attachments");
    const EagleAssetsSettingTab = createEagleAssetsSettingTab({ DEFAULT_SETTINGS, VIEW_TYPE });
    
    const OE_LINK_ICON = `
    <svg class="eaglebridge-menu-icon" viewBox="0 0 226 226" fill="none" aria-hidden="true">
      <path d="M189 72C189 52.1178 172.882 36 153 36H72C52.1178 36 36 52.1177 36 72V153C36 172.882 52.1177 189 72 189H153C172.882 189 189 172.882 189 153" stroke="currentColor" stroke-width="20" stroke-linecap="round"/>
      <path d="M189 73H127C122.029 73 118 77.0294 118 82V143C118 147.971 122.029 152 127 152H189" stroke="currentColor" stroke-width="20" stroke-linecap="round"/>
      <path d="M118 113H189" stroke="currentColor" stroke-width="20" stroke-linecap="round"/>
    </svg>`;
    const EAGLE_ICON = OE_LINK_ICON;
    const EAGLE_COMPANION_ICON = OE_LINK_ICON;
    
    const LIBRARY_VIEW_ICONS = {
      waterfall: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="33" y="33" width="69" height="48" rx="12"/><rect x="126" y="33" width="69" height="103" rx="12"/><rect x="33" y="102" width="69" height="93" rx="12"/><rect x="126" y="158" width="69" height="37" rx="12"/></svg>`,
      list: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="36" y="33" width="69" height="69" rx="12"/><rect x="36" y="126" width="69" height="69" rx="12"/><path d="M124 49H191"/><path d="M124 141H191"/><path d="M124 88H191"/><path d="M124 180H191"/></svg>`,
      normal: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="33" y="33" width="69" height="69" rx="12"/><rect x="126" y="33" width="69" height="69" rx="12"/><rect x="33" y="126" width="69" height="69" rx="12"/><rect x="126" y="126" width="69" height="69" rx="12"/></svg>`
    };
    
    module.exports = class EagleBridgeNoteAssetsPlugin extends Plugin {
      async onload() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.migrateSettings();
        this.desktopDiagnosticEvents = [];
        this.registerDomEvent(document, "error", event => {
          const target = event && event.target;
          const src = target && target.tagName === "IMG" ? String(target.currentSrc || target.src || "") : "";
          if (/\/images\/[^/?#]+\.info/i.test(src)) this.recordDesktopDiagnosticEvent("image-error", { src });
        }, true);
        setTimeout(() => {
          this.syncCompanionMediaService().catch(error => {
            console.warn("OE Link media service is not ready:", error);
          });
        }, 800);
        this.eagleItems = new EagleItemRepository({
          request: request => this.requestEagleApiJson(request),
          getBaseUrl: () => this.settings.eagleApiBaseUrl,
          normalizeId: stripInfoSuffix,
          cacheTtlMs: 1200
        });
        this.autoSyncScheduler = new KeyedTaskScheduler();
        this.trashScanScheduler = new KeyedTaskScheduler();
        this.referenceViewRefreshScheduler = new KeyedTaskScheduler();
        this.semanticModifyScheduler = new KeyedTaskScheduler();
        this.attachmentReferenceSignatures = new Map();
        this.sourceRevealGeneration = 0;
        addIcon("eagle-outline", EAGLE_COMPANION_ICON);
        this.registerView(VIEW_TYPE, leaf => new EagleAssetsView(leaf, this));
        this.registerEditorExtension(createLivePreviewAttachmentExtension(this));
    
        this.addRibbonIcon("eagle-outline", this.t("ribbonShowAssets"), async () => {
          await this.openReferenceView();
        });
    
        this.addCommand({
          id: "open-current-note-eagle-assets",
          name: this.t("cmdShowAssets"),
          callback: async () => this.openReferenceView()
        });
    
        this.addCommand({
          id: "copy-current-note-eagle-tag",
          name: this.t("cmdCopyTag"),
          callback: async () => {
            const context = await this.getCurrentNoteContext();
            if (!context || !(context.tags && context.tags.length)) return;
            await navigator.clipboard.writeText(context.tags[0]);
            new Notice(this.t("noticeCopiedEagleTag", { tag: context.tags[0] }));
          }
        });
    
        this.addCommand({
          id: "import-current-note-attachments-to-eagle",
          name: this.t("cmdImportAttachments"),
          callback: async () => this.importCurrentNoteAttachments()
        });
    
        this.addCommand({
          id: "fix-current-note-eagle-thumbnail-links",
          name: this.t("cmdFixThumbnailLinks"),
          callback: async () => this.fixCurrentNoteEagleThumbnailLinks()
        });
    
        this.addCommand({
          id: "fix-current-note-double-encoded-file-links",
          name: this.t("cmdFixDoubleEncodedLinks"),
          callback: async () => this.fixCurrentNoteDoubleEncodedFileLinks()
        });
    
        this.addCommand({
          id: "convert-current-note-eagle-file-links-to-eaglebridge",
          name: this.t("cmdConvertFileLinks"),
          callback: async () => this.convertCurrentNoteEagleFileLinksToBridge()
        });
    
        this.addCommand({
          id: "convert-current-note-eaglebridge-image-embeds-to-links",
          name: this.t("cmdConvertEmbedsToLinks"),
          callback: async () => this.convertCurrentNoteEagleBridgeEmbedsToLinks()
        });
    
        this.addCommand({
          id: "convert-current-note-eaglebridge-links-to-html-images",
          name: this.t("cmdConvertLinksToHtml"),
          callback: async () => this.convertCurrentNoteEagleBridgeLinksToHtmlImages()
        });
    
        this.addCommand({
          id: "convert-current-note-eaglebridge-links-to-standard-embeds",
          name: this.t("cmdConvertLinksToEmbeds"),
          callback: async () => this.convertCurrentNoteEagleBridgeLinksToStandardEmbeds()
        });
    
        this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
          if (!this.getImportableAttachmentAtCursor(editor, view)) return;
          menu.addItem(item => item
            .setTitle(this.t("menuImportAttachment"))
            .setIcon("eagle-outline")
            .onClick(async () => {
              await this.importAttachmentAtCursor(editor, view);
            }));
        }));
    
        this.registerDomEvent(document, "contextmenu", event => {
          this.handleRenderedImageContextMenu(event);
        }, true);
        this.renderedImagePointerDown = null;
        this.suppressRenderedImageClickUntil = 0;
        this.registerDomEvent(document, "click", event => {
          this.handleRenderedImageClick(event);
        }, true);
        this.registerDomEvent(document, "pointerdown", event => {
          this.handleRenderedImagePointerDown(event);
        }, true);
        // Live Preview table cells may swallow the final click event. Pointerup
        // keeps real image clicks working, while drag gestures are filtered out.
        this.registerDomEvent(document, "pointerup", event => {
          this.handleRenderedImagePointerUp(event);
        }, true);
        this.registerEvent(this.app.workspace.on("editor-drop", (event, editor) => {
          this.handleEditorDrop(event, editor).catch(error => {
            console.warn("Failed to handle OE Link editor drop:", error);
            new Notice(`导入 Eagle 素材失败：${error.message || "未知错误"}`);
          });
        }));
        if (document && typeof document.addEventListener === "function") {
          const editorDragOverHandler = event => this.handleEditorDragOver(event);
          document.addEventListener("dragover", editorDragOverHandler, true);
          this.register(() => document.removeEventListener("dragover", editorDragOverHandler, true));
        }
    
        this.registerMarkdownPostProcessor(el => {
          this.decorateEagleBridgeFileLinks(el);
          this.scheduleTrashStatusScan(el);
        });
        this.knownEagleBridgeItemIdsByFile = new Map();
        this.lastCanvasRename = null;
        this.lastNoteRename = null;
        this.referenceViewRefreshing = false;
        this.referenceViewRefreshQueued = false;
        this.referenceViewOperationDepth = 0;
        this.lastRenderedImageActivation = null;
        const initialActiveFile = this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
          ? this.app.workspace.getActiveFile()
          : null;
        this.lastActiveMarkdownLeaf = null;
        this.rememberActiveMarkdownLeaf(this.app.workspace.activeLeaf);
        this.lastReferenceViewActiveFilePath = initialActiveFile instanceof TFile ? initialActiveFile.path : "";
        if (initialActiveFile instanceof TFile) {
          void this.normalizeLegacyNonImageEagleBridgeEmbeds(initialActiveFile);
          this.rememberAttachmentReferenceSignature(initialActiveFile);
        }
        this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
          this.rememberActiveMarkdownLeaf(leaf);
          this.scheduleTrashStatusScan(document);
          this.rememberCurrentFileEagleBridgeIds();
          const activeFile = leaf?.view?.file instanceof TFile
            ? leaf.view.file
            : (this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
              ? this.app.workspace.getActiveFile()
              : null);
          const activePath = activeFile instanceof TFile ? activeFile.path : "";
          if (activePath !== this.lastReferenceViewActiveFilePath) {
            this.lastReferenceViewActiveFilePath = activePath;
            this.scheduleReferenceViewRefresh(null, 0);
          }
        }));
        this.registerEvent(this.app.workspace.on("file-open", async file => {
          if (!(file instanceof TFile)) return;
          const activeFile = this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
            ? this.app.workspace.getActiveFile()
            : null;
          if (!(activeFile instanceof TFile) || activeFile.path !== file.path) return;
          await this.normalizeLegacyNonImageEagleBridgeEmbeds(file);
          this.rememberAttachmentReferenceSignature(file);
          this.lastReferenceViewActiveFilePath = file.path;
          this.scheduleReferenceViewRefresh(null, 0);
        }));
        this.registerEvent(this.app.workspace.on("layout-change", () => {
          this.scheduleTrashStatusScan(document);
        }));
        this.registerEvent(this.app.vault.on("modify", file => {
          this.scheduleSemanticSourceModify(file);
        }));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
          const previousSignature = this.attachmentReferenceSignatures.get(oldPath);
          this.attachmentReferenceSignatures.delete(oldPath);
          if (previousSignature !== undefined && file instanceof TFile) this.attachmentReferenceSignatures.set(file.path, previousSignature);
          this.invalidateLibraryReferenceSummaries();
          this.rememberNoteRename(file, oldPath);
          this.rememberCanvasRename(file, oldPath);
          this.renameManagedSourceAssetAssociation(file, oldPath).catch(error => {
            console.warn("Failed to migrate Eagle source associations after rename:", error);
          });
          this.syncManagedEagleFolderRename(file, oldPath).catch(error => {
            console.warn("Failed to sync managed Eagle folder rename:", error);
          });
          this.scheduleAutoSyncForModifiedFile(file, "full");
          this.scheduleReferenceViewRefresh(file);
        }));
        this.registerEvent(this.app.vault.on("delete", file => {
          if (file && file.path) this.attachmentReferenceSignatures.delete(file.path);
          this.invalidateLibraryReferenceSummaries();
          this.cleanupDeletedSourceFile(file).catch(error => {
            console.warn("Failed to clean Eagle associations after source deletion:", error);
          });
        }));
    
        this.addSettingTab(new EagleAssetsSettingTab(this.app, this));
      }
    
      onunload() {
        this.cancelReferenceViewRefresh();
        this.autoSyncScheduler && this.autoSyncScheduler.clear();
        this.trashScanScheduler && this.trashScanScheduler.clear();
        this.referenceViewRefreshScheduler && this.referenceViewRefreshScheduler.clear();
        this.semanticModifyScheduler && this.semanticModifyScheduler.clear();
        this.eagleItems && this.eagleItems.clear();
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
      }
    
      async saveSettings() {
        await this.saveData(this.settings);
      }
    
      switchConnectionMode(mode) {
        globalThis.localStorage?.setItem(CONNECTION_MODE_KEY, mode);
        const pluginId = this.manifest.id;
        setTimeout(async () => {
          await this.app.plugins.disablePlugin(pluginId);
          await this.app.plugins.enablePlugin(pluginId);
          this.app.setting?.openTabById(pluginId);
        }, 0);
      }
    
      getCompanionMediaUrl() {
        return String(this.settings.eagleBridgeBaseUrl || DEFAULT_SETTINGS.eagleBridgeBaseUrl)
          .trim()
          .replace(/\/+$/, "") || DEFAULT_SETTINGS.eagleBridgeBaseUrl;
      }
    
      getEagleApiUrl(path) {
        const base = String(this.settings.eagleApiBaseUrl || DEFAULT_SETTINGS.eagleApiBaseUrl).trim().replace(/\/+$/, "");
        return /^https?:\/\//i.test(String(path || "")) ? path : `${base}/${String(path || "").replace(/^\/+/, "")}`;
      }
    
      async detectReachableBaseUrl(candidates, path, serviceName) {
        let lastError = null;
        for (const candidate of [...new Set(candidates.map(value => String(value || "").trim().replace(/\/+$/, "")).filter(Boolean))]) {
          try {
            await requestResponse({ url: `${candidate}/${path.replace(/^\/+/, "")}`, method: "GET", timeout: 2500 }, serviceName);
            return candidate;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error(`${serviceName} was not detected.`);
      }
    
      async detectAndFillEagleApiUrl() {
        const value = await this.detectReachableBaseUrl(
          [this.settings.eagleApiBaseUrl, DEFAULT_SETTINGS.eagleApiBaseUrl],
          "api/application/info",
          "Eagle API"
        );
        this.settings.eagleApiBaseUrl = value;
        await this.saveSettings();
        return value;
      }
    
      async detectAndFillCompanionMediaUrl() {
        const value = await this.detectReachableBaseUrl(
          [this.settings.eagleBridgeBaseUrl, DEFAULT_SETTINGS.eagleBridgeBaseUrl],
          "health",
          "OE Link media service"
        );
        this.settings.eagleBridgeBaseUrl = value;
        await this.saveSettings();
        return value;
      }
    
      async detectAndFillEagleHelperPluginsDir() {
        const value = this.resolveEagleHelperPluginsDir();
        this.settings.eagleHelperPluginsDir = value;
        await this.saveSettings();
        return value;
      }
    
      async detectAndFillEagleLibraryPaths() {
        let detected = [];
        try {
          const body = await this.requestEagleHelperJson("library/current", { method: "GET", timeout: 2500 });
          detected = [String(body && body.data && body.data.path || "").trim()];
        } catch (error) {
          const home = nodeOs.homedir();
          const roots = [...new Set([
            home,
            nodePath.join(home, "OneDrive"),
            process.env.OneDrive,
            process.env.OneDriveConsumer,
            process.env.OneDriveCommercial
          ].filter(Boolean))];
          for (const root of roots) {
            try {
              for (const entry of nodeFs.readdirSync(root, { withFileTypes: true })) {
                if (entry.isDirectory() && /\.library$/i.test(entry.name)) detected.push(nodePath.join(root, entry.name));
              }
            } catch (_) {}
          }
        }
        detected = detected.filter(value => value && /\.library$/i.test(value) && nodeFs.existsSync(value));
        if (!detected.length) throw new Error("未检测到 Eagle .library 素材库路径。");
        const paths = [...new Set([...(this.settings.eagleBridgeLibraryPaths || []), ...detected].filter(Boolean))];
        this.settings.eagleBridgeLibraryPaths = paths;
        await this.saveSettings();
        await this.syncCompanionMediaService();
        return paths;
      }
    
      async requestJson(request, serviceName) {
        const response = await requestResponse(request, serviceName);
        const body = response && response.json ? response.json : {};
        if (body && body.status && body.status !== "success") {
          throw new Error(body.message || `${serviceName} returned an error.`);
        }
        return body;
      }
    
      requestEagleApiJson(request) {
        return this.requestJson(request, "Eagle API");
      }
    
      async detectEagleHelperBaseUrl() {
        if (this.eagleHelperBaseUrl) return this.eagleHelperBaseUrl;
        if (this.eagleHelperProbeFailedAt && Date.now() - this.eagleHelperProbeFailedAt < 5000) {
          throw new Error(`未检测到 OE Link Helper ${EAGLE_HELPER_PLUGIN_VERSION}。`);
        }
        const results = await Promise.all(EAGLE_HELPER_PORTS.map(async port => {
          const base = `http://127.0.0.1:${port}`;
          try {
            const response = await nativeRequestUrl({ url: `${base}/health`, method: "GET", timeout: 350 });
            const body = response && response.json ? response.json : {};
            return body.status === "success" && compareVersions(String(body.version || "0.0.0"), EAGLE_HELPER_PLUGIN_VERSION) >= 0
              ? base
              : "";
          } catch (_) {
            return "";
          }
        }));
        const base = results.find(Boolean);
        if (base) {
          this.eagleHelperBaseUrl = base;
          this.eagleHelperProbeFailedAt = 0;
          return base;
        }
        this.eagleHelperProbeFailedAt = Date.now();
        throw new Error(`未检测到 OE Link Helper ${EAGLE_HELPER_PLUGIN_VERSION}。`);
      }
    
      async requestEagleHelperJson(path, options = {}) {
        const base = await this.detectEagleHelperBaseUrl();
        try {
          return await this.requestJson(Object.assign({
            url: `${base}/${String(path || "").replace(/^\/+/, "")}`
          }, options), "Eagle helper");
        } catch (error) {
          this.eagleHelperBaseUrl = "";
          this.eagleHelperProbeFailedAt = Date.now();
          throw error;
        }
      }
    
      getCompanionMediaPort() {
        try {
          const parsed = new URL(this.getCompanionMediaUrl());
          const port = Number.parseInt(parsed.port || "6060", 10);
          return Number.isInteger(port) && port >= 1000 && port <= 9999 ? port : 6060;
        } catch (error) {
          return 6060;
        }
      }
    
      async syncCompanionMediaService() {
        const payload = await this.requestEagleHelperJson("media/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            port: this.getCompanionMediaPort(),
            libraryPaths: Array.isArray(this.settings.eagleBridgeLibraryPaths) ? this.settings.eagleBridgeLibraryPaths : []
          })
        });
        return payload.data || {};
      }
    
      recordDesktopDiagnosticEvent(type, data = {}) {
        if (!Array.isArray(this.desktopDiagnosticEvents)) this.desktopDiagnosticEvents = [];
        this.desktopDiagnosticEvents.push({ time: new Date().toISOString(), type, ...data });
        if (this.desktopDiagnosticEvents.length > 100) this.desktopDiagnosticEvents.shift();
      }
    
      async probeDesktopDiagnosticUrl(url, method = "GET") {
        const startedAt = Date.now();
        try {
          const response = await nativeRequestUrl({ url, method });
          return {
            url,
            method,
            status: Number(response && response.status) || 0,
            contentType: String(response && response.headers && (response.headers["content-type"] || response.headers["Content-Type"]) || ""),
            elapsedMs: Date.now() - startedAt
          };
        } catch (error) {
          return { url, method, error: error && error.message ? error.message : String(error), elapsedMs: Date.now() - startedAt };
        }
      }
    
      async exportDesktopDiagnosticLog() {
        const activeFile = this.app.workspace.getActiveFile();
        const source = activeFile instanceof TFile && isSupportedSourceFile(activeFile)
          ? await this.app.vault.read(activeFile)
          : "";
        const itemIds = Array.from(new Set(this.extractEagleBridgeItemIds(source).map(stripInfoSuffix).filter(Boolean))).slice(0, 20);
        const mediaBase = this.getCompanionMediaUrl();
        let ipv4MediaBase = mediaBase;
        try {
          const parsed = new URL(mediaBase);
          parsed.hostname = "127.0.0.1";
          ipv4MediaBase = parsed.toString().replace(/\/$/, "");
        } catch (_) {}
    
        const helperBase = await this.detectEagleHelperBaseUrl().catch(() => "");
        const probes = await Promise.all([
          this.probeDesktopDiagnosticUrl(`${this.getEagleApiUrl("").replace(/\/$/, "")}/api/application/info`),
          ...(helperBase ? [
            this.probeDesktopDiagnosticUrl(`${helperBase}/health`),
            this.probeDesktopDiagnosticUrl(`${helperBase}/diagnostic/status`)
          ] : EAGLE_HELPER_PORTS.map(port => this.probeDesktopDiagnosticUrl(`http://127.0.0.1:${port}/health`))),
          this.probeDesktopDiagnosticUrl(`${mediaBase}/health`),
          this.probeDesktopDiagnosticUrl(`${ipv4MediaBase}/health`)
        ]);
        const items = [];
        for (const itemId of itemIds) {
          let helper = null;
          let helperError = "";
          try {
            const response = await this.requestEagleHelperJson("diagnostic/item", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId })
            });
            helper = response.data || null;
          } catch (error) {
            helperError = error && error.message ? error.message : String(error);
          }
          items.push({
            itemId,
            helper,
            helperError,
            media: await Promise.all([
              this.probeDesktopDiagnosticUrl(`${mediaBase}/images/${encodeURIComponent(itemId)}.info`, "HEAD"),
              this.probeDesktopDiagnosticUrl(`${ipv4MediaBase}/images/${encodeURIComponent(itemId)}.info`, "HEAD")
            ])
          });
        }
    
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = `oe-link-desktop-diagnostic-${stamp}.log`;
        await this.app.vault.adapter.write(path, JSON.stringify({
          exportedAt: new Date().toISOString(),
          pluginVersion: this.manifest.version,
          helperRequiredVersion: EAGLE_HELPER_PLUGIN_VERSION,
          platform: process.platform,
          activeFile: activeFile ? activeFile.path : "",
          configured: {
            eagleApiBaseUrl: this.settings.eagleApiBaseUrl,
            eagleBridgeBaseUrl: this.settings.eagleBridgeBaseUrl,
            eagleHelperBaseUrl: helperBase,
            libraryPaths: this.settings.eagleBridgeLibraryPaths || []
          },
          probes,
          items,
          events: this.desktopDiagnosticEvents || []
        }, null, 2));
        new Notice(`诊断日志已导出到仓库根目录：${path}`);
        return path;
      }
    
      async openEagleItem(itemId) {
        const cleanItemId = stripInfoSuffix(itemId);
        if (!cleanItemId) return;
        const rawBase = String(this.settings.eagleProtocolUrl || "eagle://").trim() || "eagle://";
        const base = /^eagle:\/+$/i.test(rawBase) ? "eagle://" : `${rawBase.replace(/\/+$/, "")}/`;
        let protocolOpened = false;
        const openProtocol = () => {
          if (protocolOpened) return;
          protocolOpened = true;
          this.openExternalUrl(`${base}item/${encodeURIComponent(cleanItemId)}`);
        };
        const open = () => this.requestEagleHelperJson("item/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: cleanItemId })
        });
        const protocolTimer = window.setTimeout(openProtocol, 250);
        try {
          await open();
          window.clearTimeout(protocolTimer);
          this.recordDesktopDiagnosticEvent("item-open", {
            itemId: cleanItemId,
            status: protocolOpened ? "success-after-protocol" : "success"
          });
        } catch (firstError) {
          window.clearTimeout(protocolTimer);
          openProtocol();
          this.eagleHelperBaseUrl = "";
          void sleep(350).then(open).then(() => {
            this.recordDesktopDiagnosticEvent("item-open", { itemId: cleanItemId, status: "success-after-retry" });
          }).catch(error => {
            const message = error && error.message ? error.message : String(error);
            this.recordDesktopDiagnosticEvent("item-open", { itemId: cleanItemId, status: "fallback", error: message });
          });
        }
      }
    
      async openAttachmentInDefaultApp(ref) {
        if (ref && ref.localPath) {
          const error = await require("electron").shell.openPath(ref.localPath);
          if (error) throw new Error(error);
          return;
        }
        const itemId = stripInfoSuffix(ref && ref.itemId);
        if (!itemId) return;
        const item = await this.queryEagleItemInfo(itemId, { force: true });
        const fullPath = item && await this.getOriginalPathForEagleItem(item);
        if (!fullPath) throw new Error("无法找到该附件的原始文件。");
        const error = await require("electron").shell.openPath(fullPath);
        if (error) throw new Error(error);
      }
    
      isPreviewableAttachmentImage(name) {
        return isPreviewableImage(name);
      }
    
      getPluginInstallRootPath() {
        const adapter = this.app && this.app.vault && this.app.vault.adapter;
        if (adapter && typeof adapter.getFullPath === "function" && this.manifest && this.manifest.dir) {
          return adapter.getFullPath(this.manifest.dir);
        }
        return "";
      }
    
      getBundledEagleHelperPath() {
        const root = this.getPluginInstallRootPath();
        return root ? nodePath.join(root, "oe-link-helper") : "";
      }
    
      getEagleHelperInstallPath() {
        const pluginsDir = String(this.settings.eagleHelperPluginsDir || DEFAULT_SETTINGS.eagleHelperPluginsDir || "").trim();
        return pluginsDir ? nodePath.join(pluginsDir, EAGLE_HELPER_PLUGIN_ID) : "";
      }
    
      resolveEagleHelperPluginsDir() {
        const configuredDir = String(this.settings.eagleHelperPluginsDir || "").trim();
        const defaultDir = String(DEFAULT_SETTINGS.eagleHelperPluginsDir || "").trim();
        const candidates = [...new Set([configuredDir, defaultDir].filter(Boolean))];
        for (const candidate of candidates) {
          try {
            if (nodeFs.existsSync(candidate) && nodeFs.statSync(candidate).isDirectory()) {
              return candidate;
            }
          } catch (_) {
            // Try the next configured directory.
          }
        }
        throw new Error("Eagle 插件目录不存在或不可访问。请填写 Eagle 的 Plugins 目录后重试。");
      }
    
      async installOrUpdateEagleHelperPlugin() {
        try {
          const sourceDir = this.getBundledEagleHelperPath();
          const pluginsDir = this.resolveEagleHelperPluginsDir();
          const targetDir = nodePath.join(pluginsDir, EAGLE_HELPER_PLUGIN_ID);
          if (!sourceDir || !nodeFs.existsSync(sourceDir)) {
            throw new Error("Bundled Eagle helper plugin is missing.");
          }
          if (this.settings.eagleHelperPluginsDir !== pluginsDir) {
            this.settings.eagleHelperPluginsDir = pluginsDir;
            await this.saveSettings();
          }
          const sourceManifest = readJsonFile(nodePath.join(sourceDir, "manifest.json")) || {};
          const targetManifest = readJsonFile(nodePath.join(targetDir, "manifest.json")) || {};
          const sourceVersion = String(sourceManifest.version || EAGLE_HELPER_PLUGIN_VERSION);
          const targetVersion = String(targetManifest.version || "");
          if (targetManifest.id === EAGLE_HELPER_PLUGIN_ID && compareVersions(targetVersion, sourceVersion) >= 0) {
            new Notice(this.t("noticeHelperAlreadyCurrent"));
            return false;
          }
          if (nodeFs.existsSync(targetDir)) {
            nodeFs.rmSync(targetDir, { recursive: true, force: true });
          }
          copyDirectory(sourceDir, targetDir);
          new Notice(this.t("noticeHelperInstalled"));
          return true;
        } catch (error) {
          new Notice(this.t("noticeHelperInstallFailed", { message: error && error.message ? error.message : error }));
          console.warn("Failed to install Eagle helper plugin:", error);
          return false;
        }
      }
    
      getLanguage() {
        const configured = String(this.settings.language || DEFAULT_SETTINGS.language || "auto").toLowerCase();
        if (configured === "zh" || configured === "en") return configured;
        const localeParts = [];
        if (this.app && this.app.vault && typeof this.app.vault.getConfig === "function") {
          localeParts.push(this.app.vault.getConfig("locale"));
        }
        if (this.app && this.app.locale) localeParts.push(this.app.locale);
        if (typeof moment !== "undefined" && moment && typeof moment.locale === "function") localeParts.push(moment.locale());
        if (typeof document !== "undefined" && document.documentElement) localeParts.push(document.documentElement.lang);
        if (typeof navigator !== "undefined" && navigator.language) localeParts.push(navigator.language);
        return /zh|cn|hans|hant/i.test(localeParts.filter(Boolean).join(" ")) ? "zh" : "en";
      }
    
      t(key, values = {}) {
        const lang = this.getLanguage();
        const text = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
        return String(text).replace(/\{(\w+)\}/g, (match, name) => {
          return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match;
        });
      }
    
      scheduleTrashStatusScan(root) {
        if (!root || !root.querySelectorAll) return;
        this.trashScanScheduler.scheduleSequence(root, [100, 600], () => {
          this.markTrashedEagleBridgeImages(root).catch(error => {
            console.warn("Failed to mark Eagle trash status:", error);
          });
        });
      }
    
      rememberCanvasRename(file, oldPath) {
        if (!(file instanceof TFile) || file.extension !== "canvas" || !oldPath) return;
        const oldName = stripExtension(nodePath.basename(oldPath)).trim();
        const newName = stripExtension(file.name).trim();
        if (!oldName || !newName || oldName === newName) return;
        const oldDate = this.getCanvasIdentityDateForPath(oldPath);
        const date = oldDate || formatIdentityDate(new Date());
        this.moveCanvasIdentityDate(oldPath, file.path, date);
        const oldIdentity = buildTitleDateIdentity(normalizeIdentityTitle(oldName), date);
        const newIdentity = buildTitleDateIdentity(normalizeIdentityTitle(newName), date);
        this.lastCanvasRename = {
          path: file.path,
          oldTags: this.buildCanvasTagCandidates(oldIdentity),
          newTags: this.buildCanvasTagCandidates(newIdentity)
        };
      }
    
      rememberNoteRename(file, oldPath) {
        if (!(file instanceof TFile) || file.extension !== "md" || !oldPath) return;
        const oldName = stripExtension(nodePath.basename(oldPath)).trim();
        const newName = stripExtension(file.name).trim();
        if (!oldName || !newName || oldName === newName) return;
        const oldDate = this.getNoteIdentityDateForPath(oldPath);
        const date = oldDate || getFileIdentityDate(file);
        this.moveNoteIdentityDate(oldPath, file.path, date);
        const oldIdentity = buildTitleDateIdentity(normalizeIdentityTitle(oldName), date);
        const newIdentity = buildTitleDateIdentity(normalizeIdentityTitle(newName), date);
        this.lastNoteRename = {
          path: file.path,
          oldIdentity,
          newIdentity,
          oldTags: this.buildTagCandidates(oldIdentity),
          newTags: this.buildTagCandidates(newIdentity)
        };
      }
    
      getNoteIdentityDateForPath(path) {
        if (!path || !this.settings.noteIdentityDates || typeof this.settings.noteIdentityDates !== "object") return "";
        const existing = this.settings.noteIdentityDates[path];
        return isIdentityDate(existing) ? existing : "";
      }
    
      moveNoteIdentityDate(oldPath, newPath, fallbackDate = "") {
        if (!oldPath || !newPath) return;
        if (!this.settings.noteIdentityDates || typeof this.settings.noteIdentityDates !== "object") {
          this.settings.noteIdentityDates = {};
        }
        const date = this.settings.noteIdentityDates[oldPath] || fallbackDate;
        if (isIdentityDate(date)) {
          this.settings.noteIdentityDates[newPath] = date;
        }
        if (oldPath !== newPath) {
          delete this.settings.noteIdentityDates[oldPath];
        }
        this.saveSettings().catch(error => {
          console.warn("Failed to save note identity date after rename:", error);
        });
      }
    
      getCanvasIdentityDateForPath(path) {
        if (!path || !this.settings.canvasIdentityDates || typeof this.settings.canvasIdentityDates !== "object") return "";
        const existing = this.settings.canvasIdentityDates[path];
        return isIdentityDate(existing) ? existing : "";
      }
    
      moveCanvasIdentityDate(oldPath, newPath, fallbackDate = "") {
        if (!oldPath || !newPath) return;
        if (!this.settings.canvasIdentityDates || typeof this.settings.canvasIdentityDates !== "object") {
          this.settings.canvasIdentityDates = {};
        }
        const date = this.settings.canvasIdentityDates[oldPath] || fallbackDate;
        if (isIdentityDate(date)) {
          this.settings.canvasIdentityDates[newPath] = date;
        }
        if (oldPath !== newPath) {
          delete this.settings.canvasIdentityDates[oldPath];
        }
        this.saveSettings().catch(error => {
          console.warn("Failed to save Canvas identity date after rename:", error);
        });
      }
    
      async markTrashedEagleBridgeImages(root) {
        this.removeAllNoteTrashBadges(root);
        const images = Array.from(root.querySelectorAll ? root.querySelectorAll("img") : []);
        const eagleImages = images.filter(image => {
          if (image.closest(".eaglebridge-note-assets-view")) return false;
          const src = String(image.getAttribute("src") || "");
          return Boolean(extractEagleBridgeItemIdFromText(src));
        });
    
        await mapWithConcurrency(eagleImages, 4, async image => {
          if (!image.isConnected) return;
          const itemId = extractEagleBridgeItemIdFromText(String(image.getAttribute("src") || ""));
          if (!itemId) return;
    
          const item = await this.queryEagleItemInfo(itemId);
          if (!image.isConnected) return;
          if (item && isEagleItemTrashed(item)) {
            image.dataset.eaglebridgeTrashChecked = `${itemId}:trash`;
            image.addClass("eaglebridge-image-in-trash");
            image.title = this.t("trashTitle");
            this.ensureTrashBadge(image);
          } else {
            image.dataset.eaglebridgeTrashChecked = `${itemId}:ok`;
            image.removeClass("eaglebridge-image-in-trash");
            image.title = image.title === this.t("trashTitle") ? "" : image.title;
            this.removeTrashBadge(image);
          }
        });
      }
    
      ensureTrashBadge(image) {
        const anchor = getTrashBadgeAnchor(image);
        removeTrashBadgesForImage(image);
        if (anchor) anchor.classList.add("eaglebridge-trash-anchor");
      }
    
      removeTrashBadge(image) {
        const anchor = getTrashBadgeAnchor(image);
        if (anchor) anchor.classList.remove("eaglebridge-trash-anchor");
        removeTrashBadgesForImage(image);
      }
    
      removeAllNoteTrashBadges(root) {
        if (!root || !root.querySelectorAll) return;
        const badges = Array.from(root.querySelectorAll(".eaglebridge-trash-badge"));
        for (const badge of badges) {
          if (!badge.closest(".eaglebridge-note-assets-view")) {
            badge.remove();
          }
        }
      }
    
      scheduleAutoSyncForModifiedFile(file, mode = "diff") {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file)) return;
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.path !== file.path) return;
    
        this.autoSyncScheduler.schedule(file.path, 500, async () => {
          await this.autoSyncEagleBridgeLinksForFile(file, mode);
        });
      }
    
      async rememberAttachmentReferenceSignature(file) {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file)) return;
        try {
          const text = await this.app.vault.cachedRead(file);
          this.attachmentReferenceSignatures.set(file.path, getAttachmentReferenceSignature(text, file.extension));
        } catch (_) {}
      }
    
      scheduleSemanticSourceModify(file) {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file)) return;
        this.semanticModifyScheduler.schedule(file.path, 180, async () => {
          let text;
          try {
            text = await this.app.vault.cachedRead(file);
          } catch (_) {
            return;
          }
          const next = getAttachmentReferenceSignature(text, file.extension);
          const previous = this.attachmentReferenceSignatures.get(file.path);
          this.attachmentReferenceSignatures.set(file.path, next);
          if (previous === next) return;
          this.invalidateLibraryReferenceSummaries();
          this.scheduleAutoSyncForModifiedFile(file);
          this.scheduleTrashStatusScan(document);
          this.scheduleReferenceViewRefresh(file);
        });
      }
    
      async autoSyncEagleBridgeLinksForFile(file, mode = "diff") {
        try {
          const context = await this.getAssetContext(file, false);
          if (!context) return;
          const text = await this.app.vault.read(file);
          const itemIds = Array.from(new Set(this.extractEagleBridgeItemIds(text)
            .map(id => stripInfoSuffix(id))
            .filter(Boolean)));
          const association = this.getManagedSourceAssetAssociation(file.path);
          const rememberedIds = this.knownEagleBridgeItemIdsByFile.get(file.path)
            || new Set(association ? association.itemIds : []);
          const currentIds = new Set(itemIds);
          const removedIds = Array.from(rememberedIds).filter(id => id && !currentIds.has(id));
    
          // A removed link must relinquish only this source's ownership.  This is
          // deliberately done before persisting the new association so a later
          // source-file delete cannot touch an already-unlinked Eagle item.
          if (removedIds.length) {
            await this.cleanupRemovedContextReferences(context, removedIds, association);
          }
          await this.rememberManagedSourceAssetAssociation(file, context, itemIds);
          if (this.settings.autoTagOnRefresh === false) {
            this.knownEagleBridgeItemIdsByFile.set(file.path, new Set(itemIds));
            return;
          }
          if (mode === "full") {
            this.knownEagleBridgeItemIdsByFile.set(file.path, new Set(itemIds));
            await this.reconcileCurrentContextEagleBridgeTags(context, text, false);
            return;
          }
          const newIds = itemIds.filter(id => id && !rememberedIds.has(id));
          this.knownEagleBridgeItemIdsByFile.set(file.path, new Set(itemIds));
          if (newIds.length) await this.syncEagleBridgeItemTags(context, newIds, false);
        } catch (error) {
          console.warn("Failed to auto-sync EagleBridge link tags:", error);
        }
      }
    
      async rememberCurrentFileEagleBridgeIds(file = null) {
        const targetFile = file || this.app.workspace.getActiveFile();
        if (!(targetFile instanceof TFile) || !isSupportedSourceFile(targetFile)) return;
        try {
          const text = await this.app.vault.read(targetFile);
          const itemIds = Array.from(new Set(this.extractEagleBridgeItemIds(text)
            .map(id => stripInfoSuffix(id))
            .filter(Boolean)));
          const context = await this.getAssetContext(targetFile, false);
          const association = this.getManagedSourceAssetAssociation(targetFile.path);
          const rememberedIds = this.knownEagleBridgeItemIdsByFile.get(targetFile.path)
            || new Set(association ? association.itemIds : []);
          const currentIds = new Set(itemIds);
          const removedIds = Array.from(rememberedIds).filter(id => id && !currentIds.has(id));
          if (context && removedIds.length) {
            await this.cleanupRemovedContextReferences(context, removedIds, association);
          }
          this.knownEagleBridgeItemIdsByFile.set(targetFile.path, new Set(itemIds));
          if (context) await this.rememberManagedSourceAssetAssociation(targetFile, context, itemIds);
        } catch (error) {
          console.warn("Failed to remember EagleBridge link ids:", error);
        }
      }
    
      getManagedSourceAssetAssociation(sourcePath) {
        const key = normalizeVaultPath(sourcePath);
        const record = this.settings.managedSourceAssetAssociations && this.settings.managedSourceAssetAssociations[key];
        if (!record || typeof record !== "object") return null;
        return {
          itemIds: Array.from(new Set((record.itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean))),
          tags: Array.from(new Set((record.tags || []).map(tag => String(tag || "").trim()).filter(Boolean)))
        };
      }
    
      async rememberManagedSourceAssetAssociation(file, context, itemIds) {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file) || !context) return false;
        const sourcePath = normalizeVaultPath(file.path);
        if (!sourcePath) return false;
        if (!this.settings.managedSourceAssetAssociations || typeof this.settings.managedSourceAssetAssociations !== "object") {
          this.settings.managedSourceAssetAssociations = {};
        }
        const previous = this.getManagedSourceAssetAssociation(sourcePath) || { itemIds: [], tags: [] };
        const next = {
          // This is the source's current direct-reference set.  Removed IDs are
          // cleaned before this record is written, so they must not be retained.
          itemIds: Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean))),
          tags: Array.from(new Set([...previous.tags, ...this.getContextTagsToClean(context)]))
        };
        if (JSON.stringify(previous) === JSON.stringify(next)) return false;
        this.settings.managedSourceAssetAssociations[sourcePath] = next;
        await this.saveSettings();
        return true;
      }
    
      async renameManagedSourceAssetAssociation(file, oldPath) {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file)) return false;
        const oldKey = normalizeVaultPath(oldPath);
        const newKey = normalizeVaultPath(file.path);
        if (!oldKey || !newKey || oldKey === newKey) return false;
        const previous = this.getManagedSourceAssetAssociation(oldKey);
        if (!previous) return false;
        const existing = this.getManagedSourceAssetAssociation(newKey) || { itemIds: [], tags: [] };
        this.settings.managedSourceAssetAssociations[newKey] = {
          itemIds: Array.from(new Set([...existing.itemIds, ...previous.itemIds])),
          tags: Array.from(new Set([...existing.tags, ...previous.tags]))
        };
        delete this.settings.managedSourceAssetAssociations[oldKey];
        await this.saveSettings();
        return true;
      }
    
      async cleanupDeletedSourceFile(file) {
        if (!(file instanceof TFile) || !isSupportedSourceFile(file)) return;
        const sourcePath = normalizeVaultPath(file.path);
        if (!sourcePath) return;
    
        const association = this.getManagedSourceAssetAssociation(sourcePath);
        const folderRecord = this.settings.managedEagleFoldersBySource && this.settings.managedEagleFoldersBySource[sourcePath];
        const rootId = String(this.settings.eagleFolderId || "").trim();
        const folderId = String(folderRecord && folderRecord.id || "").trim();
        const itemIds = association ? association.itemIds : [];
        let folderDeleted = false;
    
        try {
          if (folderId && rootId && folderId !== rootId && itemIds.length) {
            for (const itemId of itemIds) {
              try {
                await this.removeEagleItemFoldersViaHelper(itemId, [folderId]);
              } catch (error) {
                console.warn(`Failed to detach deleted source folder from Eagle item ${itemId}:`, error);
              }
            }
          }
          // Removing a deleted note's dedicated folder must not leave an asset
          // unfiled. Preserve every remaining folder; only restore the configured
          // Obsidian root when the asset now has no folder membership at all.
          if (this.settings.folderManagementEnabled !== false && rootId && itemIds.length) {
            for (const itemId of itemIds) {
              try {
                await this.restoreUnfiledEagleItemToRoot(itemId, rootId);
              } catch (error) {
                console.warn(`Failed to restore unfiled Eagle item ${itemId} to the Obsidian root:`, error);
              }
            }
          }
          if (association && association.tags.length) {
            await this.removeEagleTagsFromItemIds(itemIds, association.tags);
          }
          if (folderId && rootId && folderId !== rootId) {
            try {
              folderDeleted = await this.deleteEagleFolderIfEmptyViaHelper(folderId);
            } catch (error) {
              console.warn("Failed to remove empty Eagle folder after source deletion:", error);
            }
          }
        } finally {
          this.knownEagleBridgeItemIdsByFile.delete(file.path);
          if (this.settings.managedSourceAssetAssociations) delete this.settings.managedSourceAssetAssociations[sourcePath];
          if (this.settings.managedEagleFoldersBySource) delete this.settings.managedEagleFoldersBySource[sourcePath];
          if (folderDeleted && this.settings.managedEagleFolders) {
            for (const [path, record] of Object.entries(this.settings.managedEagleFolders)) {
              if (String(record && record.id || "") === folderId) delete this.settings.managedEagleFolders[path];
            }
          }
          if (this.settings.noteIdentityDates) delete this.settings.noteIdentityDates[sourcePath];
          if (this.settings.canvasIdentityDates) delete this.settings.canvasIdentityDates[sourcePath];
          await this.saveSettings();
        }
      }
    
      async cleanupRemovedContextReferences(context, itemIds, association = null) {
        const uniqueIds = Array.from(new Set((itemIds || [])
          .map(id => stripInfoSuffix(id))
          .filter(Boolean)));
        if (!context || !uniqueIds.length) return { detached: 0, tagsRemoved: 0 };
    
        const rootId = String(this.settings.eagleFolderId || "").trim();
        const sourcePath = context.file instanceof TFile ? normalizeVaultPath(context.file.path) : "";
        const record = sourcePath && this.settings.managedEagleFoldersBySource
          ? this.settings.managedEagleFoldersBySource[sourcePath]
          : null;
        const folderId = String(record && record.id || await this.findExistingEagleFolderIdForContext(context) || "").trim();
        let detached = 0;
    
        if (this.settings.folderManagementEnabled !== false && folderId && folderId !== rootId) {
          for (const itemId of uniqueIds) {
            try {
              const removed = await this.removeEagleItemFoldersViaHelper(itemId, [folderId]);
              if (removed) detached += 1;
            } catch (error) {
              console.warn(`Failed to detach removed reference folder from Eagle item ${itemId}:`, error);
            }
          }
        }
    
        // Preserve all other source folders.  An asset only returns to the
        // configured Obsidian root when removing this source left it unfiled.
        if (this.settings.folderManagementEnabled !== false && rootId) {
          for (const itemId of uniqueIds) {
            try {
              await this.restoreUnfiledEagleItemToRoot(itemId, rootId);
            } catch (error) {
              console.warn(`Failed to restore removed-reference Eagle item ${itemId} to the Obsidian root:`, error);
            }
          }
        }
    
        const tagsToClean = association && association.tags && association.tags.length
          ? association.tags
          : this.getContextTagsToClean(context);
        const tagsRemoved = tagsToClean.length
          ? await this.removeEagleTagsFromItemIds(uniqueIds, tagsToClean)
          : 0;
        return { detached, tagsRemoved };
      }
    
      scheduleReferenceViewRefresh(file = null, delay = 250) {
        const activeFile = this.app.workspace.getActiveFile();
        const activePath = activeFile instanceof TFile ? activeFile.path : "";
        if (file instanceof TFile && activePath !== file.path) return;
        this.referenceViewRefreshScheduler.schedule("current-reference-view", delay, async () => {
          await this.refreshReferenceViewsForCurrentNote(file);
        });
      }
    
      cancelReferenceViewRefresh() {
        this.referenceViewRefreshScheduler && this.referenceViewRefreshScheduler.cancel("current-reference-view");
        this.referenceViewRefreshQueued = false;
      }
    
      async runWithReferenceViewRefreshPaused(task, refreshFile = null) {
        this.referenceViewOperationDepth += 1;
        try {
          return await task();
        } finally {
          this.referenceViewOperationDepth = Math.max(0, this.referenceViewOperationDepth - 1);
          if (this.referenceViewOperationDepth === 0) {
            await this.refreshReferenceViewsForCurrentNote(refreshFile, { force: true });
          }
        }
      }
    
      async refreshReferenceViewsForCurrentNote(file = null, options = {}) {
        const force = options.force === true;
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (!leaves.length) return;
    
        if (file && file instanceof TFile) {
          const activeFile = this.app.workspace.getActiveFile();
          if (!activeFile || activeFile.path !== file.path) return;
        }
    
        if (!force && this.referenceViewOperationDepth > 0) {
          this.referenceViewRefreshQueued = true;
          return;
        }
    
        if (this.referenceViewRefreshing) {
          this.referenceViewRefreshQueued = true;
          return;
        }
    
        this.referenceViewRefreshing = true;
        try {
          do {
            this.referenceViewRefreshQueued = false;
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
              const view = leaf.view;
              if (view && typeof view.loadForCurrentNote === "function") {
                await view.loadForCurrentNote(false);
              }
            }
          } while (this.referenceViewRefreshQueued);
        } catch (error) {
          console.warn("Failed to auto-refresh Eagle side panel:", error);
        } finally {
          this.referenceViewRefreshing = false;
        }
      }
    
      invalidateLibraryReferenceSummaries() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          leaf.view?.invalidateLibraryReferenceSummary?.();
        }
      }
    
      migrateSettings() {
        let changed = false;
        const eagleFolderId = normalizeEagleFolderId(this.settings.eagleFolderId);
        if (eagleFolderId !== this.settings.eagleFolderId) {
          this.settings.eagleFolderId = eagleFolderId;
          changed = true;
        }
        const oldTemplates = new Set([
          "![{name}]({bridgeUrl})",
          "![{name}]({url})",
          "[{name}|200]({bridgeUrl})",
          "![{name}|200]({bridgeUrl})",
          "![{filename}|200]({bridgeUrl})",
          "![{filename}|undefined|200]({bridgeUrl})",
          "<img src=\"{bridgeUrl}\" alt=\"{name}\" width=\"200\">"
        ]);
        if (oldTemplates.has(this.settings.replacementTemplate)) {
          this.settings.replacementTemplate = DEFAULT_SETTINGS.replacementTemplate;
          changed = true;
        }
        const legacyNotePrefix = splitList(this.settings.tagPrefixes || "Obsidian-")[0] || "Obsidian-";
        const legacyCanvasPrefix = splitList(this.settings.canvasTagPrefixes || "Obsidian-cavs-")[0] || "Obsidian-cavs-";
        if (!this.settings.noteTagNameTemplate || this.settings.noteTagNameTemplate === "{{title}}-{{created}}") {
          this.settings.noteTagNameTemplate = `${legacyNotePrefix}{{title}}-{{created}}`;
          changed = true;
        }
        if (!this.settings.canvasTagNameTemplate || this.settings.canvasTagNameTemplate === "{{title}}-{{created}}") {
          this.settings.canvasTagNameTemplate = `${legacyCanvasPrefix}{{title}}-{{created}}`;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(this.settings, "tagPrefixes")) {
          delete this.settings.tagPrefixes;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(this.settings, "canvasTagPrefixes")) {
          delete this.settings.canvasTagPrefixes;
          changed = true;
        }
        if (!this.settings.managedEagleFolders || typeof this.settings.managedEagleFolders !== "object" || Array.isArray(this.settings.managedEagleFolders)) {
          this.settings.managedEagleFolders = {};
          changed = true;
        }
        if (!this.settings.managedEagleFoldersBySource || typeof this.settings.managedEagleFoldersBySource !== "object" || Array.isArray(this.settings.managedEagleFoldersBySource)) {
          this.settings.managedEagleFoldersBySource = {};
          changed = true;
        }
        if (!this.settings.managedSourceAssetAssociations || typeof this.settings.managedSourceAssetAssociations !== "object" || Array.isArray(this.settings.managedSourceAssetAssociations)) {
          this.settings.managedSourceAssetAssociations = {};
          changed = true;
        }
        if (!this.settings.noteIdentityDates || typeof this.settings.noteIdentityDates !== "object" || Array.isArray(this.settings.noteIdentityDates)) {
          this.settings.noteIdentityDates = {};
          changed = true;
        }
        if (!this.settings.canvasIdentityDates || typeof this.settings.canvasIdentityDates !== "object" || Array.isArray(this.settings.canvasIdentityDates)) {
          this.settings.canvasIdentityDates = {};
          changed = true;
        }
        if (!Array.isArray(this.settings.eagleBridgeLibraryPaths)) {
          this.settings.eagleBridgeLibraryPaths = splitList(this.settings.eagleBridgeLibraryPaths || "");
          changed = true;
        }
        if (this.settings.assetViewMode === "compact") {
          this.settings.assetViewMode = "normal";
          changed = true;
        }
        if (typeof this.settings.assetCardSize !== "number" || !Number.isFinite(this.settings.assetCardSize)) {
          this.settings.assetCardSize = DEFAULT_SETTINGS.assetCardSize;
          changed = true;
        }
        if (typeof this.settings.assetListRowHeight !== "number" || !Number.isFinite(this.settings.assetListRowHeight)) {
          this.settings.assetListRowHeight = DEFAULT_SETTINGS.assetListRowHeight;
          changed = true;
        }
        if (typeof this.settings.tagManagementEnabled !== "boolean") {
          this.settings.tagManagementEnabled = DEFAULT_SETTINGS.tagManagementEnabled;
          changed = true;
        }
        if (typeof this.settings.folderManagementEnabled !== "boolean") {
          this.settings.folderManagementEnabled = DEFAULT_SETTINGS.folderManagementEnabled;
          changed = true;
        }
        if (typeof this.settings.autoTagOnRefresh !== "boolean") {
          this.settings.autoTagOnRefresh = DEFAULT_SETTINGS.autoTagOnRefresh;
          changed = true;
        }
        if (typeof this.settings.autoFolderOnImport !== "boolean") {
          this.settings.autoFolderOnImport = DEFAULT_SETTINGS.autoFolderOnImport;
          changed = true;
        }
        if (typeof this.settings.autoImportAttachments !== "boolean") {
          this.settings.autoImportAttachments = DEFAULT_SETTINGS.autoImportAttachments;
          changed = true;
        }
        if (typeof this.settings.importExternalLocalAttachments !== "boolean") {
          this.settings.importExternalLocalAttachments = DEFAULT_SETTINGS.importExternalLocalAttachments;
          changed = true;
        }
        if (typeof this.settings.useObsidianFolderTree !== "boolean") {
          this.settings.useObsidianFolderTree = DEFAULT_SETTINGS.useObsidianFolderTree;
          changed = true;
        }
        if (!this.settings.eagleHelperPluginsDir) {
          this.settings.eagleHelperPluginsDir = DEFAULT_SETTINGS.eagleHelperPluginsDir;
          changed = true;
        }
        if (changed) {
          this.saveSettings();
        }
      }
    
      async openReferenceView() {
        const file = this.app.workspace.getActiveFile();
        if (file && !isSupportedSourceFile(file)) {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
        const context = file ? await this.getAssetContext(file, true) : null;
    
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (file && leaf && leaf.view && leaf.view.currentFilePath === file.path) {
          this.app.workspace.detachLeavesOfType(VIEW_TYPE);
          return;
        }
    
        if (!leaf) {
          leaf = this.app.workspace.getRightLeaf(false);
          await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
    
        this.app.workspace.revealLeaf(leaf);
        if (context) {
          await this.rememberCurrentFileEagleBridgeIds(file);
          await leaf.view.loadForContext(context);
        } else {
          await leaf.view.loadObsidianLibrary();
        }
      }
    
      async getCurrentNoteContext(showNotice = true) {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isSupportedSourceFile(file)) {
          if (showNotice) new Notice(this.t("noticeOpenNoteOrCanvas"));
          return null;
        }
        return this.getAssetContext(file, showNotice);
      }
    
      async getAssetContext(file, showNotice) {
        if (!file) return null;
        if (file.extension === "canvas") {
          return this.getCanvasContext(file);
        }
        return this.getNoteContext(file, showNotice);
      }
    
      async getCanvasContext(file) {
        const identity = await this.getCanvasIdentity(file);
        return {
          file,
          field: "canvas",
          identity,
          tags: this.buildCanvasTagCandidates(identity),
          kind: "canvas"
        };
      }
    
      async getCanvasIdentity(file) {
        const name = normalizeIdentityTitle(stripExtension(file.name).trim());
        const date = await this.getCanvasIdentityDate(file);
        return buildTitleDateIdentity(name, date);
      }
    
      async getCanvasIdentityDate(file) {
        if (!this.settings.canvasIdentityDates || typeof this.settings.canvasIdentityDates !== "object") {
          this.settings.canvasIdentityDates = {};
        }
        const existing = this.settings.canvasIdentityDates[file.path];
        const date = getStableIdentityDate(file, existing);
        if (this.settings.canvasIdentityDates[file.path] !== date) {
          this.settings.canvasIdentityDates[file.path] = date;
          await this.saveSettings();
        }
        return date;
      }
    
      async getNoteContext(file, showNotice) {
        const identity = await this.getNoteIdentity(file);
        return {
          file,
          field: "note",
          identity,
          tags: this.buildNoteTags(identity, file),
          kind: "markdown"
        };
      }
    
      async getNoteIdentity(file) {
        const name = normalizeIdentityTitle(file && file.basename ? file.basename : "note");
        const date = await this.getNoteIdentityDate(file);
        return buildTitleDateIdentity(name, date);
      }
    
      async getNoteIdentityDate(file) {
        if (!this.settings.noteIdentityDates || typeof this.settings.noteIdentityDates !== "object") {
          this.settings.noteIdentityDates = {};
        }
        const existing = this.settings.noteIdentityDates[file.path];
        const date = getStableIdentityDate(file, existing);
        if (this.settings.noteIdentityDates[file.path] !== date) {
          this.settings.noteIdentityDates[file.path] = date;
          await this.saveSettings();
        }
        return date;
      }
    
      buildTagCandidates(identity) {
        if (this.settings.tagManagementEnabled === false) return [];
        return [this.renderTagName(identity, this.settings.noteTagNameTemplate)].filter(Boolean);
      }
    
      buildNoteTags(identity, file) {
        return this.buildTagCandidates(identity);
      }
    
      buildCanvasTagCandidates(name) {
        if (this.settings.tagManagementEnabled === false) return [];
        return [this.renderTagName(name, this.settings.canvasTagNameTemplate)].filter(Boolean);
      }
    
      getManagedTagPrefixes() {
        const templates = [
          this.settings.noteTagNameTemplate || DEFAULT_SETTINGS.noteTagNameTemplate,
          this.settings.canvasTagNameTemplate || DEFAULT_SETTINGS.canvasTagNameTemplate
        ];
        const prefixes = templates
          .map(template => String(template || "").split("{{")[0].trim())
          .filter(Boolean);
        return Array.from(new Set(["Obsidian-", "Obsidian-cavs-", ...prefixes]));
      }
    
      renderTagName(identity, template) {
        const rawIdentity = String(identity || "").trim();
        const match = rawIdentity.match(/^(.*)-(\d{8})$/);
        const cleanTitle = normalizeIdentityTitle(match ? match[1] : rawIdentity) || "note";
        const cleanDate = match && isIdentityDate(match[2]) ? match[2] : formatIdentityDate(new Date());
        const sourceTemplate = String(template || "{{title}}-{{created}}").trim() || "{{title}}-{{created}}";
        const rendered = sourceTemplate
          .replace(/\{\{\s*title\s*\}\}/gi, cleanTitle)
          .replace(/\{\{\s*created\s*\}\}/gi, cleanDate)
          .replace(/\{\{[^{}]*\}\}/g, "");
        return normalizeIdentityTitle(rendered) || buildTitleDateIdentity(cleanTitle, cleanDate);
      }
    
      async queryEagleItemsByTags(tags) {
        const seen = new Set();
        const allItems = [];
        for (const tag of tags) {
          const items = await this.queryEagleItemsByTag(tag);
          for (const item of items) {
            const key = item.id || item.fileURL || item.name || JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            allItems.push(item);
          }
        }
        return allItems;
      }
    
      async queryEagleItemsForNoteContext(context) {
        const items = [];
        const seen = new Set();
        const text = await this.app.vault.read(context.file);
        const itemRefs = this.extractEagleBridgeItemReferences(text);
        const uniqueRefs = [];
        for (const itemRef of itemRefs) {
          const itemId = itemRef.id;
          if (seen.has(itemId)) continue;
          seen.add(itemId);
          uniqueRefs.push(itemRef);
        }
    
        const eagleItems = await mapWithConcurrency(uniqueRefs, 6, async itemRef => {
          const itemId = itemRef.id;
          const item = await this.queryEagleItemInfo(itemId);
          return Object.assign({}, item || {
            id: itemId,
            name: itemRef.label || itemId,
            __extension: nodePath.extname(itemRef.label || "").toLowerCase(),
            __assetSource: "missing",
            __missingAttachment: true,
            __missingReason: "eagle"
          }, {
            __fromNoteLink: true,
            __noteLinkName: itemRef.label,
            __sourceStart: itemRef.start,
            __sourceEnd: itemRef.end
          });
        });
        items.push(...eagleItems);
    
        if (context.kind === "canvas") {
          items.push(...this.findCanvasNoteLinks(text, context.file));
        }
    
        const combined = items.concat(await this.queryNoteAttachmentItemsForFile(context.file, text));
        if (context.kind !== "markdown") return combined;
        return combined
          .map((item, index) => ({ item, index }))
          .sort((left, right) => {
            const leftStart = Number.isFinite(Number(left.item.__sourceStart)) ? Number(left.item.__sourceStart) : Number.MAX_SAFE_INTEGER;
            const rightStart = Number.isFinite(Number(right.item.__sourceStart)) ? Number(right.item.__sourceStart) : Number.MAX_SAFE_INTEGER;
            return leftStart - rightStart || left.index - right.index;
          })
          .map(entry => entry.item);
      }
    
      async getCurrentContextEagleItems(context, existingText = null) {
        if (!context || !(context.file instanceof TFile)) return [];
        const text = existingText !== null ? existingText : await this.app.vault.read(context.file);
        const seen = new Set();
        const items = [];
        const addItem = async item => {
          const itemId = getEagleItemId(item);
          if (!itemId || seen.has(itemId)) return;
          const detailed = await this.queryEagleItemInfo(itemId) || item;
          if (!detailed) return;
          seen.add(itemId);
          items.push(detailed);
        };
    
        const directIds = Array.from(new Set(this.extractEagleBridgeItemIds(text)
          .map(id => stripInfoSuffix(id))
          .filter(Boolean)));
        const directItems = await mapWithConcurrency(directIds, 6, async itemId => {
          return this.queryEagleItemInfo(itemId);
        });
        for (const item of directItems) {
          if (!item || !item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
    
        if (context.tags && context.tags.length) {
          const taggedItems = await this.queryEagleItemsByTags(context.tags);
          for (const item of taggedItems) {
            await addItem(item);
          }
        }
    
        return items;
      }
    
      getImportContextTags(context) {
        if (this.settings.tagManagementEnabled === false) return [];
        return Array.isArray(context && context.tags) ? context.tags : [];
      }
    
      async organizeCurrentContextEagleItemsIntoFolder(context, existingText = null, options = {}) {
        if (this.settings.folderManagementEnabled === false) return 0;
        if (!context || !(context.file instanceof TFile)) return 0;
    
        const text = existingText !== null ? existingText : await this.app.vault.read(context.file);
        // A plain note or Canvas must not create a dedicated Eagle folder merely
        // because its reference view refreshes. Only direct EagleBridge links are
        // eligible for dedicated-folder management.
        const directRefIds = new Set(this.extractEagleBridgeItemIds(text)
          .map(id => stripInfoSuffix(id))
          .filter(Boolean));
        if (!directRefIds.size) return 0;
    
        const items = await this.getCurrentContextEagleItems(context, text);
        const directItems = items.filter(item => directRefIds.has(stripInfoSuffix(getEagleItemId(item))));
        if (!directItems.length) return 0;
    
        const folderId = await this.resolveEagleFolderIdForContext(context, {
          createMissing: options.createMissing !== false
        });
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (!folderId || folderId === rootId) return 0;
    
        let changed = 0;
        const replacementIds = new Map();
    
        for (const item of directItems) {
          const itemId = getEagleItemId(item);
          if (!itemId || itemHasEagleFolder(item, folderId)) continue;
          const ok = await this.updateEagleItemFolder(itemId, folderId);
          if (ok) {
            changed += 1;
            continue;
          }
          if (directRefIds.has(itemId)) {
            console.warn("Eagle helper could not add existing item to folder; skipped reimport to avoid duplicate import:", itemId, folderId);
          }
        }
    
        if (replacementIds.size) {
          const latestText = await this.app.vault.read(context.file);
          const nextText = replaceEagleBridgeIdsInText(latestText, replacementIds);
          if (nextText !== latestText) {
            await this.app.vault.modify(context.file, nextText);
            await this.rememberCurrentFileEagleBridgeIds(context.file);
          }
        }
    
        return changed;
      }
    
      async getOriginalPathForEagleItem(item) {
        const directPaths = [
          item && item.fileURL,
          item && item.path,
          item && item.filePath,
          item && item.localPath
        ].map(value => fileUrlToLocalPath(value) || eagleLocalPathToFsPath(value)).filter(Boolean);
        for (const candidate of directPaths) {
          if (nodeFs.existsSync(candidate) && nodeFs.statSync(candidate).isFile()) return candidate;
        }
    
        const thumbnailUrl = await this.getEagleItemThumbnailUrl(item);
        const thumbnailPath = fileUrlToLocalPath(thumbnailUrl) || eagleLocalPathToFsPath(thumbnailUrl);
        if (!thumbnailPath) return "";
        const infoDir = nodePath.dirname(thumbnailPath);
        return findOriginalFileInEagleInfoDir(infoDir, item);
      }
    
      async queryNoteAttachmentItemsForFile(file, existingText = null) {
        const text = existingText !== null ? existingText : await this.app.vault.read(file);
        const localLinks = file.extension === "canvas"
          ? this.findCanvasAttachmentLinks(text, file)
          : this.findLocalAttachmentLinks(text, file, true);
        const items = [];
        const seen = new Set();
        for (const link of localLinks) {
          if (link.__missingAttachment) {
            const key = `missing:${link.target}:${link.start}:${link.end}`;
            if (seen.has(key)) continue;
            items.push({
              id: key,
              name: nodePath.basename(link.target || "") || link.target || "missing attachment",
              __extension: nodePath.extname(link.target || "").toLowerCase(),
              __assetSource: "missing",
              __missingAttachment: true,
              __missingReason: "local",
              __sourceStart: link.start,
              __sourceEnd: link.end
            });
            seen.add(key);
            continue;
          }
          const key = `local:${link.file.path}`;
          if (seen.has(key)) continue;
          const fullPath = this.getFullPath(link.file);
          items.push({
            id: key,
            name: link.file.name,
            fileURL: fullPath ? normalizeFileUrl(fullPath) : "",
            resourceURL: this.getResourcePath(link.file),
            __extension: nodePath.extname(link.file.name).toLowerCase(),
            __assetSource: "local",
            __localFile: link.file,
            __localTarget: link.target,
            __localOriginal: link.original,
            __canvasNodeId: link.canvasNodeId || "",
            __sourceStart: link.start,
            __sourceEnd: link.end
          });
          seen.add(key);
        }
        const externalLocalLinks = file.extension === "canvas"
          ? this.findCanvasExternalLocalAttachmentLinks(text)
          : this.findExternalLocalAttachmentLinks(text);
        for (const link of externalLocalLinks) {
          const key = `external-local:${link.localPath}`;
          if (seen.has(key)) continue;
          items.push({
            id: key,
            name: link.name,
            fileURL: normalizeFileUrl(link.localPath),
            resourceURL: normalizeFileUrl(link.localPath),
            __extension: nodePath.extname(link.localPath).toLowerCase(),
            __assetSource: "external-local",
            __externalLocalPath: link.localPath,
            __externalLocalLink: link,
            __canvasNodeId: link.canvasNodeId || "",
            __sourceStart: link.start,
            __sourceEnd: link.end
          });
          seen.add(key);
        }
        const internetLinks = file.extension === "canvas"
          ? this.findCanvasInternetAttachmentLinks(text, file)
          : this.findInternetAttachmentLinks(text);
        if (file.extension === "md" || file.extension === "canvas") {
          for (const link of internetLinks) {
            const parsed = parseAttachmentReference({ label: link.name, target: link.url, start: link.start, end: link.end });
            const key = `internet:${parsed.target}`;
            if (seen.has(key)) continue;
            items.push({
              id: key,
              name: parsed.displayName || link.name,
              fileURL: parsed.target,
              resourceURL: parsed.target,
              url: parsed.target,
              __extension: parsed.extension,
              __assetSource: "internet",
              __isImage: internetLinks.some(candidate => candidate.url === link.url && candidate.__isImage),
              __internetLink: link,
              __canvasNodeId: link.canvasNodeId || "",
              __sourceStart: link.start,
              __sourceEnd: link.end
            });
            seen.add(key);
          }
        }
        return items;
      }
    
      async queryEagleItemsByTag(tag) {
        const body = await this.requestEagleApiJson({
          url: this.getEagleApiUrl(`api/item/list?tags=${encodeURIComponent(tag)}`),
          method: "GET"
        });
        return Array.isArray(body && body.data) ? body.data : [];
      }
    
      async queryEagleItemsByKeyword(keyword) {
        const value = String(keyword || "").trim();
        if (!value) return [];
        try {
          const body = await this.requestEagleApiJson({
            url: this.getEagleApiUrl(`api/item/list?keyword=${encodeURIComponent(value)}`),
            method: "GET"
          });
          return Array.isArray(body && body.data) ? body.data : [];
        } catch (error) {
          console.warn("Failed to query Eagle items by keyword:", error);
          return [];
        }
      }
    
      async queryEagleItemsByKeywords(keywords) {
        const seen = new Set();
        const items = [];
        for (const keyword of Array.from(new Set((keywords || []).map(value => String(value || "").trim()).filter(Boolean)))) {
          const matches = await this.queryEagleItemsByKeyword(keyword);
          for (const item of matches) {
            const key = getEagleItemId(item) || item.fileURL || item.url || item.name || JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(item);
          }
        }
        return items;
      }
    
      resolveAssetSourceRange(file, text, item) {
        if (!file || !item) return null;
        const source = String(text || "");
        const cachedStart = Number(item.__sourceStart);
        const cachedEnd = Number.isFinite(Number(item.__sourceEnd)) ? Number(item.__sourceEnd) : cachedStart;
        const cachedRange = Number.isFinite(cachedStart) && cachedStart >= 0 && cachedEnd >= cachedStart && cachedEnd <= source.length
          ? { start: cachedStart, end: cachedEnd }
          : null;
        const chooseRange = candidates => {
          if (!candidates.length) return null;
          const exact = candidates.find(candidate => (
            cachedRange && candidate.start === cachedRange.start && candidate.end === cachedRange.end
          ));
          // Never guess between repeated references: the Eagle ID identifies an item,
          // while the saved source range identifies this occurrence of that item.
          return exact || (candidates.length === 1 ? candidates[0] : null);
        };
    
        const eagleItemId = stripInfoSuffix(getEagleItemId(item));
        if (eagleItemId) {
          const reference = chooseRange(this.extractEagleBridgeItemReferences(source)
            .filter(candidate => stripInfoSuffix(candidate.id) === eagleItemId));
          if (reference) return reference;
        }
    
        if (item.__assetSource === "local") {
          const localPath = item.__localFile && item.__localFile.path;
          const localTarget = item.__localTarget;
          const reference = chooseRange(this.findLocalAttachmentLinks(source, file, true)
            .filter(candidate => (
              (localPath && candidate.file && candidate.file.path === localPath) ||
              (localTarget && candidate.target === localTarget)
            )));
          if (reference) return reference;
        }
    
        if (item.__assetSource === "external-local") {
          const localPath = String(item.__externalLocalPath || "");
          const reference = chooseRange(this.findExternalLocalAttachmentLinks(source)
            .filter(candidate => candidate.localPath === localPath));
          if (reference) return reference;
        }
    
        if (item.__assetSource === "internet") {
          const url = String(item.url || item.fileURL || "");
          const reference = chooseRange(this.findInternetAttachmentLinks(source)
            .filter(candidate => candidate.url === url));
          if (reference) return reference;
        }
    
        if (cachedRange) {
          const cachedText = source.slice(cachedRange.start, cachedRange.end);
          const stableValue = eagleItemId || item.__localTarget || item.url || item.name;
          if (stableValue && cachedText.includes(String(stableValue))) return cachedRange;
        }
        return null;
      }
    
      async waitForEditorLayout() {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
        await new Promise(resolve => window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        }));
      }
    
      isMarkdownLeafForFile(leaf, filePath = "") {
        const view = leaf && leaf.view;
        const file = view && view.file;
        return file instanceof TFile
          && file.extension === "md"
          && (!filePath || file.path === filePath);
      }
    
      rememberActiveMarkdownLeaf(leaf = this.app.workspace.activeLeaf) {
        if (this.isMarkdownLeafForFile(leaf)) this.lastActiveMarkdownLeaf = leaf;
      }
    
      isWorkspaceLeafVisible(leaf) {
        const element = leaf && (leaf.containerEl || (leaf.view && leaf.view.containerEl));
        if (!element || !element.isConnected || typeof element.getBoundingClientRect !== "function") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
    
      findPreferredMarkdownLeaf(filePath, preferredLeaf = null) {
        const workspace = this.app && this.app.workspace;
        const matchingLeaves = workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown").filter(leaf => this.isMarkdownLeafForFile(leaf, filePath))
          : [];
        const rememberedLeaves = [
          preferredLeaf,
          this.lastActiveMarkdownLeaf,
          workspace && workspace.activeLeaf
        ].filter((leaf, index, leaves) => (
          this.isMarkdownLeafForFile(leaf, filePath)
          && leaves.indexOf(leaf) === index
        ));
    
        // Sidebar clicks make the sidebar leaf active. Keep navigation tied to the
        // visible Markdown leaf that supplied the sidebar context instead of an
        // arbitrary duplicate/hidden tab whose saved scroll position may win later.
        return rememberedLeaves.find(leaf => this.isWorkspaceLeafVisible(leaf))
          || matchingLeaves.find(leaf => this.isWorkspaceLeafVisible(leaf))
          || rememberedLeaves[0]
          || matchingLeaves[0]
          || null;
      }
    
      getRenderedAssetCandidates(view, item) {
        const root = view && view.containerEl;
        if (!root || typeof root.querySelectorAll !== "function") return [];
        const source = String(item.__assetSource || "");
        const itemId = source === "eagle" || source === "trash" || item.__fromNoteLink
          ? stripInfoSuffix(getEagleItemId(item))
          : "";
        const internetUrl = source === "internet" ? safeDecode(String(item.url || item.fileURL || "")) : "";
        const localPath = item.__localFile instanceof TFile
          ? item.__localFile.path
          : String(item.__externalLocalPath || item.__localTarget || "");
        const normalizedLocalPath = safeDecode(localPath).replace(/\\/g, "/").toLowerCase();
        const localName = normalizedLocalPath.split("/").pop() || "";
        const displayName = safeDecode(getAssetDisplayName(item)).toLowerCase();
    
        const candidates = Array.from(root.querySelectorAll(".markdown-source-view img, .markdown-preview-view img"))
          .map(element => {
            const values = [
              element.currentSrc,
              element.getAttribute("src"),
              element.getAttribute("data-src"),
              element.getAttribute("alt"),
              element.getAttribute("title")
            ].map(value => safeDecode(String(value || "")).replace(/\\/g, "/").toLowerCase());
            const haystack = values.join("\n");
            let score = 0;
            if (itemId && haystack.includes(itemId.toLowerCase())) score += 120;
            if (internetUrl && values.some(value => value === internetUrl.toLowerCase() || value.includes(internetUrl.toLowerCase()))) score += 120;
            if (normalizedLocalPath && haystack.includes(normalizedLocalPath)) score += 110;
            if (localName && haystack.includes(localName)) score += 70;
            if (displayName && haystack.includes(displayName)) score += 45;
            return { element, score, exactId: !!(itemId && haystack.includes(itemId.toLowerCase())) };
          })
          .filter(candidate => candidate.score >= 45)
          .sort((left, right) => right.score - left.score);
        return itemId ? candidates.filter(candidate => candidate.exactId) : candidates;
      }
    
      chooseNearestRenderedAsset(candidates) {
        if (!candidates.length) return null;
        const viewportCenter = typeof window !== "undefined" ? window.innerHeight / 2 : 0;
        return candidates.reduce((best, candidate) => {
          const rect = candidate.element.getBoundingClientRect();
          const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
          return !best || candidate.score > best.score || (candidate.score === best.score && distance < best.distance)
            ? { ...candidate, distance }
            : best;
        }, null).element;
      }
    
      async waitForRenderedAssetToSettle(element, generation, timeout = 2200) {
        if (!element || typeof window === "undefined") return false;
        const started = Date.now();
        let previous = "";
        let stableFrames = 0;
        while (Date.now() - started < timeout) {
          await new Promise(resolve => window.requestAnimationFrame(resolve));
          if (generation !== this.sourceRevealGeneration || !element.isConnected) return false;
          const rect = element.getBoundingClientRect();
          const current = `${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
          stableFrames = current === previous ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 3) return true;
        }
        return false;
      }
    
      async waitForRenderedAsset(view, item, generation, timeout = 1600) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (generation !== this.sourceRevealGeneration) return null;
          const renderedAsset = this.chooseNearestRenderedAsset(this.getRenderedAssetCandidates(view, item));
          if (renderedAsset) return renderedAsset;
          await new Promise(resolve => window.requestAnimationFrame(resolve));
        }
        return null;
      }
    
      flashRenderedAsset(element, generation) {
        if (!element || generation !== this.sourceRevealGeneration) return false;
        element.classList.remove("eaglebridge-source-target-highlight");
        void element.offsetWidth;
        element.classList.add("eaglebridge-source-target-highlight");
        window.setTimeout(() => element.classList.remove("eaglebridge-source-target-highlight"), 1200);
        return true;
      }
    
      async scrollRenderedAssetIntoView(element, generation) {
        if (!element || typeof element.scrollIntoView !== "function") return false;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        if (!await this.waitForRenderedAssetToSettle(element, generation)) return false;
        return this.flashRenderedAsset(element, generation);
      }
    
      async revealAssetInSource(filePath, item, preferredLeaf = null) {
        if (!filePath || !item) return;
        const generation = ++this.sourceRevealGeneration;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        if (file.extension === "canvas") {
          await this.revealAssetInCanvas(file, item, preferredLeaf);
          return;
        }
        if (file.extension !== "md") return;
    
        const text = await this.app.vault.read(file);
        const sourceRange = this.resolveAssetSourceRange(file, text, item);
        if (!sourceRange) {
          console.warn("Could not resolve the current source range for EagleBridge asset navigation:", item);
          return;
        }
        const from = indexToLineCh(text, sourceRange.start);
        const to = indexToLineCh(text, sourceRange.end);
        let targetLeaf = this.findPreferredMarkdownLeaf(file.path, preferredLeaf);
    
        let openedFileInLeaf = false;
        if (!targetLeaf) {
          targetLeaf = this.app.workspace.getLeaf("tab");
          if (targetLeaf) {
            await targetLeaf.openFile(file);
            openedFileInLeaf = true;
          }
        }
    
        if (!targetLeaf) return;
    
        this.lastActiveMarkdownLeaf = targetLeaf;
        if (openedFileInLeaf || !this.isWorkspaceLeafVisible(targetLeaf)) {
          this.app.workspace.setActiveLeaf(targetLeaf, { focus: false });
          await this.waitForEditorLayout();
        }
        const view = targetLeaf && targetLeaf.view;
        const editor = view && view.editor;
        if (!editor) return;
        await this.waitForEditorLayout();
        if (generation !== this.sourceRevealGeneration) return;
        const visibleAsset = this.chooseNearestRenderedAsset(this.getRenderedAssetCandidates(view, item));
        if (visibleAsset && await this.scrollRenderedAssetIntoView(visibleAsset, generation)) return;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          this.smoothScrollEditorToRange(editor, view, { from, to });
          const renderedAsset = await this.waitForRenderedAsset(view, item, generation, attempt === 0 ? 1600 : 3600);
          if (renderedAsset && await this.scrollRenderedAssetIntoView(renderedAsset, generation)) return;
        }
      }
    
      async revealAssetInCanvas(file, item, preferredLeaf = null) {
        const generation = ++this.sourceRevealGeneration;
        const text = await this.app.vault.read(file);
        const localPath = item.__localFile && item.__localFile.path;
        const internetUrl = String(item.url || item.fileURL || "");
        const eagleItemId = stripInfoSuffix(getEagleItemId(item));
        let nodeId = String(item.__canvasNodeId || "");
        if (!nodeId) {
          try {
            const canvas = JSON.parse(text);
            const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
            const node = nodes.find(candidate => candidate && (
              (localPath && candidate.file === item.__localTarget)
              || (internetUrl && cleanExternalAttachmentUrl(candidate.url || "") === internetUrl)
              || (eagleItemId && String(candidate.file || candidate.url || "").includes(eagleItemId))
            ));
            nodeId = node ? String(node.id || "") : "";
          } catch (error) {
            console.warn("Failed to resolve Canvas node for EagleBridge asset navigation:", error);
          }
        }
        if (!nodeId) return;
        const leaves = this.app.workspace.getLeavesOfType("canvas");
        const leaf = preferredLeaf && preferredLeaf.view && preferredLeaf.view.file === file
          ? preferredLeaf
          : leaves.find(candidate => candidate.view && candidate.view.file && candidate.view.file.path === file.path);
        const root = leaf && leaf.view && leaf.view.containerEl;
        const element = root && Array.from(root.querySelectorAll("[data-node-id]"))
          .find(candidate => candidate.getAttribute("data-node-id") === nodeId);
        const canvas = leaf && leaf.view && leaf.view.canvas;
        const canvasNode = canvas && canvas.nodes && typeof canvas.nodes.get === "function"
          ? canvas.nodes.get(nodeId)
          : null;
        try {
          if (canvasNode && typeof canvas.selectOnly === "function") canvas.selectOnly(canvasNode);
          else if (canvasNode && typeof canvasNode.select === "function") canvasNode.select();
          if (canvas && typeof canvas.zoomToSelection === "function") canvas.zoomToSelection();
        } catch (error) {
          console.warn("Failed to select Canvas node:", error);
        }
        if (element && await this.waitForRenderedAssetToSettle(element, generation, 1200)) {
          this.flashRenderedAsset(element, generation);
        }
      }
    
      smoothScrollEditorToRange(editor, view, range) {
        if (!editor || typeof editor.scrollIntoView !== "function") return;
        const scroller = view && view.containerEl && view.containerEl.querySelector
          ? view.containerEl.querySelector(".cm-scroller")
          : null;
        if (!scroller) {
          editor.scrollIntoView(range, true);
          return;
        }
    
        const previousBehavior = scroller.style.scrollBehavior;
        scroller.style.scrollBehavior = "smooth";
        editor.scrollIntoView(range, true);
        window.setTimeout(() => {
          if (scroller.isConnected) scroller.style.scrollBehavior = previousBehavior;
        }, 460);
      }
    
      getTransferFiles(dataTransfer) {
        if (!dataTransfer) return [];
        const candidates = [
          ...Array.from(dataTransfer.files || []),
          ...Array.from(dataTransfer.items || [])
            .filter(item => item && item.kind === "file" && typeof item.getAsFile === "function")
            .map(item => item.getAsFile())
            .filter(Boolean)
        ];
        const seen = new Set();
        return candidates.filter(file => {
          const key = [file.name, file.size, file.type, file.lastModified].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    
      getNativeTransferFilePath(file) {
        try {
          const electron = require("electron");
          const resolved = electron && electron.webUtils && typeof electron.webUtils.getPathForFile === "function"
            ? electron.webUtils.getPathForFile(file)
            : "";
          if (resolved) return resolved;
        } catch (_) {
          // Older Obsidian/Electron builds may not expose webUtils.
        }
        return file && typeof file.path === "string" ? file.path : "";
      }
    
      async materializeTransferFile(file) {
        const nativePath = this.getNativeTransferFilePath(file);
        if (nativePath) return { path: nativePath, temporary: false };
        if (!file || typeof file.arrayBuffer !== "function") return null;
    
        const tempDir = nodePath.join(nodeOs.tmpdir(), "eaglebridge-companion-drops");
        nodeFs.mkdirSync(tempDir, { recursive: true });
        const safeName = String(file.name || "drop.bin").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
        const targetPath = nodePath.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
        nodeFs.writeFileSync(targetPath, Buffer.from(await file.arrayBuffer()));
        return { path: targetPath, temporary: true };
      }
    
      scheduleTemporaryDropCleanup(filePath) {
        window.setTimeout(() => {
          try {
            if (filePath && nodeFs.existsSync(filePath)) nodeFs.unlinkSync(filePath);
          } catch (_) {
            // The temporary file is best-effort cleanup only.
          }
        }, 30_000);
      }
    
      extractEagleItemIdFromDroppedPath(filePath) {
        const normalized = String(filePath || "").replace(/\\/g, "/");
        const match = normalized.match(/\/([^/]+)\.info(?:\/|$)/i);
        return match ? stripInfoSuffix(match[1]) : "";
      }
    
      getActiveMarkdownDropTarget(editor) {
        const leaf = this.app.workspace.activeLeaf;
        const view = leaf && leaf.view;
        const file = view && view.file;
        if (!(file instanceof TFile) || file.extension !== "md" || !view || !view.editor) return null;
        if (editor && view.editor !== editor) return null;
        return { view, editor: view.editor, file };
      }
    
      syncEditorCursorToDrop(editor, event) {
        const cm = editor && editor.cm;
        if (!cm || typeof cm.posAtCoords !== "function" || typeof editor.offsetToPos !== "function") return false;
        const offset = cm.posAtCoords({ x: event.clientX, y: event.clientY });
        if (typeof offset !== "number") return false;
        const position = editor.offsetToPos(offset);
        editor.setSelection(position, position);
        return true;
      }
    
      isEditorFileDrop(event) {
        const target = event && event.target;
        return Boolean(target && typeof target.closest === "function" && target.closest(".cm-editor"));
      }
    
      handleEditorDragOver(event) {
        if (this.settings.autoImportAttachments === false) return;
        if (!this.isEditorFileDrop(event)) return;
        const files = this.getTransferFiles(event.dataTransfer);
        if (!files.length || !files.every(file => isSupportedAttachment(file.name))) return;
        const target = this.getActiveMarkdownDropTarget();
        if (target) this.syncEditorCursorToDrop(target.editor, event);
      }
    
      async ensureContextEagleFolder(context, item) {
        if (!item || this.settings.folderManagementEnabled === false) return item;
        const itemId = getEagleItemId(item);
        if (!itemId) return item;
        const folderId = await this.resolveEagleFolderIdForContext(context, {
          createMissing: this.settings.autoFolderOnImport !== false
        });
        if (!folderId || itemHasEagleFolder(item, folderId)) return item;
        const updated = await this.updateEagleItemFolder(itemId, folderId);
        if (!updated) return item;
        return await this.queryEagleItemInfo(itemId, { force: true }) || item;
      }
    
      async ensureDroppedItemFolder(context, item) {
        return this.ensureContextEagleFolder(context, item);
      }
    
      async buildDroppedEagleReference(context, transferFile) {
        const materialized = await this.materializeTransferFile(transferFile);
        if (!materialized || !materialized.path) throw new Error(`无法读取拖入的文件：${transferFile.name || "未知文件"}`);
    
        try {
          const tags = this.getImportContextTags(context);
          const existingItemId = this.extractEagleItemIdFromDroppedPath(materialized.path);
          let item = existingItemId ? await this.queryEagleItemInfo(existingItemId, { force: true }) : null;
          const sourceName = String(transferFile.name || nodePath.basename(materialized.path) || "attachment");
    
          if (!item) {
            // Match the regular attachment-import path: reuse an exact-content
            // Eagle item before asking Eagle to import, which avoids its duplicate dialog.
            const reusable = await this.findReusableEagleItemForLocalAttachment({ name: sourceName }, materialized.path);
            if (reusable.cancelled) throw new Error("已取消复用已有 Eagle 素材。");
            item = reusable.item;
          }
    
          if (!item) {
            const addResult = await this.addPathToEagle(await this.withContextEagleFolder({
              path: materialized.path,
              name: stripExtension(sourceName),
              tags,
              annotation: `Imported from Obsidian note: ${context.file.path}`
            }, context));
            item = await this.findImportedEagleItem({ name: sourceName }, tags, addResult);
          }
    
          item = await this.ensureImportedEagleItemTags(context, item);
          item = await this.ensureDroppedItemFolder(context, item);
          const itemId = getEagleItemId(item);
          const bridgeUrl = this.getEagleBridgeUrl(item);
          const url = await this.getEagleItemEmbedUrl(item);
          if (!item || (!bridgeUrl && !url)) throw new Error(`Eagle 未返回可引用的素材：${transferFile.name || "未知文件"}`);
    
          return this.buildReplacement({ name: sourceName }, {
            displayName: this.getCanonicalEagleFileName(item, sourceName),
            itemId,
            bridgeUrl: bridgeUrl || url,
            url
          });
        } finally {
          if (materialized.temporary) this.scheduleTemporaryDropCleanup(materialized.path);
        }
      }
    
      async handleEditorDrop(event, editor) {
        if (this.settings.autoImportAttachments === false) return;
        if (!event || event.defaultPrevented || !this.isEditorFileDrop(event)) return;
        const files = this.getTransferFiles(event.dataTransfer);
        if (!files.length || !files.every(file => isSupportedAttachment(file.name))) return;
        const target = this.getActiveMarkdownDropTarget(editor);
        if (!target) return;
    
        this.syncEditorCursorToDrop(target.editor, event);
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    
        const context = await this.getAssetContext(target.file, false);
        if (!context) throw new Error("无法取得当前笔记的 Eagle 上下文。");
        const replacements = [];
        for (const file of files) replacements.push(await this.buildDroppedEagleReference(context, file));
        if (!replacements.length) return;
        target.editor.replaceSelection(replacements.join("\n"));
        new Notice(files.length === 1 ? "已写入 Eagle 引用。" : `已写入 ${files.length} 个 Eagle 引用。`);
      }
    
      async importCurrentNoteAttachments() {
        const context = await this.getCurrentNoteContext();
        if (!context) return;
        await this.importAttachmentsForContext(context);
      }
    
      async importAttachmentsForContext(context, options = {}) {
        if (!context) return;
        const run = task => options.refresh === false
          ? task()
          : this.runWithReferenceViewRefreshPaused(task, context.file);
        if (context.kind === "canvas") {
          await run(async () => {
            await this.importCanvasAttachments(context, "", {
              silent: options.silent,
              scheduleRefresh: options.refresh !== false
            });
            if (options.organize !== false) {
              const moved = await this.organizeCurrentContextEagleItemsIntoFolder(context, null, {
                createMissing: this.settings.autoFolderOnImport !== false
              });
              if (moved && !options.silent) new Notice(this.t("noticeOrganizedEagleFolder", { count: moved }));
            }
          });
          return;
        }
    
        const text = await this.app.vault.read(context.file);
        const localLinks = this.findLocalAttachmentLinks(text, context.file);
        const externalLocalLinks = this.settings.importExternalLocalAttachments === true
          ? this.findExternalLocalAttachmentLinks(text)
          : [];
        const internetLinks = this.findInternetAttachmentLinks(text);
        if (!localLinks.length && !externalLocalLinks.length && !internetLinks.length) {
          if (options.organize === false) return;
          const moved = await this.organizeCurrentContextEagleItemsIntoFolder(context, text, {
            createMissing: this.settings.autoFolderOnImport !== false
          });
          if (moved && !options.silent) {
            new Notice(this.t("noticeOrganizedEagleFolder", { count: moved }));
          } else if (!moved && !options.silent) {
            new Notice(this.t("noticeNoLocalAttachments"));
          }
          return;
        }
    
        await run(async () => {
          await this.importAttachmentLinks(context, [...localLinks, ...externalLocalLinks], internetLinks, { silent: options.silent });
          if (options.organize !== false) {
            const moved = await this.organizeCurrentContextEagleItemsIntoFolder(context, null, {
              createMissing: this.settings.autoFolderOnImport !== false
            });
            if (moved && !options.silent) new Notice(this.t("noticeOrganizedEagleFolder", { count: moved }));
          }
        });
      }
    
      async importLocalAttachmentItemFromPanel(filePath, item, options = {}) {
        const sourceFile = this.app.vault.getAbstractFileByPath(filePath || "");
        if (!(sourceFile instanceof TFile) || !isSupportedSourceFile(sourceFile)) {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
    
        const localFile = item && item.__localFile;
        if (!(localFile instanceof TFile)) {
          new Notice(this.t("noticeNoAttachmentAtCursor"));
          return;
        }
    
        const context = await this.getAssetContext(sourceFile, true);
        if (!context) return;
    
        return this.runWithReferenceViewRefreshPaused(async () => {
          if (context.kind === "canvas") {
            return this.importCanvasAttachments(context, localFile.path, { silent: options.silent });
          }
    
          const text = await this.app.vault.read(sourceFile);
          const links = this.findLocalAttachmentLinks(text, sourceFile)
            .filter(link => link.file.path === localFile.path);
          const exact = links.find(link => (
            typeof item.__sourceStart === "number" &&
            typeof item.__sourceEnd === "number" &&
            link.start === item.__sourceStart &&
            link.end === item.__sourceEnd
          ));
          const link = exact || links[0];
          if (!link) {
            new Notice(this.t("noticeNoAttachmentAtCursor"));
            return;
          }
          return this.importAttachmentLinks(context, [link], [], { silent: options.silent });
        }, sourceFile);
      }
    
      async importLocalAttachmentItemFromLibrary(item, sourceFiles = [], options = {}) {
        const localFile = item && item.__localFile;
        if (!(localFile instanceof TFile)) {
          new Notice(this.t("noticeNoAttachmentAtCursor"));
          return;
        }
        const files = (Array.isArray(sourceFiles) ? sourceFiles : [])
          .filter(file => file instanceof TFile && isSupportedSourceFile(file));
        if (!files.length) {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
        // A library card can be referenced by several documents. Import through a
        // known owner instead of depending on whichever editor happens to be active.
        const sourceFile = files[0];
        return this.importLocalAttachmentItemFromPanel(sourceFile.path, item, options);
      }
    
      async importExternalLocalAttachmentItemFromPanel(filePath, item, options = {}) {
        if (this.settings.importExternalLocalAttachments !== true) return;
        const sourceFile = this.app.vault.getAbstractFileByPath(filePath || "");
        if (!(sourceFile instanceof TFile) || !isSupportedSourceFile(sourceFile)) {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
        const localPath = String(item && item.__externalLocalPath || "");
        if (!localPath) return;
        const context = await this.getAssetContext(sourceFile, true);
        if (!context) return;
    
        return this.runWithReferenceViewRefreshPaused(async () => {
          if (context.kind === "canvas") {
            return this.importCanvasAttachments(context, localPath, { silent: options.silent });
          }
          const text = await this.app.vault.read(sourceFile);
          const links = this.findExternalLocalAttachmentLinks(text).filter(link => link.localPath === localPath);
          const exact = links.find(link => (
            typeof item.__sourceStart === "number" && typeof item.__sourceEnd === "number"
            && link.start === item.__sourceStart && link.end === item.__sourceEnd
          ));
          const link = exact || links[0];
          if (link) return this.importAttachmentLinks(context, [link], [], { silent: options.silent });
        }, sourceFile);
      }
    
      async importExternalLocalAttachmentItemFromLibrary(item, sourceFiles = [], options = {}) {
        const sourceFile = (Array.isArray(sourceFiles) ? sourceFiles : [])
          .find(file => file instanceof TFile && isSupportedSourceFile(file));
        if (!sourceFile) return;
        return this.importExternalLocalAttachmentItemFromPanel(sourceFile.path, item, options);
      }
    
      async importInternetAttachmentItemFromPanel(filePath, item, options = {}) {
        const sourceFile = this.app.vault.getAbstractFileByPath(filePath || "");
        if (!(sourceFile instanceof TFile) || sourceFile.extension !== "md") {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
    
        const sourceUrl = String(item && (item.url || item.fileURL || (item.__internetLink && item.__internetLink.url)) || "").trim();
        if (!/^https?:\/\//i.test(sourceUrl)) {
          new Notice(this.t("noticeNoAttachmentAtCursor"));
          return;
        }
    
        const context = await this.getAssetContext(sourceFile, true);
        if (!context) return;
    
        return this.runWithReferenceViewRefreshPaused(async () => {
          const text = await this.app.vault.read(sourceFile);
          const links = this.findInternetAttachmentLinks(text)
            .filter(link => link.url === sourceUrl);
          const exact = links.find(link => (
            typeof item.__sourceStart === "number" &&
            typeof item.__sourceEnd === "number" &&
            link.start === item.__sourceStart &&
            link.end === item.__sourceEnd
          ));
          const link = exact || links[0];
          if (!link) {
            new Notice(this.t("noticeNoAttachmentAtCursor"));
            return;
          }
          return this.importAttachmentLinks(context, [], [link], { silent: options.silent });
        }, sourceFile);
      }
    
      async importInternetAttachmentItemFromLibrary(item, sourceFiles = [], options = {}) {
        const files = (Array.isArray(sourceFiles) ? sourceFiles : [])
          .filter(file => file instanceof TFile && file.extension === "md");
        if (!files.length) {
          new Notice(this.t("noticeOpenNoteOrCanvas"));
          return;
        }
        // A library URL can be used by several notes. Import through a known owner
        // so the resulting Eagle item receives that note's tags and folder mapping.
        return this.importInternetAttachmentItemFromPanel(files[0].path, item, options);
      }
    
      async importCanvasAttachments(context, targetFilePath = "", options = {}) {
        const raw = options.sourceText !== undefined
          ? options.sourceText
          : await this.app.vault.read(context.file);
        let canvas;
        try {
          canvas = JSON.parse(raw);
        } catch (error) {
          console.warn("Failed to parse Canvas for import:", error);
          if (!options.silent) new Notice(this.t("noticeCanvasImportUnsupported"));
          return { success: 0, failed: 1, reused: 0, changed: false };
        }
    
        const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
        const importedByPath = options.importedByPath instanceof Map
          ? options.importedByPath
          : new Map();
        const importedFiles = [];
        let success = 0;
        let failed = 0;
        let reused = 0;
        let changed = false;
    
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const rawTarget = typeof node.file === "string" ? node.file : typeof node.url === "string" ? node.url : "";
          if (!rawTarget) continue;
          const externalPath = this.settings.importExternalLocalAttachments === true
            ? externalLocalPathFromTarget(rawTarget)
            : "";
          const cleaned = cleanAttachmentTarget(rawTarget);
          let file = null;
          let importKey = "";
          let importLink = null;
          if (externalPath) {
            try {
              if (!isSupportedCanvasAttachment(externalPath) || !nodeFs.statSync(externalPath).isFile()) continue;
            } catch (_) {
              continue;
            }
            importKey = externalPath;
            importLink = {
              original: rawTarget,
              target: cleaned,
              localPath: externalPath,
              name: nodePath.basename(externalPath),
              start: 0,
              end: 0
            };
          } else {
            if (typeof node.file !== "string" || !cleaned || isExternalLink(cleaned) || !isSupportedCanvasAttachment(cleaned)) continue;
            file = this.app.metadataCache.getFirstLinkpathDest(cleaned, context.file.path);
            if (!(file instanceof TFile) || !isSupportedCanvasAttachment(file.path)) continue;
            importKey = file.path;
            importLink = { original: node.file, target: cleaned, file, start: 0, end: 0 };
          }
          if (targetFilePath && importKey !== targetFilePath) continue;
    
          try {
            let imported = importedByPath.get(importKey);
            if (imported) {
              reused += 1;
              const item = await this.ensureImportedEagleItemTags(context, imported.item);
              imported = { ...imported, item };
              importedByPath.set(importKey, imported);
            } else {
              imported = await this.importOneAttachment(context, importLink);
              if (imported) {
                importedByPath.set(importKey, imported);
                if (imported.sourceFile instanceof TFile) importedFiles.push(imported);
              }
            }
    
            if (!imported) {
              failed += 1;
              continue;
            }
    
            const bridgeUrl = this.getEagleBridgeUrl(imported.item);
            if (!bridgeUrl) {
              failed += 1;
              continue;
            }
    
            const size = normalizeCanvasNodeSize(node, imported.sourceFile.name);
            node.type = "link";
            node.url = this.buildCanvasEagleBridgeUrl(bridgeUrl, imported.sourceFile.name);
            node.width = size.width;
            node.height = size.height;
            delete node.file;
    
            if (isPreviewableImage(imported.sourceFile.name)) {
              node.eagleBridgeManaged = true;
              node.eagleBridgeSourceUrl = bridgeUrl;
              if (size.width > 0 && size.height > 0) {
                node.eagleBridgeAspect = size.width / size.height;
                node.eagleBridgeLastWidth = size.width;
                node.eagleBridgeLastHeight = size.height;
              }
            } else {
              delete node.eagleBridgeManaged;
              delete node.eagleBridgeSourceUrl;
              delete node.eagleBridgeAspect;
              delete node.eagleBridgeLastWidth;
              delete node.eagleBridgeLastHeight;
            }
    
            success += 1;
            changed = true;
          } catch (error) {
            console.warn("Failed to import Canvas attachment:", node, error);
            failed += 1;
          }
        }
    
        if (!success && !failed) {
          if (!options.silent) new Notice(this.t("noticeCanvasImportUnsupported"));
          return { success, failed, reused, changed };
        }
    
        if (changed) {
          await this.app.vault.modify(context.file, `${JSON.stringify(canvas, null, 2)}\n`);
          await this.trashImportedFiles(importedFiles);
          if (options.scheduleRefresh !== false) this.scheduleReferenceViewRefresh(context.file);
        }
    
        if (!options.silent) {
          new Notice(this.t("noticeProcessedAttachments", { success, reused, failed }));
        }
        return { success, failed, reused, changed };
      }
    
      async cleanupLocalCopiesForContext(context, options = {}) {
        if (!context) return { deleted: 0, skipped: 0 };
    
        const text = await this.app.vault.read(context.file);
        const refs = this.extractEagleBridgeItemReferences(text);
        if (!refs.length) {
          if (!options.silent) new Notice(this.t("noticeNoEagleBridgeLinks"));
          return { deleted: 0, skipped: 0 };
        }
    
        const protectedLocalPaths = options.protectedLocalPaths instanceof Set
          ? options.protectedLocalPaths
          : await this.getVaultReferencedLocalAttachmentPaths();
        const filesByName = options.filesByName instanceof Map
          ? options.filesByName
          : this.getSupportedVaultFilesByName();
        const filesByStem = options.filesByStem instanceof Map
          ? options.filesByStem
          : this.getSupportedVaultFilesByStem(filesByName);
        const deletedPaths = options.deletedPaths instanceof Set ? options.deletedPaths : new Set();
        const filesToTrash = new Map();
        let skipped = 0;
    
        for (const ref of refs) {
          const item = ref && ref.id ? await this.queryEagleItemInfo(ref.id) : null;
          if (!item) {
            skipped += 1;
            continue;
          }
          const candidateNames = await this.getLocalCopyCandidateNamesForEagleBridgeRef(ref, item);
          let matched = false;
          for (const name of candidateNames) {
            let files = (filesByName.get(name.toLowerCase()) || [])
              .filter(file => file.path !== context.file.path)
              .filter(file => !protectedLocalPaths.has(file.path))
              .filter(file => !deletedPaths.has(file.path));
            // Eagle may expose a rendered preview extension (for example .png)
            // although the Obsidian source file is .jfif. Only use a stem match
            // when it resolves to one unambiguous local attachment.
            if (!files.length) {
              const stem = stripExtension(name).trim().toLowerCase();
              if (stem) {
                files = (filesByStem.get(stem) || [])
                  .filter(file => file.path !== context.file.path)
                  .filter(file => !protectedLocalPaths.has(file.path))
                  .filter(file => !deletedPaths.has(file.path));
              }
            }
            if (files.length === 1) {
              if (await this.isVerifiedLocalCopyOfEagleItem(files[0], item)) {
                filesToTrash.set(files[0].path, files[0]);
              } else {
                skipped += 1;
              }
              matched = true;
              break;
            }
            if (files.length > 1) {
              skipped += 1;
              matched = true;
              break;
            }
          }
          if (!matched) skipped += 1;
        }
    
        let deleted = 0;
        for (const file of filesToTrash.values()) {
          try {
            await this.trashLocalFile(file);
            deletedPaths.add(file.path);
            deleted += 1;
          } catch (error) {
            console.warn("Failed to trash local copy:", file.path, error);
            skipped += 1;
          }
        }
    
        if (!options.silent) {
          new Notice(this.t("noticeCleanedLocalCopies", { deleted, skipped }));
        }
        return { deleted, skipped };
      }
    
      getSupportedVaultFilesByName(files = this.app.vault.getFiles()) {
        const filesByName = new Map();
        for (const file of files) {
          if (!(file instanceof TFile)) continue;
          if (file.path.startsWith(".trash/") || file.path.startsWith(".obsidian/")) continue;
          if (isInsideEagleLibrary(file.path)) continue;
          if (!isSupportedAttachment(file.path)) continue;
          const key = file.name.toLowerCase();
          if (!filesByName.has(key)) filesByName.set(key, []);
          filesByName.get(key).push(file);
        }
        return filesByName;
      }
    
      async getVaultReferencedLocalAttachmentPaths(files = this.getAllObsidianAssetSourceFiles()) {
        const paths = new Set();
        for (const file of files) {
          const text = await this.app.vault.read(file);
          const links = file.extension === "canvas"
            ? this.findCanvasAttachmentLinks(text, file)
            : this.findLocalAttachmentLinks(text, file);
          for (const link of links) {
            if (link.file instanceof TFile) paths.add(link.file.path);
          }
        }
        return paths;
      }
    
      async filesHaveSameContent(firstPath, secondPath) {
        try {
          const [firstStat, secondStat] = await Promise.all([
            nodeFs.promises.stat(firstPath),
            nodeFs.promises.stat(secondPath)
          ]);
          if (!firstStat.isFile() || !secondStat.isFile() || firstStat.size !== secondStat.size) return false;
          const digest = filePath => new Promise((resolve, reject) => {
            const hash = nodeCrypto.createHash("sha256");
            nodeFs.createReadStream(filePath).on("error", reject).on("data", chunk => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
          });
          const [firstHash, secondHash] = await Promise.all([digest(firstPath), digest(secondPath)]);
          return firstHash === secondHash;
        } catch (error) {
          console.warn("Failed to verify local attachment copy:", error);
          return false;
        }
      }
    
      async isVerifiedLocalCopyOfEagleItem(file, item) {
        const localPath = this.getFullPath(file);
        const eaglePath = await this.getOriginalPathForEagleItem(item);
        return Boolean(localPath && eaglePath && await this.filesHaveSameContent(localPath, eaglePath));
      }
    
      getSupportedVaultFilesByStem(filesByName) {
        const filesByStem = new Map();
        for (const files of filesByName.values()) {
          for (const file of files) {
            const stem = stripExtension(file.name).trim().toLowerCase();
            if (!filesByStem.has(stem)) filesByStem.set(stem, []);
            filesByStem.get(stem).push(file);
          }
        }
        return filesByStem;
      }
    
      getAllObsidianAssetSourceFiles(files = this.app.vault.getFiles()) {
        return files
          .filter(file => file instanceof TFile && !isInsideEagleLibrary(file.path) && isSupportedSourceFile(file));
      }
    
      async confirmAndImportAllUnimportedAttachments() {
        const choice = await chooseInObsidianModal(
          this.app,
          "批量导入未导入附件",
          "将扫描全部 Markdown 笔记和白板，把本地附件和网络素材引用转换为 Eagle 素材链接。已是 Eagle 链接的条目会跳过，同一素材只上传一次并补齐各笔记或白板的标签和文件夹。默认保留 Obsidian 本地文件；若已开启自动清理，则按该设置移入 Obsidian 回收站。",
          [{ value: "continue", label: "开始导入", cta: true }],
          "取消"
        );
        if (choice !== "continue") return null;
    
        return this.runVaultRebuildTask({
          title: "批量导入未导入附件",
          description: "正在扫描笔记和白板，并将仍未转换的附件导入 Eagle。",
          run: async update => this.runWithReferenceViewRefreshPaused(async () => {
            const files = this.getAllObsidianAssetSourceFiles();
            const importedByPath = new Map();
            const importedByUrl = new Map();
            let scanned = 0;
            let converted = 0;
            let reused = 0;
            let failed = 0;
    
            for (const file of files) {
              scanned += 1;
              update({
                phase: "正在导入附件",
                completed: scanned,
                total: files.length,
                detail: file.path
              });
              const context = await this.getAssetContext(file, false);
              if (!context) continue;
              const sourceText = await this.app.vault.read(file);
    
              let result;
              if (context.kind === "canvas") {
                result = await this.importCanvasAttachments(context, "", {
                  silent: true,
                  importedByPath,
                  sourceText
                });
              } else {
                const localLinks = this.findLocalAttachmentLinks(sourceText, file);
                const externalLocalLinks = this.settings.importExternalLocalAttachments === true
                  ? this.findExternalLocalAttachmentLinks(sourceText)
                  : [];
                const internetLinks = this.findInternetAttachmentLinks(sourceText);
                if (!localLinks.length && !externalLocalLinks.length && !internetLinks.length) continue;
                result = await this.importAttachmentLinks(context, [...localLinks, ...externalLocalLinks], internetLinks, {
                  silent: true,
                  importedByPath,
                  importedByUrl,
                  sourceText
                });
              }
              if (result) {
                converted += Number(result.success) || 0;
                reused += Number(result.reused) || 0;
                failed += Number(result.failed) || 0;
              }
              if (scanned % 3 === 0) await sleep(0);
            }
    
            return `完成：扫描 ${scanned} 个笔记/白板；转换 ${converted} 个引用，复用 ${reused} 个已导入素材，失败 ${failed} 个。`;
          })
        });
      }
    
      async confirmAndCleanupAllImportedLocalCopies() {
        const choice = await chooseInObsidianModal(
          this.app,
          "批量清理已导入附件",
          "将扫描全部 Markdown 笔记和白板，把已确认存在于 Eagle、且不再被本地链接直接引用的 Obsidian 本地副本移入 Obsidian 回收站。无法唯一确认的文件会保留，Eagle 素材不会被删除。",
          [{ value: "continue", label: "开始清理", cta: true }],
          "取消"
        );
        if (choice !== "continue") return null;
    
        return this.runVaultRebuildTask({
          title: "批量清理已导入附件",
          description: "正在检查已经导入 Eagle 的本地副本。",
          run: async update => this.runWithReferenceViewRefreshPaused(async () => {
            const vaultFiles = this.app.vault.getFiles();
            const files = this.getAllObsidianAssetSourceFiles(vaultFiles);
            const filesByName = this.getSupportedVaultFilesByName(vaultFiles);
            const filesByStem = this.getSupportedVaultFilesByStem(filesByName);
            const protectedLocalPaths = await this.getVaultReferencedLocalAttachmentPaths(files);
            const deletedPaths = new Set();
            let scanned = 0;
            let deleted = 0;
            let skipped = 0;
    
            for (const file of files) {
              scanned += 1;
              update({
                phase: "正在清理本地副本",
                completed: scanned,
                total: files.length,
                detail: file.path
              });
              const context = await this.getAssetContext(file, false);
              if (!context) continue;
              const result = await this.cleanupLocalCopiesForContext(context, {
                silent: true,
                deletedPaths,
                filesByName,
                filesByStem,
                protectedLocalPaths
              });
              deleted += Number(result && result.deleted) || 0;
              skipped += Number(result && result.skipped) || 0;
              if (scanned % 3 === 0) await sleep(0);
            }
    
            return `完成：扫描 ${scanned} 个笔记/白板；已移入 Obsidian 回收站 ${deleted} 个本地副本，跳过 ${skipped} 个无法唯一确认的条目。`;
          })
        });
      }
    
      async getLocalCopyCandidateNamesForEagleBridgeRef(ref, knownItem = null) {
        const names = new Set();
        const addName = value => {
          const cleaned = cleanLocalCopyCandidateName(value);
          if (cleaned && isSupportedAttachment(cleaned)) names.add(cleaned);
        };
        addName(ref && ref.label);
    
        const item = knownItem || (ref && ref.id ? await this.queryEagleItemInfo(ref.id) : null);
        if (item) {
          addName(item.filename);
          addName(item.fileName);
          addName(item.name);
          addName(item.title);
          const displayName = getAssetDisplayName(item);
          addName(displayName);
          const rawExtension = item.ext || item.extension || getAssetExtension(item);
          const extension = normalizeExtension(rawExtension);
          if (extension) {
            for (const value of [item.name, item.title, displayName]) {
              const cleaned = cleanLocalCopyCandidateName(value);
              if (cleaned && !nodePath.extname(cleaned)) addName(`${cleaned}${extension}`);
            }
          }
        }
    
        return Array.from(names);
      }
    
      async fixCurrentNoteEagleThumbnailLinks() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        const re = /http:\/\/localhost:\d+\/api\/item\/thumbnail\?id=[A-Za-z0-9_-]+/g;
        const matches = Array.from(new Set(text.match(re) || []));
        if (!matches.length) {
          new Notice(this.t("noticeNoThumbnailLinks"));
          return;
        }
    
        let fixed = 0;
        for (const url of matches) {
          const resolved = await this.resolveEaglePathEndpoint(url);
          if (!resolved) continue;
          text = text.split(url).join(resolved);
          fixed += 1;
        }
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeFixedThumbnailLinks", { count: fixed }));
      }
    
      async fixCurrentNoteDoubleEncodedFileLinks() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        const re = /file:\/\/\/[^\s)]+/g;
        const matches = Array.from(new Set(text.match(re) || []));
        let fixed = 0;
    
        for (const url of matches) {
          const normalized = normalizeFileUrl(url);
          if (normalized && normalized !== url) {
            text = text.split(url).join(normalized);
            fixed += 1;
          }
        }
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeFixedDoubleEncodedLinks", { count: fixed }));
      }
    
      async convertCurrentNoteEagleFileLinksToBridge() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        const re = /file:\/\/\/[^\s)]*?\/images\/([^/\\)]+)\.info\/[^\s)]*/gi;
        let fixed = 0;
        text = text.replace(re, (_match, id) => {
          fixed += 1;
          const base = this.settings.eagleBridgeBaseUrl.replace(/\/+$/, "");
          return `${base}/images/${encodeURIComponent(stripInfoSuffix(safeDecode(id)))}.info`;
        });
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeConvertedFileLinks", { count: fixed }));
      }
    
      async convertCurrentNoteEagleBridgeEmbedsToLinks() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        const re = /!\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/[^)\s]+\.info)\)/g;
        let fixed = 0;
        text = text.replace(re, (_match, label, url) => {
          fixed += 1;
          return `[${label || this.t("cleanLabelFallback")}](${url})`;
        });
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeConvertedEmbedsToLinks", { count: fixed }));
      }
    
      async convertCurrentNoteEagleBridgeLinksToHtmlImages() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        let fixed = 0;
    
        text = text.replace(/!\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/[^)\s]+\.info)\)/g, (_match, label, url) => {
          fixed += 1;
          return buildHtmlImage(label || this.t("cleanLabelFallback"), url);
        });
    
        text = text.replace(/\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/[^)\s]+\.info)\)/g, (_match, label, url) => {
          fixed += 1;
          return buildHtmlImage(label || this.t("cleanLabelFallback"), url);
        });
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeConvertedLinksToHtml", { count: fixed }));
      }
    
      async convertCurrentNoteEagleBridgeLinksToStandardEmbeds() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice(this.t("noticeOpenMarkdown"));
          return;
        }
    
        let text = await this.app.vault.read(file);
        let fixed = 0;
    
        text = text.replace(/!\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/[^)\s]+\.info)\)/g, (_match, label, url) => {
          fixed += 1;
          return buildStandardEagleBridgeEmbed(label || this.t("cleanLabelFallback"), url);
        });
    
        text = text.replace(/\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/[^)\s]+\.info)\)/g, (_match, label, url) => {
          fixed += 1;
          return buildStandardEagleBridgeEmbed(label || this.t("cleanLabelFallback"), url);
        });
    
        text = text.replace(/<img\s+[^>]*src=["'](http:\/\/localhost:\d+\/images\/[^"']+\.info)["'][^>]*>/g, match => {
          const urlMatch = match.match(/src=["']([^"']+)["']/i);
          const altMatch = match.match(/alt=["']([^"']*)["']/i);
          const widthMatch = match.match(/width=["']?(\d+)["']?/i);
          if (!urlMatch) return match;
          fixed += 1;
          const label = altMatch ? unescapeHtmlAttr(altMatch[1]) : this.t("cleanLabelFallback");
          const width = widthMatch ? widthMatch[1] : "200";
          return buildStandardEagleBridgeEmbed(label, urlMatch[1], width);
        });
    
        if (fixed) {
          await this.app.vault.modify(file, text);
        }
        new Notice(this.t("noticeConvertedLinksToEmbeds", { count: fixed }));
      }
    
      async handleRenderedImageContextMenu(event) {
        const target = event.target;
        if (!target || !target.closest) return;
        const image = target.closest("img, audio, video, .file-embed, .media-embed, .pdf-embed, .internal-embed, .eaglebridge-file-embed");
        if (!image || image.closest(".eaglebridge-note-assets-view")) return;
    
        const file = this.getRenderedImageSourceFile(image);
        if (!file || file.extension !== "md") return;
    
        const range = await this.findAssetRangeForRenderedImage(file, image);
        if (range && range.itemId) {
          const source = await this.app.vault.read(file);
          const reference = source.slice(range.start, range.end);
          const itemId = range.itemId;
          const referencedFiles = [file];
          const descriptors = [
            {
              title: this.t("copyAttachment"),
              icon: "eagle-outline",
              onClick: () => this.copyRenderedEagleAttachment(itemId)
            },
            {
              title: this.t("copyAttachmentReference"),
              icon: "eagle-outline",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(reference);
                } catch (_) {
                  require("electron").clipboard.writeText(reference);
                }
                new Notice(this.t("noticeCopied", { value: reference }));
              }
            },
            {
              title: this.t("openInEagle"),
              icon: "eagle-outline",
              onClick: () => this.openRenderedEagleAttachment(itemId)
            }
          ];
          if (referencedFiles.length) {
            descriptors.push({
              title: "定位到引用位置",
              icon: "map-pin",
              children: referencedFiles.map(referencedFile => ({
                title: referencedFile.basename || referencedFile.path,
                icon: referencedFile.extension === "canvas" ? "layout-dashboard" : "file-text",
                onClick: async () => {
                  await this.revealAssetInSource(referencedFile.path, {
                    __sourceStart: range.start,
                    __sourceEnd: range.end
                  });
                }
              }))
            });
          }
          window.setTimeout(() => this.injectItemsIntoNativeMenu(descriptors), 30);
          return;
        }
    
        const link = range && range.link || await this.findAttachmentLinkForRenderedImage(file, image);
        if (!link) return;
        window.setTimeout(() => this.injectItemsIntoNativeMenu([{
          title: this.t("menuImportAttachment"),
          onClick: async () => {
            const context = await this.getCurrentNoteContext();
            if (!context) return;
            if (link.kind === "internet") {
              await this.importAttachmentLinks(context, [], [link]);
            } else {
              await this.importAttachmentLinks(context, [link]);
            }
          }
        }]), 30);
      }
    
      async copyRenderedEagleAttachment(itemId) {
        const item = await this.queryEagleItemInfo(itemId);
        const filePath = item && await this.getOriginalPathForEagleItem(item);
        if (!filePath) throw new Error("无法读取此附件的原始文件。");
        const { clipboard, nativeImage } = require("electron");
        const image = nativeImage.createFromPath(filePath);
        if (!image.isEmpty()) {
          clipboard.writeImage(image);
          return;
        }
        clipboard.writeBuffer("application/x-eaglebridge-attachment", nodeFs.readFileSync(filePath));
        clipboard.writeText(`file:///${filePath.replace(/\\/g, "/")}`);
      }
    
      async openRenderedEagleAttachment(itemId) {
        await this.openEagleItem(itemId);
      }
    
      injectItemsIntoNativeMenu(descriptors) {
        const menus = Array.from(document.querySelectorAll(".menu"));
        const menu = menus[menus.length - 1];
        if (!menu || menu.querySelector(".eaglebridge-import-rendered-image")) return;
    
        let activeSubmenu = null;
        const runDescriptor = async descriptor => {
          try {
            document.body.click();
            await descriptor.onClick();
          } catch (error) {
            console.warn(`Failed to ${descriptor.title}:`, error);
            new Notice(`${descriptor.title}失败：${error && error.message ? error.message : error}`);
          }
        };
        const addItem = descriptor => {
          const item = document.createElement("div");
          item.className = "menu-item eaglebridge-import-rendered-image";
          const iconElement = document.createElement("div");
          iconElement.className = "menu-item-icon";
          if (descriptor.icon !== "") require("obsidian").setIcon(iconElement, descriptor.icon || "eagle-outline");
          const titleElement = document.createElement("div");
          titleElement.className = "menu-item-title";
          titleElement.textContent = descriptor.title;
          item.append(iconElement, titleElement);
          const children = Array.isArray(descriptor.children) ? descriptor.children : [];
          if (children.length) {
            item.addClass("has-submenu");
            const submenuIcon = document.createElement("div");
            submenuIcon.className = "menu-item-submenu-icon";
            require("obsidian").setIcon(submenuIcon, "chevron-right");
            item.append(submenuIcon);
          }
          item.addEventListener("mouseenter", () => {
            for (const sibling of menu.querySelectorAll(".menu-item")) {
              sibling.removeClass("selected");
              sibling.removeClass("is-selected");
            }
            item.addClass("selected");
            item.addClass("is-selected");
            if (!children.length) return;
            activeSubmenu?.hide();
            const submenu = new Menu();
            for (const child of children) {
              submenu.addItem(menuItem => menuItem
                .setTitle(child.title)
                .setIcon(child.icon || "file-text")
                .onClick(() => runDescriptor(child)));
            }
            const rect = item.getBoundingClientRect();
            submenu.showAtPosition({ x: rect.right - 4, y: rect.top - 4 });
            activeSubmenu = submenu;
          });
          item.addEventListener("mouseleave", () => {
            item.removeClass("selected");
            item.removeClass("is-selected");
          });
          item.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!children.length) void runDescriptor(descriptor);
          });
          return item;
        };
    
        const items = (Array.isArray(descriptors) ? descriptors : [])
          .filter(item => item && item.title && (typeof item.onClick === "function" || Array.isArray(item.children)))
          .map(addItem);
    
        const nativeItem = menu.querySelector(".menu-item:not(.eaglebridge-import-rendered-image)");
        const itemContainer = nativeItem && nativeItem.parentElement || menu;
        let separator = nativeItem && nativeItem.previousElementSibling;
        if (!separator || !separator.classList.contains("menu-separator")) {
          separator = document.createElement("div");
          separator.className = "menu-separator";
          itemContainer.insertBefore(separator, nativeItem || itemContainer.firstChild);
        }
        for (const item of items) {
          itemContainer.insertBefore(item, separator);
        }
      }
    
      handleRenderedImagePointerDown(event) {
        const image = this.getRenderedImageFromEvent(event);
        this.renderedImagePointerDown = image
          ? {
            image,
            pointerId: event.pointerId,
            clientX: Number(event.clientX) || 0,
            clientY: Number(event.clientY) || 0
          }
          : null;
      }
    
      handleRenderedImagePointerUp(event) {
        const pointer = this.renderedImagePointerDown;
        this.renderedImagePointerDown = null;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
    
        const deltaX = (Number(event.clientX) || 0) - pointer.clientX;
        const deltaY = (Number(event.clientY) || 0) - pointer.clientY;
        if (Math.hypot(deltaX, deltaY) > 6) {
          this.suppressRenderedImageClickUntil = Date.now() + 450;
          return;
        }
        if (this.getRenderedImageFromEvent(event) !== pointer.image) return;
        void this.handleRenderedImageClick(event);
      }
    
      async handleRenderedImageClick(event) {
        if (Date.now() < this.suppressRenderedImageClickUntil) return;
        const image = this.getRenderedImageFromEvent(event);
        if (!image) return;
    
        if (image.closest(".eaglebridge-note-assets-view")) return;
    
        // A normal click is usually preceded by pointerup. Treat both as one action
        // so special Live Preview embeds can be handled without double-scrolling.
        const now = Date.now();
        const last = this.lastRenderedImageActivation;
        if (last && last.image === image && now - last.at < 500) return;
        this.lastRenderedImageActivation = { image, at: now };
    
        const file = this.getRenderedImageSourceFile(image);
        if (!file) return;
        if (file.extension === "canvas") {
          const items = await this.queryNoteAttachmentItemsForFile(file);
          const src = safeDecode(String(image.getAttribute("src") || ""));
          const itemIdMatch = src.match(/\/images\/([^/?#]+)\.info/i);
          const itemId = itemIdMatch ? stripInfoSuffix(itemIdMatch[1]) : "";
          const item = items.find(candidate => (
            (itemId && stripInfoSuffix(getEagleItemId(candidate)) === itemId)
            || candidate.resourceURL === src
            || candidate.url === src
          ));
          if (item) await this.scrollReferenceViewsToAsset(file.path, { assetKey: item.id, itemId });
          return;
        }
        if (file.extension !== "md") return;
        const sourceView = image.closest && image.closest(".markdown-preview-view, .markdown-source-view");
        if (!sourceView) return;
    
        const range = await this.findAssetRangeForRenderedImage(file, image);
        if (!range) return;
        await this.scrollReferenceViewsToAsset(file.path, range);
      }
    
      getRenderedImageFromEvent(event) {
        const target = event && event.target;
        // Do not walk ancestors or descendants here. In a table, for example, a
        // text cell can share an ancestor with an image cell; only the image itself
        // is allowed to drive the side-panel selection.
        return target && target.tagName === "IMG" ? target : null;
      }
    
      getRenderedImageSourceFile(image) {
        const sourceElement = image && image.closest ? image.closest("[data-path]") : null;
        const sourcePath = sourceElement && sourceElement.getAttribute ? sourceElement.getAttribute("data-path") : "";
        if (sourcePath) {
          const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
          if (sourceFile instanceof TFile) return sourceFile;
        }
        const activeFile = this.app.workspace.getActiveFile();
        return activeFile instanceof TFile ? activeFile : null;
      }
    
      async findAssetRangeForRenderedImage(noteFile, image) {
        const text = await this.app.vault.read(noteFile);
        const identity = this.getRenderedAttachmentIdentity(image);
        const src = identity.src;
        const idMatch = src.match(/\/images\/([^/?#]+)\.info/i);
        const cleanId = idMatch ? stripInfoSuffix(safeDecode(idMatch[1])) : "";
        const refs = this.extractEagleBridgeItemReferences(text);
    
        if (cleanId) {
          const byId = refs.find(ref => ref.id === cleanId);
          if (byId) return { start: byId.start, end: byId.end, itemId: cleanId };
        }
    
        for (const name of identity.names) {
          const cleanAlt = cleanEagleBridgeLabel(name);
          const byLabel = cleanAlt && refs.find(ref => cleanEagleBridgeLabel(ref.label) === cleanAlt);
          if (byLabel) return { start: byLabel.start, end: byLabel.end, itemId: byLabel.id };
        }
    
        // EagleBridge URLs carry a stable item ID. Resolve them before matching a
        // local attachment by filename, since local and Eagle copies can share a name.
        const localOrInternet = await this.findAttachmentLinkForRenderedImage(noteFile, image);
        if (localOrInternet) {
          return {
            start: localOrInternet.start,
            end: localOrInternet.end,
            link: localOrInternet
          };
        }
    
        return null;
      }
    
      async scrollReferenceViewsToAsset(filePath, range) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          const view = leaf.view;
          if (view && typeof view.scrollToAssetRange === "function") {
            await view.scrollToAssetRange(filePath, range);
          }
        }
      }
    
      async findAttachmentLinkForRenderedImage(noteFile, image) {
        const text = await this.app.vault.read(noteFile);
        const links = this.findLocalAttachmentLinks(text, noteFile);
        const externalLocalLinks = this.findExternalLocalAttachmentLinks(text);
        const internetLinks = this.findInternetAttachmentLinks(text);
    
        const { src, names } = this.getRenderedAttachmentIdentity(image);
        const srcName = safeDecode(nodePath.basename(src.split("?")[0]));
        const matchesName = candidates => names.some(name => candidates.includes(name));
    
        for (const link of links) {
          const fullPath = this.getFullPath(link.file).replace(/\\/g, "/");
          const decodedFullPath = safeDecode(fullPath);
          if (src && (src.includes(fullPath) || src.includes(decodedFullPath))) return link;
          if (matchesName([link.file.basename, link.file.name, link.target])) return link;
          if (srcName && srcName === link.file.name) return link;
        }
    
        for (const link of externalLocalLinks) {
          const normalizedPath = safeDecode(link.localPath).replace(/\\/g, "/");
          const fileName = nodePath.basename(link.localPath);
          if (src && (safeDecode(src).replace(/\\/g, "/").includes(normalizedPath) || srcName === fileName)) return link;
          if (matchesName([link.name, fileName, link.target])) return link;
        }
    
        for (const link of internetLinks) {
          if (src && (src === link.url || src.includes(link.url) || safeDecode(src) === safeDecode(link.url))) return link;
          if (matchesName([link.name, link.url])) return link;
          if (srcName && srcName === nodePath.basename(String(link.url).split("?")[0])) return link;
        }
    
        const allLocalLinks = links.concat(externalLocalLinks);
        if (allLocalLinks.length === 1) return allLocalLinks[0];
        return null;
      }
    
      getRenderedAttachmentIdentity(element) {
        const source = element && element.matches && element.matches("[src], [href], [data-href]")
          ? element
          : element && element.querySelector && element.querySelector("[src], [href], [data-href]");
        const read = name => String(source && source.getAttribute(name) || element && element.getAttribute && element.getAttribute(name) || "").trim();
        const src = safeDecode(read("src") || read("href") || read("data-href"));
        const names = [read("alt"), read("aria-label"), read("data-href"), String(element && element.textContent || "").trim(), safeDecode(nodePath.basename(src.split("?")[0]))]
          .filter(Boolean);
        return { src, names: Array.from(new Set(names)) };
      }
    
      async prepareEagleBridgeRepairCandidates(ref) {
        const context = await this.getCurrentNoteContext(false);
        if (!context || !ref || !ref.id) return null;
    
        const text = await this.app.vault.read(context.file);
        const locatedRef = this.resolveRepairRefFromText(text, ref);
        if (!locatedRef) return null;
    
        const currentText = text.slice(locatedRef.start, locatedRef.end);
        const parsedRef = this.extractEagleBridgeItemReferences(currentText)[0] || {};
        const currentRef = Object.assign({}, locatedRef, parsedRef, {
          label: parsedRef.label || locatedRef.label || ref.label,
          start: locatedRef.start,
          end: locatedRef.end
        });
        const currentItem = await this.queryEagleItemInfo(currentRef.id);
        const candidates = await this.findConservativeDuplicateCandidates(currentRef, currentItem, context);
        return { context, ref: currentRef, candidates };
      }
    
      resolveRepairRefFromText(text, ref) {
        const refs = this.extractEagleBridgeItemReferences(text);
        const cleanId = stripInfoSuffix(ref && ref.id);
        if (!cleanId) return null;
    
        if (typeof ref.start === "number" && typeof ref.end === "number") {
          const inRange = refs.find(item => item.start === ref.start && item.end === ref.end);
          if (inRange) return Object.assign({}, inRange, { label: inRange.label || ref.label });
        }
    
        const sameId = refs.filter(item => item.id === cleanId);
        if (sameId.length === 1) return Object.assign({}, sameId[0], { label: sameId[0].label || ref.label });
    
        const expectedLabel = cleanEagleBridgeLabel(ref.label);
        if (expectedLabel) {
          const sameLabel = sameId.filter(item => cleanEagleBridgeLabel(item.label) === expectedLabel);
          if (sameLabel.length === 1) return Object.assign({}, sameLabel[0], { label: sameLabel[0].label || ref.label });
        }
    
        if (sameId.length > 1 && typeof ref.start === "number") {
          const sorted = sameId.slice().sort((a, b) => Math.abs(a.start - ref.start) - Math.abs(b.start - ref.start));
          return Object.assign({}, sorted[0], { label: sorted[0].label || ref.label });
        }
    
        return null;
      }
    
      async applyEagleBridgeLinkReplacement(ref, replacementId) {
        const context = await this.getCurrentNoteContext(false);
        if (!context || !ref || !replacementId) return false;
    
        const text = await this.app.vault.read(context.file);
        const locatedRef = this.resolveRepairRefFromText(text, ref);
        if (!locatedRef) return false;
    
        const currentText = text.slice(locatedRef.start, locatedRef.end);
        const currentId = stripInfoSuffix(locatedRef.id);
        const nextSegment = currentText.replace(
          new RegExp(`(https?:\\/\\/localhost:\\d+\\/images\\/)${escapeRegExp(currentId)}(\\.info)`, "g"),
          `$1${stripInfoSuffix(replacementId)}$2`
        );
        if (nextSegment === currentText) return false;
    
        const nextText = text.slice(0, locatedRef.start) + nextSegment + text.slice(locatedRef.end);
        await this.app.vault.modify(context.file, nextText);
        await this.syncEagleBridgeItemTags(context, [replacementId], false);
        await this.rememberCurrentFileEagleBridgeIds(context.file);
        return true;
      }
    
      async importAttachmentAtCursor(editor, view) {
        const context = await this.getCurrentNoteContext();
        if (!context || !view || !view.file) return;
    
        const match = this.getImportableAttachmentAtCursor(editor, view);
        if (!match) {
          new Notice(this.t("noticeNoAttachmentAtCursor"));
          return;
        }
        const { cursor, lineText, link } = match;
        const imported = await this.importOneAttachment(context, link);
        if (!imported) return;
    
        const sizedReplacement = preserveAttachmentDisplaySize(link.original, imported.replacement);
        const replacement = isProbablyMarkdownTableLine(lineText)
          ? escapeMarkdownTablePipes(sizedReplacement)
          : sizedReplacement;
        editor.replaceRange(replacement, { line: cursor.line, ch: link.start }, { line: cursor.line, ch: link.end });
        await this.trashImportedFiles([imported]);
        new Notice(this.t("noticeImportedToEagle", { name: imported.sourceFile.name }));
      }
    
      getImportableAttachmentAtCursor(editor, view) {
        if (!editor || !view || !view.file) return null;
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        const links = this.findLocalAttachmentLinks(lineText, view.file)
          .filter(link => link.start <= cursor.ch && cursor.ch <= link.end);
        return links.length ? { cursor, lineText, link: links[0] } : null;
      }
    
      async importAttachmentLinks(context, links, internetLinks = [], options = {}) {
        const replacements = [];
        const importedFiles = [];
        const importedByPath = options.importedByPath instanceof Map
          ? options.importedByPath
          : new Map();
        const importedByUrl = options.importedByUrl instanceof Map
          ? options.importedByUrl
          : new Map();
        const sourceText = options.sourceText !== undefined
          ? options.sourceText
          : await this.app.vault.read(context.file);
        let success = 0;
        let failed = 0;
        let reused = 0;
    
        for (const link of links) {
          try {
            const importKey = link.file instanceof TFile ? link.file.path : link.localPath;
            if (!importKey) throw new Error("无法确定本地附件路径。");
            let imported = importedByPath.get(importKey);
            if (imported) {
              reused += 1;
              const item = await this.ensureImportedEagleItemTags(context, imported.item);
              imported = { ...imported, item };
              importedByPath.set(importKey, imported);
            } else {
              imported = await this.importOneAttachment(context, link);
              if (imported) {
                importedByPath.set(importKey, imported);
                if (imported.sourceFile instanceof TFile) importedFiles.push(imported);
              }
            }
            if (!imported) {
              failed += 1;
              continue;
            }
            const sizedReplacement = preserveAttachmentDisplaySize(link.original, imported.replacement);
            replacements.push({
              start: link.start,
              end: link.end,
              value: makeMarkdownTableSafeReference(sourceText, link.start, sizedReplacement)
            });
            success += 1;
          } catch (error) {
            console.warn("Failed to import attachment:", link, error);
            failed += 1;
          }
        }
    
        for (const link of internetLinks) {
          try {
            const importKey = link.url;
            let imported = importedByUrl.get(importKey);
            if (imported) {
              reused += 1;
              const item = await this.ensureImportedEagleItemTags(context, imported.item);
              imported = { ...imported, item };
              importedByUrl.set(importKey, imported);
            } else {
              imported = await this.importOneInternetAttachment(context, link);
              if (imported) {
                importedByUrl.set(importKey, imported);
              }
            }
            if (!imported) {
              failed += 1;
              continue;
            }
            const sizedReplacement = preserveAttachmentDisplaySize(link.original, imported.replacement);
            replacements.push({
              start: link.start,
              end: link.end,
              value: makeMarkdownTableSafeReference(sourceText, link.start, sizedReplacement)
            });
            success += 1;
          } catch (error) {
            console.warn("Failed to import internet attachment:", link, error);
            failed += 1;
          }
        }
    
        if (replacements.length) {
          let text = sourceText;
          replacements.sort((a, b) => b.start - a.start);
          for (const replacement of replacements) {
            text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
          }
          const normalizedText = await this.normalizeEagleBridgeReferenceLabels(context, text);
          await this.app.vault.modify(context.file, normalizedText);
          await this.trashImportedFiles(importedFiles);
        } else {
          // A prior URL import may already be an Eagle link with a stale network
          // label. "Import attachments" is also the safe manual way to update it.
          const normalizedText = await this.normalizeEagleBridgeReferenceLabels(context, sourceText);
          if (normalizedText !== sourceText) await this.app.vault.modify(context.file, normalizedText);
        }
    
        if (!options.silent) {
          new Notice(this.t("noticeProcessedAttachments", { success, reused, failed }));
        }
        return { success, reused, failed };
      }
    
      async importOneAttachment(context, link) {
        const externalPath = String(link && link.localPath || "");
        const sourceFile = link.file instanceof TFile
          ? link.file
          : { name: link.name || nodePath.basename(externalPath), path: externalPath };
        const fullPath = link.file instanceof TFile ? this.getFullPath(sourceFile) : externalPath;
        if (!fullPath) {
          new Notice(this.t("noticeCannotResolvePath", { path: sourceFile.path }));
          return null;
        }
    
        const tags = this.getImportContextTags(context);
        const reusable = await this.findReusableEagleItemForLocalAttachment(sourceFile, fullPath);
        if (reusable.cancelled) return null;
    
        let item = reusable.item;
        if (!item) {
          const name = stripExtension(sourceFile.name);
          const addResult = await this.addPathToEagle(await this.withContextEagleFolder({
            path: fullPath,
            name,
            tags,
            annotation: `Imported from Obsidian note: ${context.file.path}`
          }, context));
          item = await this.findImportedEagleItem(sourceFile, tags, addResult);
        }
    
        item = await this.ensureImportedEagleItemTags(context, item);
        // Import endpoints may return only partial item data. Read Eagle's stored
        // metadata before composing Markdown so the visible filename is canonical.
        item = await this.getAuthoritativeEagleItem(item);
        item = await this.ensureContextEagleFolder(context, item);
        const itemId = getEagleItemId(item);
        const bridgeUrl = this.getEagleBridgeUrl(item);
        const url = await this.getEagleItemEmbedUrl(item);
        if (!bridgeUrl && !url) {
          new Notice(this.t("noticeNoEmbedUrl", { name: sourceFile.name }));
          return null;
        }
    
        return {
          item,
          sourceFile,
          replacement: this.buildReplacement(sourceFile, {
            displayName: this.getCanonicalEagleFileName(item, sourceFile.name),
            itemId,
            bridgeUrl: bridgeUrl || url,
            url
          })
        };
      }
    
      async findReusableEagleItemForLocalAttachment(sourceFile, fullPath) {
        const sourceName = String(sourceFile && sourceFile.name || "");
        const baseName = stripExtension(sourceName).trim();
        const expectedExtension = normalizeExtension(nodePath.extname(sourceName));
        if (!sourceName || !expectedExtension) return { item: null, cancelled: false };
    
        let sourceSize = 0;
        try {
          sourceSize = Number(nodeFs.statSync(fullPath).size) || 0;
        } catch (error) {
          console.warn("Could not read local attachment size before Eagle import:", error);
          return { item: null, cancelled: false };
        }
    
        const exactContentMatches = await this.findEagleItemsByContentHash(fullPath, sourceSize, expectedExtension);
        if (exactContentMatches.length) {
          return this.chooseReusableEagleItem(
            exactContentMatches,
            "Eagle 中找到内容完全相同的素材。将复用选中的旧素材，并同步当前笔记的标签、文件夹与引用链接。"
          );
        }
    
        if (!baseName) return { item: null, cancelled: false };
        const listed = await this.queryEagleItemsByKeyword(baseName);
        const confirmed = [];
        const ambiguous = [];
        for (const listedItem of listed) {
          const candidateId = stripInfoSuffix(getEagleItemId(listedItem));
          if (!candidateId || isEagleItemTrashed(listedItem)) continue;
    
          const candidate = await this.queryEagleItemInfo(candidateId, { force: true }) || listedItem;
          if (isEagleItemTrashed(candidate)) continue;
          if (!isLikelySameAssetByName(candidate, baseName)) continue;
          if (normalizeExtension(getAssetExtension(candidate)) !== expectedExtension) continue;
          if (!await this.hasEagleItemOriginalFile(candidate)) continue;
    
          const signature = getEagleItemMatchSignature(candidate);
          const candidateSize = Number(signature && signature.size) || 0;
          if (sourceSize && candidateSize) {
            if (candidateSize === sourceSize) confirmed.push(candidate);
          } else {
            ambiguous.push(candidate);
          }
        }
    
        const candidates = uniqueItemsById([...confirmed, ...ambiguous]);
        if (!candidates.length) return { item: null, cancelled: false };
        return this.chooseReusableEagleItem(
          candidates,
          "Eagle 中找到名称、扩展名与大小相符的素材。请选择正确项目；取消后不会导入新副本。",
          candidates.length === 1 && confirmed.length === 1
        );
      }
    
      async findEagleItemsByContentHash(fullPath, sourceSize, extension) {
        try {
          const hash = await this.getLocalFileContentHash(fullPath);
          return await this.findEagleItemsByContentSignature({ hash, size: sourceSize, extension });
        } catch (error) {
          console.warn("Eagle content-hash duplicate lookup unavailable; using name fallback:", error);
          return [];
        }
      }
    
      async findEagleItemsByContentSignature({ hash, size, extension }) {
        if (!hash || !size) return [];
    
        await this.syncCompanionMediaService();
        const payload = await this.requestEagleHelperJson("item/find-by-content-hash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hash,
            size,
            extension,
            algorithm: "sha256"
          })
        });
    
        const helperItems = payload.data && Array.isArray(payload.data.items)
          ? payload.data.items
          : Array.isArray(payload.data)
            ? payload.data
            : Array.isArray(payload.items)
              ? payload.items
              : [];
        const resolved = [];
        for (const helperItem of helperItems) {
          const itemId = stripInfoSuffix(getEagleItemId(helperItem));
          if (!itemId || isEagleItemTrashed(helperItem)) continue;
          const item = await this.queryEagleItemInfo(itemId, { force: true }) || helperItem;
          if (!isEagleItemTrashed(item)) resolved.push(item);
        }
        return uniqueItemsById(resolved)
          .sort((a, b) => getItemTime(a) - getItemTime(b));
      }
    
      async getLocalFileContentHash(fullPath, algorithm = "sha256") {
        return new Promise((resolve, reject) => {
          const hash = nodeCrypto.createHash(algorithm);
          const stream = nodeFs.createReadStream(fullPath);
          stream.on("error", reject);
          stream.on("data", chunk => hash.update(chunk));
          stream.on("end", () => resolve(hash.digest("hex")));
        });
      }
    
      async getInternetContentSignature(url, extension) {
        if (!url) return null;
    
        const response = await requestUrl({ url, method: "GET" });
        const arrayBuffer = response && response.arrayBuffer;
        if (!arrayBuffer || !arrayBuffer.byteLength) return null;
    
        const bytes = Buffer.from(arrayBuffer);
        // Avoid keeping unexpectedly large remote downloads in the Obsidian process.
        if (bytes.byteLength > 50 * 1024 * 1024) return null;
        return {
          hash: nodeCrypto.createHash("sha256").update(bytes).digest("hex"),
          size: bytes.byteLength,
          extension: normalizeExtension(extension)
        };
      }
    
      getInternetAttachmentExtension(link) {
        const labeledName = String(link && link.name || "");
        let urlPath = "";
        try {
          urlPath = new URL(String(link && link.url || "")).pathname;
        } catch (_) {
          urlPath = String(link && link.url || "").split("?")[0];
        }
        return normalizeExtension(nodePath.extname(labeledName) || nodePath.extname(urlPath));
      }
    
      async chooseReusableEagleItem(candidates, description, autoReuseSingle = true) {
        if (!candidates.length) return { item: null, cancelled: false };
        if (candidates.length === 1 && autoReuseSingle) {
          return { item: candidates[0], cancelled: false };
        }
    
        const choice = await chooseInObsidianModal(
          this.app,
          "选择要复用的 Eagle 素材",
          description,
          candidates.map((candidate, index) => {
            const signature = getEagleItemMatchSignature(candidate);
            const dimensions = signature && signature.width && signature.height
              ? `${signature.width} x ${signature.height}`
              : "尺寸未知";
            const size = signature && signature.size
              ? `${Math.round(signature.size / 1024)} KB`
              : "大小未知";
            return {
              value: getEagleItemId(candidate),
              label: `${getAssetDisplayName(candidate)} · ${dimensions} · ${size} · ${getEagleItemId(candidate)}`,
              cta: index === 0
            };
          }),
          "取消导入"
        );
        if (!choice) return { item: null, cancelled: true };
        return {
          item: candidates.find(candidate => String(getEagleItemId(candidate)) === String(choice)) || null,
          cancelled: false
        };
      }
    
      async importOneInternetAttachment(context, link) {
        const tags = this.getImportContextTags(context);
        const fileName = link.name || nodePath.basename(String(link.url).split("?")[0]) || "internet-image";
        const name = stripExtension(fileName);
        const extension = this.getInternetAttachmentExtension(link);
    
        // Eagle's addFromURL duplicate dialog does not return the surviving item ID.
        // Resolve byte-identical remote assets before calling Eagle so a duplicate never
        // enters that ambiguous state and the note can only receive a verified ID.
        let item = null;
        let contentSignature = null;
        try {
          contentSignature = await this.getInternetContentSignature(link.url, extension);
          if (contentSignature) {
            const matches = await this.findEagleItemsByContentSignature(contentSignature);
            if (matches.length) item = matches[0];
          }
        } catch (error) {
          console.warn("Network attachment content lookup failed; Eagle will import normally:", error);
        }
    
        if (!item) {
          const addResult = await this.addUrlToEagle(await this.withContextEagleFolder({
            url: link.url,
            name,
            tags,
            annotation: `Imported from internet URL in Obsidian note: ${context.file.path}`
          }, context));
          item = await this.resolveInternetItemAfterAdd(addResult, contentSignature);
          if (!item) {
            new Notice("Eagle 未返回可验证的网络素材 ID。为避免误替换，已保留原网络链接。");
            return null;
          }
        }
    
        item = await this.ensureImportedEagleItemTags(context, item);
        // addFromURL frequently returns an id/url stub instead of the final item
        // filename. Always fetch the stored Eagle record before creating Markdown.
        item = await this.getAuthoritativeEagleItem(item);
        const itemId = getEagleItemId(item);
        const bridgeUrl = this.getEagleBridgeUrl(item);
        const url = await this.getEagleItemEmbedUrl(item);
        if (!bridgeUrl && !url) {
          new Notice(this.t("noticeNoEmbedUrl", { name: link.name || link.url }));
          return null;
        }
    
        return {
          item,
          replacement: this.buildReplacement({ basename: name, name: link.name || name }, {
            displayName: this.getCanonicalEagleFileName(item, fileName || link.name || name),
            itemId,
            bridgeUrl: bridgeUrl || url,
            url
          })
        };
      }
    
      async addPathToEagle(data) {
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        const response = await requestUrl({
          url: `${base}/api/item/addFromPath`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        const body = response.json;
        if (body && body.status && body.status !== "success") {
          throw new Error(body.message || "Eagle addFromPath failed.");
        }
        return body;
      }
    
      withEagleFolder(data, folderIdOverride = null) {
        const folderId = String(folderIdOverride || this.settings.eagleFolderId || "").trim();
        if (!folderId) return data;
        return Object.assign({}, data, {
          folderId,
          folderID: folderId
        });
      }
    
      async withContextEagleFolder(data, context, options = {}) {
        const folderId = await this.resolveEagleFolderIdForContext(context, {
          createMissing: options.createMissing !== false && this.settings.autoFolderOnImport !== false
        });
        return this.withEagleFolder(data, folderId);
      }
    
      // Folder names share the stable note/Canvas identity used by tags. This
      // prevents ordinary same-title notes from being merged into one Eagle folder.
      async getManagedEagleFolderPathForContext(context) {
        if (!context || !(context.file instanceof TFile)) return "";
        const identity = String(context.identity || await this.getEagleFolderIdentityForFile(context.file) || "").trim();
        return this.buildManagedEagleFolderPath(context.file.path, identity);
      }
    
      async getEagleFolderIdentityForFile(file) {
        if (!(file instanceof TFile)) return "";
        return file.extension === "canvas"
          ? this.getCanvasIdentity(file)
          : this.getNoteIdentity(file);
      }
    
      buildManagedEagleFolderPath(filePath, identity) {
        const title = normalizeIdentityTitle(stripExtension(vaultPathBasename(filePath)));
        const date = (String(identity || "").match(/-(\d{8})$/) || [])[1] || formatIdentityDate(new Date());
        const leaf = this.renderEagleFolderName(title, date);
        if (!leaf) return "";
        if (this.settings.useObsidianFolderTree !== true) return leaf;
        const parent = getSourceParentPathFromPath(filePath);
        return parent ? `${parent}/${leaf}` : leaf;
      }
    
      renderEagleFolderName(title, createdDate) {
        const cleanTitle = normalizeIdentityTitle(title) || "note";
        const cleanDate = isIdentityDate(createdDate) ? String(createdDate) : formatIdentityDate(new Date());
        const template = String(this.settings.eagleFolderNameTemplate || DEFAULT_SETTINGS.eagleFolderNameTemplate).trim()
          || DEFAULT_SETTINGS.eagleFolderNameTemplate;
        const rendered = template
          .replace(/\{\{\s*title\s*\}\}/gi, cleanTitle)
          .replace(/\{\{\s*created\s*\}\}/gi, cleanDate)
          .replace(/\{\{[^{}]*\}\}/g, "");
        return normalizeIdentityTitle(rendered) || buildTitleDateIdentity(cleanTitle, cleanDate);
      }
    
      async resolveEagleFolderIdForContext(context, options = {}) {
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (this.settings.folderManagementEnabled === false) return rootId;
        if (!rootId || !context || !(context.file instanceof TFile)) return rootId;
    
        const targetPath = await this.getManagedEagleFolderPathForContext(context);
        if (!targetPath) return rootId;
    
        const createMissing = options.createMissing !== false;
        const folderId = await this.resolveEagleFolderIdForVaultPath(targetPath, rootId, true, createMissing);
        if (folderId && folderId !== rootId) {
          await this.rememberManagedEagleFolderForSource(context.file.path, folderId, rootId, targetPath);
        }
        return folderId || rootId;
      }
    
      async rememberManagedEagleFolderForSource(sourcePath, folderId, rootId, folderPath = "") {
        const cleanSourcePath = normalizeVaultPath(sourcePath);
        const cleanFolderId = String(folderId || "").trim();
        const cleanRootId = String(rootId || this.settings.eagleFolderId || "").trim();
        if (!cleanSourcePath || !cleanFolderId || !cleanRootId) return;
        if (!this.settings.managedEagleFoldersBySource || typeof this.settings.managedEagleFoldersBySource !== "object") {
          this.settings.managedEagleFoldersBySource = {};
        }
        const next = {
          id: cleanFolderId,
          rootId: cleanRootId,
          path: normalizeVaultPath(folderPath)
        };
        const previous = this.settings.managedEagleFoldersBySource[cleanSourcePath];
        if (previous && previous.id === next.id && previous.rootId === next.rootId && previous.path === next.path) return;
        this.settings.managedEagleFoldersBySource[cleanSourcePath] = next;
        await this.saveSettings();
      }
    
      async resolveEagleFolderIdForVaultPath(vaultPath, rootId = null, remember = true, createMissing = true) {
        const cleanRootId = String(rootId || this.settings.eagleFolderId || "").trim();
        const targetPath = normalizeVaultPath(vaultPath);
        if (!cleanRootId || !targetPath) return cleanRootId;
        try {
          const folders = await this.queryEagleFolders();
          const root = findEagleFolderById(folders, cleanRootId);
          if (!root) return cleanRootId;
    
          let current = root;
          let currentPath = "";
          for (const segment of targetPath.split("/").map(part => part.trim()).filter(Boolean)) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const children = Array.isArray(current.children) ? current.children : [];
            const existing = children.find(folder => normalizeFolderName(folder && folder.name) === normalizeFolderName(segment));
            if (existing) {
              current = existing;
              if (remember) await this.rememberManagedEagleFolder(currentPath, current, cleanRootId);
              continue;
            }
            if (!createMissing) return null;
            const created = await this.createEagleFolder(segment, current.id || cleanRootId);
            if (!created || !created.id) return cleanRootId;
            children.push(created);
            current = created;
            if (remember) await this.rememberManagedEagleFolder(currentPath, current, cleanRootId);
          }
          return current && current.id ? current.id : cleanRootId;
        } catch (error) {
          console.warn("Failed to resolve Eagle folder for Obsidian path:", error);
          return cleanRootId;
        }
      }
    
      async findExistingEagleFolderForVaultPath(vaultPath, rootId = null) {
        const cleanRootId = String(rootId || this.settings.eagleFolderId || "").trim();
        const targetPath = normalizeVaultPath(vaultPath);
        if (!cleanRootId || !targetPath) return null;
        const folders = await this.queryEagleFolders();
        const root = findEagleFolderById(folders, cleanRootId);
        if (!root) return null;
    
        let current = root;
        for (const segment of targetPath.split("/").map(part => part.trim()).filter(Boolean)) {
          const children = Array.isArray(current.children) ? current.children : [];
          const next = children.find(folder => normalizeFolderName(folder && folder.name) === normalizeFolderName(segment));
          if (!next) return null;
          current = next;
        }
        return current && current.id ? current : null;
      }
    
      async rememberManagedEagleFolder(obsidianPath, folder, rootId) {
        if (!obsidianPath || !folder || !folder.id) return;
        if (!this.settings.managedEagleFolders || typeof this.settings.managedEagleFolders !== "object") {
          this.settings.managedEagleFolders = {};
        }
        const key = normalizeVaultPath(obsidianPath);
        const next = {
          id: String(folder.id),
          name: String(folder.name || nodePath.basename(key)),
          rootId: String(rootId || this.settings.eagleFolderId || "")
        };
        const previous = this.settings.managedEagleFolders[key];
        if (previous && previous.id === next.id && previous.name === next.name && previous.rootId === next.rootId) return;
        this.settings.managedEagleFolders[key] = next;
        await this.saveSettings();
      }
    
      async syncManagedEagleFolderRename(file, oldPath) {
        if (this.settings.folderManagementEnabled === false) return;
        if (!file || !oldPath) return;
        if (!this.settings.managedEagleFolders || typeof this.settings.managedEagleFolders !== "object") return;
    
        const useTree = this.settings.useObsidianFolderTree === true;
        const currentIdentity = await this.getEagleFolderIdentityForFile(file);
        const identityDate = (String(currentIdentity).match(/-(\d{8})$/) || [])[1] || getFileIdentityDate(file);
        const oldBaseName = stripExtension(nodePath.basename(String(oldPath || "")));
        const oldIdentity = buildTitleDateIdentity(normalizeIdentityTitle(oldBaseName), identityDate);
        const oldFolderPath = file instanceof TFile
          ? this.buildManagedEagleFolderPath(oldPath, oldIdentity)
          : (useTree ? normalizeVaultPath(oldPath) : "");
        const newFolderPath = file instanceof TFile
          ? this.buildManagedEagleFolderPath(file.path, currentIdentity)
          : (useTree ? normalizeVaultPath(file.path) : "");
        if (!oldFolderPath || !newFolderPath || oldFolderPath === newFolderPath) return;
    
        // Newer releases remember the exact Eagle folder used by a source file.
        // Prefer that stable ID over reconstructing a path from a possibly changed
        // naming rule. Parent moves remain deliberately conservative because the
        // verified Eagle API only supports folder renames, not moves.
        const oldSourcePath = normalizeVaultPath(oldPath);
        const newSourcePath = normalizeVaultPath(file.path);
        const sourceRecords = this.settings.managedEagleFoldersBySource || {};
        const sourceRecord = file instanceof TFile ? sourceRecords[oldSourcePath] : null;
        if (sourceRecord && sourceRecord.id && String(sourceRecord.rootId || "") === String(this.settings.eagleFolderId || "")) {
          const folders = await this.queryEagleFolders();
          const current = findEagleFolderWithParentById(folders, sourceRecord.id);
          const targetParentPath = getSourceParentPathFromPath(newFolderPath);
          const targetParentId = targetParentPath
            ? await this.resolveEagleFolderIdForVaultPath(targetParentPath, this.settings.eagleFolderId, false, true)
            : String(this.settings.eagleFolderId || "");
          if (current && current.folder && String(current.parentId || "") === String(targetParentId || "")) {
            const newName = vaultPathBasename(newFolderPath);
            if (normalizeFolderName(current.folder.name) !== normalizeFolderName(newName)) {
              const updated = await this.updateEagleFolderName(sourceRecord.id, newName);
              if (!updated) return;
            }
            delete this.settings.managedEagleFoldersBySource[oldSourcePath];
            this.settings.managedEagleFoldersBySource[newSourcePath] = {
              id: String(sourceRecord.id),
              rootId: String(sourceRecord.rootId),
              path: normalizeVaultPath(newFolderPath)
            };
            delete this.settings.managedEagleFolders[oldFolderPath];
            this.settings.managedEagleFolders[newFolderPath] = {
              id: String(sourceRecord.id),
              name: newName,
              rootId: String(sourceRecord.rootId)
            };
            await this.saveSettings();
            return;
          }
        }
    
        const updates = [];
        const entries = Object.entries(this.settings.managedEagleFolders);
        for (const [path, record] of entries) {
          if (path !== oldFolderPath && !path.startsWith(`${oldFolderPath}/`)) continue;
          const suffix = path === oldFolderPath ? "" : path.slice(oldFolderPath.length);
          const nextPath = `${newFolderPath}${suffix}`;
          updates.push({ oldPath: path, nextPath, record });
        }
        let exact = updates.find(update => update.oldPath === oldFolderPath);
        if (!exact) {
          const fallbackFolder = await this.findExistingEagleFolderForVaultPath(oldFolderPath, this.settings.eagleFolderId);
          if (fallbackFolder && fallbackFolder.id) {
            exact = {
              oldPath: oldFolderPath,
              nextPath: newFolderPath,
              record: {
                id: String(fallbackFolder.id),
                name: String(fallbackFolder.name || vaultPathBasename(oldFolderPath)),
                rootId: String(this.settings.eagleFolderId || "")
              }
            };
            updates.push(exact);
          }
        }
        if (!updates.length) return;
    
        if (exact && exact.record && exact.record.id) {
          const newName = vaultPathBasename(newFolderPath);
          const newParentPath = getSourceParentPathFromPath(newFolderPath);
          const oldParentPath = getSourceParentPathFromPath(oldFolderPath);
          if (newParentPath && newParentPath !== oldParentPath) {
            console.warn("Eagle folder parent move is not supported by the verified local API; rename sync skipped for moved path.");
            return;
          }
          const updated = await this.updateEagleFolderName(exact.record.id, newName);
          if (!updated) return;
          exact.record = Object.assign({}, exact.record, { name: newName });
        }
    
        for (const update of updates) {
          delete this.settings.managedEagleFolders[update.oldPath];
        }
        for (const update of updates) {
          this.settings.managedEagleFolders[update.nextPath] = update.record;
        }
        await this.saveSettings();
      }
    
      async queryEagleFolders() {
        const now = Date.now();
        if (this.eagleFolderCache && now - this.eagleFolderCache.time < 30000) {
          return this.eagleFolderCache.folders;
        }
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        const response = await requestUrl({
          url: `${base}/api/folder/list`,
          method: "GET"
        });
        const body = response.json;
        if (body && body.status && body.status !== "success") {
          throw new Error(body.message || "Eagle folder/list failed.");
        }
        const folders = Array.isArray(body && body.data) ? body.data : [];
        this.eagleFolderCache = { time: now, folders };
        return folders;
      }
    
      async createEagleFolder(name, parentId) {
        const cleanName = String(name || "").trim();
        const cleanParentId = String(parentId || "").trim();
        if (!cleanName || !cleanParentId) return null;
    
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        try {
          const response = await requestUrl({
            url: `${base}/api/folder/create`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderName: cleanName,
              parent: cleanParentId
            })
          });
          const body = response.json;
          if (body && body.status && body.status !== "success") {
            throw new Error(body.message || "Eagle folder/create failed.");
          }
          this.eagleFolderCache = null;
          const data = body && body.data ? body.data : null;
          if (data && data.id) return normalizeCreatedEagleFolder(data, cleanName);
    
          const folders = await this.queryEagleFolders();
          const parent = findEagleFolderById(folders, cleanParentId);
          const children = parent && Array.isArray(parent.children) ? parent.children : [];
          return children.find(folder => normalizeFolderName(folder && folder.name) === normalizeFolderName(cleanName)) || null;
        } catch (error) {
          console.warn(`Failed to create Eagle folder "${cleanName}":`, error);
          return null;
        }
      }
    
      async updateEagleFolderName(folderId, name, parentId = null) {
        const cleanId = String(folderId || "").trim();
        const cleanName = String(name || "").trim();
        const cleanParentId = String(parentId || "").trim();
        if (!cleanId || !cleanName) return null;
    
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        const baseBodies = [
          { folderId: cleanId, newName: cleanName },
          { folderID: cleanId, newName: cleanName }
        ];
        const bodies = cleanParentId
          ? baseBodies.flatMap(body => [
            Object.assign({}, body, { parent: cleanParentId }),
            Object.assign({}, body, { parentId: cleanParentId }),
            Object.assign({}, body, { parentID: cleanParentId })
          ])
          : baseBodies;
        let lastError = null;
        for (const body of bodies) {
          try {
            const response = await requestUrl({
              url: `${base}/api/folder/update`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const result = response.json;
            if (!result || !result.status || result.status === "success") {
              this.eagleFolderCache = null;
              const verified = await this.verifyEagleFolderUpdate(cleanId, cleanName, cleanParentId);
              if (verified) return result || { status: "success" };
              lastError = new Error("Eagle folder/update returned success but verification failed.");
              continue;
            }
            lastError = new Error(result.message || "Eagle folder/update failed.");
          } catch (error) {
            lastError = error;
          }
        }
        console.warn(`Failed to update Eagle folder "${cleanId}" name to "${cleanName}":`, lastError);
        return null;
      }
    
      async verifyEagleFolderUpdate(folderId, expectedName, expectedParentId = "") {
        try {
          const folders = await this.queryEagleFolders();
          const info = findEagleFolderWithParentById(folders, folderId);
          if (!info || !info.folder) return false;
          if (normalizeFolderName(info.folder.name) !== normalizeFolderName(expectedName)) return false;
          if (expectedParentId && String(info.parentId || "") !== String(expectedParentId)) return false;
          return true;
        } catch (error) {
          console.warn("Failed to verify Eagle folder update:", error);
          return false;
        }
      }
    
      async addUrlToEagle(data) {
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        const requestBody = JSON.stringify(data);
        let lastError = null;
        for (const endpoint of ["addFromURL", "addFromPath"]) {
          try {
            const response = await requestUrl({
              url: `${base}/api/item/${endpoint}`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: requestBody
            });
            const body = response.json;
            if (body && body.status === "success") return body;
            lastError = new Error((body && body.message) || `${endpoint} failed.`);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error("Eagle URL import failed.");
      }
    
      async findImportedEagleItem(sourceFile, tags, addResult) {
        const resultItem = await this.getItemFromAddResult(addResult);
        if (resultItem) return resultItem;
    
        const baseName = stripExtension(sourceFile.name).toLowerCase();
        for (let attempt = 0; attempt < 10; attempt += 1) {
          for (const tag of tags) {
            const items = await this.queryEagleItemsByTag(tag);
            const sorted = items.slice().sort((a, b) => (getItemTime(b) - getItemTime(a)));
            const exact = sorted.find(item => String(item.name || "").toLowerCase() === baseName);
            if (exact) return exact;
          }
          await sleep(300);
        }
        const nameMatches = await this.queryEagleItemsByKeyword(baseName);
        const sortedMatches = nameMatches
          .filter(item => String(item.name || "").toLowerCase() === baseName)
          .sort((a, b) => (getItemTime(b) - getItemTime(a)));
        if (sortedMatches[0]) return sortedMatches[0];
        return null;
      }
    
      async resolveInternetItemAfterAdd(addResult, contentSignature) {
        const directItem = await this.getItemFromAddResult(addResult);
        if (directItem) return directItem;
    
        // Eagle's addFromURL can acknowledge the request before it exposes an item
        // object. Only match by the exact downloaded bytes afterwards: a generic tag
        // lookup could accidentally select a different asset from the same note.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (contentSignature) {
            try {
              const matches = await this.findEagleItemsByContentSignature(contentSignature);
              if (matches.length) return matches[0];
            } catch (error) {
              console.warn("Unable to resolve Eagle URL import by content signature:", error);
            }
          }
    
          await sleep(350);
        }
        return null;
      }
    
      async getItemFromAddResult(addResult) {
        const queue = [addResult && Object.prototype.hasOwnProperty.call(addResult, "data") ? addResult.data : addResult];
        const seen = new Set();
        let direct = null;
        let id = "";
    
        while (queue.length) {
          const value = queue.shift();
          if (value == null) continue;
          if (typeof value === "string" || typeof value === "number") {
            id = String(value).trim();
            if (id) break;
            continue;
          }
          if (typeof value !== "object" || seen.has(value)) continue;
          seen.add(value);
          if (Array.isArray(value)) {
            queue.push(...value);
            continue;
          }
          if (value.fileURL || value.thumbnailURL || value.url) {
            direct = value;
            break;
          }
          id = String(value.id || value.itemId || value.itemID || value.item_id || "").trim();
          if (id) break;
          for (const key of ["item", "items", "result", "data", "file", "asset"]) {
            if (value[key] != null) queue.push(value[key]);
          }
        }
    
        if (direct) return direct;
        if (!id) return null;
        const item = await this.queryEagleItemInfo(id);
        return item || { id };
      }
    
      async ensureImportedEagleItemTags(context, item) {
        const itemId = getEagleItemId(item);
        const tags = this.getImportContextTags(context);
        if (!itemId || !tags.length) return item;
    
        const detailedItem = await this.queryEagleItemInfo(itemId) || item;
        const existingTags = Array.isArray(detailedItem && detailedItem.tags) ? detailedItem.tags : [];
        const removableTags = this.getRemovableTagsForContext(context, existingTags);
        const keptTags = existingTags.filter(tag => !removableTags.includes(tag));
        const mergedTags = Array.from(new Set([...keptTags, ...tags]));
        const alreadySynced = mergedTags.length === existingTags.length && mergedTags.every(tag => existingTags.includes(tag));
        if (!alreadySynced) {
          await this.updateEagleItemTags(itemId, mergedTags);
          return await this.queryEagleItemInfo(itemId) || Object.assign({}, detailedItem, { tags: mergedTags });
        }
        return detailedItem;
      }
    
      invalidateEagleItemInfo(itemId) {
        this.eagleItems.invalidate(itemId);
      }
    
      async queryEagleItemInfo(itemId, options = {}) {
        return this.eagleItems.get(itemId, options);
      }
    
      async syncCurrentNoteEagleBridgeLinkTags(context, existingText = null, showNotice = true) {
        if (this.settings.tagManagementEnabled === false) return;
        try {
          const text = existingText !== null ? existingText : await this.app.vault.read(context.file);
          const itemIds = this.extractEagleBridgeItemIds(text);
          if (!itemIds.length) return;
    
          const updated = await this.syncEagleBridgeItemTags(context, itemIds, showNotice);
          if (updated && showNotice) {
            new Notice(this.t("noticeSyncedTags", { count: updated }));
          }
        } catch (error) {
          console.warn("Failed to sync EagleBridge link tags:", error);
        }
      }
    
      async syncEagleBridgeItemTags(context, itemIds, showNotice = true) {
        if (this.settings.tagManagementEnabled === false) return 0;
        let updated = 0;
        const uniqueIds = Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean)));
        for (const itemId of uniqueIds) {
          const item = await this.queryEagleItemInfo(itemId);
          if (!item) continue;
          const existingTags = Array.isArray(item && item.tags) ? item.tags : [];
          const removableTags = this.getRemovableTagsForContext(context, existingTags);
          const keptTags = existingTags.filter(tag => !removableTags.includes(tag));
          const mergedTags = Array.from(new Set([...keptTags, ...context.tags]));
          if (mergedTags.length === existingTags.length && mergedTags.every(tag => existingTags.includes(tag))) {
            continue;
          }
          await this.updateEagleItemTags(itemId, mergedTags);
          updated += 1;
        }
        return updated;
      }
    
      async findConservativeDuplicateCandidates(ref, currentItem, context = null) {
        const labelName = cleanEagleBridgeLabel(ref.label);
        const searchNames = getDuplicateRepairSearchNames(labelName || getAssetDisplayName(currentItem));
        if (!searchNames.length) return [];
    
        const candidates = await this.queryEagleItemsByKeywords(searchNames);
        const currentSignature = getEagleItemMatchSignature(currentItem);
        const expectedExtension = getDuplicateRepairExpectedExtension(
          labelName,
          currentItem ? getAssetDisplayName(currentItem) : "",
          currentItem ? getAssetExtension(currentItem) : ""
        );
        const matches = [];
    
        for (const candidate of candidates) {
          const candidateId = getEagleItemId(candidate);
          if (!candidateId || candidateId === ref.id) continue;
          if (isEagleItemTrashed(candidate)) continue;
          if (!isLikelySameAssetByAnyName(candidate, searchNames)) continue;
          if (expectedExtension && normalizeExtension(getAssetExtension(candidate)) !== expectedExtension) continue;
          if (currentSignature && !isSameEagleAssetSignature(currentSignature, getEagleItemMatchSignature(candidate))) continue;
          if (!await this.hasEagleItemOriginalFile(candidate)) continue;
          matches.push(candidate);
        }
    
        return uniqueItemsById(matches);
      }
    
      async hasEagleItemOriginalFile(item) {
        const thumbnailUrl = await this.getEagleItemThumbnailUrl(item);
        const thumbnailPath = fileUrlToLocalPath(thumbnailUrl) || eagleLocalPathToFsPath(thumbnailUrl);
        if (!thumbnailPath) return false;
    
        const infoDir = nodePath.dirname(thumbnailPath);
        let names = [];
        try {
          names = nodeFs.readdirSync(infoDir);
        } catch (error) {
          return false;
        }
    
        const expectedExtension = normalizeExtension(getAssetExtension(item));
        return names.some(name => {
          if (!name || /^metadata(?:-|\.)/i.test(name)) return false;
          if (/_thumbnail\.[^.]+$/i.test(name)) return false;
          const extension = normalizeExtension(nodePath.extname(name));
          return expectedExtension ? extension === expectedExtension : !!extension;
        });
      }
    
      async removeEagleTagsFromItemIds(itemIds, tagsToClean) {
        if (this.settings.tagManagementEnabled === false) return 0;
        const tagSet = new Set((tagsToClean || []).map(tag => String(tag || "").trim()).filter(Boolean));
        if (!tagSet.size) return 0;
    
        let updated = 0;
        const uniqueIds = Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean)));
        for (const itemId of uniqueIds) {
          const item = await this.queryEagleItemInfo(itemId);
          const existingTags = Array.isArray(item && item.tags) ? item.tags : [];
          const nextTags = existingTags.filter(tag => !tagSet.has(tag));
          if (nextTags.length === existingTags.length) continue;
          await this.updateEagleItemTags(itemId, nextTags);
          updated += 1;
        }
        return updated;
      }
    
      async clearObsidianTagsForCurrentContext(context, scope = "all") {
        if (!context || !context.file) return 0;
        const text = await this.app.vault.read(context.file);
        const itemIds = this.extractEagleBridgeItemIds(text);
        const uniqueIds = Array.from(new Set(itemIds.map(id => stripInfoSuffix(id)).filter(Boolean)));
        if (!uniqueIds.length) return 0;
        const contextTags = new Set(this.getContextTagsToClean(context));
    
        let updated = 0;
        for (const itemId of uniqueIds) {
          const item = await this.queryEagleItemInfo(itemId);
          const existingTags = Array.isArray(item && item.tags) ? item.tags : [];
          const nextTags = existingTags.filter(tag => {
            if (scope === "current") return !contextTags.has(tag);
            return !isObsidianManagedTag(tag);
          });
          if (nextTags.length === existingTags.length) continue;
          await this.updateEagleItemTags(itemId, nextTags);
          updated += 1;
        }
        return updated;
      }
    
      async clearObsidianFoldersForCurrentContext(context, scope = "all") {
        if (!context || !context.file) return { updated: 0, deletedCurrentFolder: false };
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (!rootId) return { updated: 0, deletedCurrentFolder: false };
    
        const text = await this.app.vault.read(context.file);
        const itemIds = this.extractEagleBridgeItemIds(text);
        const uniqueIds = Array.from(new Set(itemIds.map(id => stripInfoSuffix(id)).filter(Boolean)));
        const currentFolderId = await this.findExistingEagleFolderIdForContext(context);
    
        const managedFolderIds = scope === "current"
          ? [currentFolderId].filter(Boolean)
          : await this.getObsidianManagedEagleFolderIds(rootId);
    
        let updated = 0;
        if (managedFolderIds.length) {
          for (const itemId of uniqueIds) {
            const removed = await this.removeEagleItemFoldersViaHelper(itemId, managedFolderIds);
            if (removed > 0) updated += 1;
          }
        }
    
        // The current context folder is safe to remove only after all direct
        // references were detached and Eagle confirms no other item still uses it.
        const deletedCurrentFolder = currentFolderId && currentFolderId !== rootId
          ? await this.deleteEagleFolderIfEmptyViaHelper(currentFolderId)
          : false;
        return { updated, deletedCurrentFolder };
      }
    
      async collectVaultEagleBridgePlan(onProgress = null) {
        const files = this.getAllObsidianAssetSourceFiles();
        const records = [];
        const tagsByItemId = new Map();
    
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          if (typeof onProgress === "function") {
            onProgress({ completed: index, total: files.length, detail: file.path });
          }
    
          try {
            const text = await this.app.vault.read(file);
            const itemIds = Array.from(new Set(this.extractEagleBridgeItemIds(text)
              .map(id => stripInfoSuffix(id))
              .filter(Boolean)));
            if (!itemIds.length) continue;
    
            const context = await this.getAssetContext(file, false);
            if (!context) continue;
            records.push({ context, text, itemIds });
            for (const itemId of itemIds) {
              if (!tagsByItemId.has(itemId)) tagsByItemId.set(itemId, new Set());
              for (const tag of context.tags || []) {
                if (tag) tagsByItemId.get(itemId).add(tag);
              }
            }
          } catch (error) {
            console.warn("Failed to scan vault source file for Eagle rebuild:", file.path, error);
          }
    
          // Yield occasionally so the progress modal can paint during large vault scans.
          if (index % 8 === 7) await sleep(0);
        }
    
        if (typeof onProgress === "function") {
          onProgress({ completed: files.length, total: files.length, detail: "" });
        }
        return { files, records, tagsByItemId };
      }
    
      async collectManagedRootEagleItems(rootId) {
        const folderIds = await this.getObsidianManagedEagleFolderIds(rootId);
        if (!folderIds.length) return [];
        try {
          const items = await this.queryObsidianLibraryItemsViaHelper(folderIds, []);
          if (items.every(item => stripInfoSuffix(getEagleItemId(item)))) {
            return uniqueItemsById(items);
          }
          throw new Error("Eagle helper returned non-serializable item records.");
        } catch (error) {
          console.warn("Failed to collect managed Eagle items through helper:", error);
          const pager = await this.createObsidianLibraryPager();
          const items = [];
          while (true) {
            const page = await pager.nextPage(100);
            items.push(...page.items);
            if (!page.hasMore) break;
          }
          return uniqueItemsById(items);
        }
      }
    
      async collectEagleItemsForVaultPlan(plan, rootId) {
        const byId = new Map();
        for (const item of await this.collectManagedRootEagleItems(rootId)) {
          const itemId = stripInfoSuffix(getEagleItemId(item));
          if (itemId) byId.set(itemId, item);
        }
        for (const itemId of plan.tagsByItemId.keys()) {
          if (byId.has(itemId)) continue;
          const item = await this.queryEagleItemInfo(itemId);
          if (item) byId.set(itemId, item);
        }
        return Array.from(byId.values());
      }
    
      async getManagedFoldersBelowRoot(rootId) {
        const folders = await this.queryEagleFolders();
        const root = findEagleFolderById(folders, rootId);
        if (!root) return [];
        const nodes = [];
        const visit = (folder, depth) => {
          for (const child of Array.isArray(folder && folder.children) ? folder.children : []) {
            if (!child || !child.id) continue;
            visit(child, depth + 1);
            nodes.push({ id: String(child.id), depth });
          }
        };
        visit(root, 1);
        return nodes;
      }
    
      async getEagleItemsAssignedToFolder(folderId) {
        const items = [];
        let offset = 0;
        const limit = 100;
        while (true) {
          const page = await this.queryEagleItemsByFolderPage(folderId, offset, limit);
          items.push(...page);
          offset += page.length;
          if (page.length < limit) break;
          await sleep(0);
        }
        return uniqueItemsById(items);
      }
    
      recordManagedFolderForRebuild(context, folderId, rootId, folderPath) {
        if (!context || !context.file || !folderId || !rootId) return;
        const sourcePath = normalizeVaultPath(context.file.path);
        const targetPath = normalizeVaultPath(folderPath);
        const store = this._folderRebuildNextRecords || this.settings;
        if (!store.managedEagleFolders || typeof store.managedEagleFolders !== "object") store.managedEagleFolders = {};
        if (!store.managedEagleFoldersBySource || typeof store.managedEagleFoldersBySource !== "object") {
          store.managedEagleFoldersBySource = {};
        }
        store.managedEagleFolders[targetPath] = {
          id: String(folderId),
          name: vaultPathBasename(targetPath),
          rootId: String(rootId)
        };
        store.managedEagleFoldersBySource[sourcePath] = {
          id: String(folderId),
          rootId: String(rootId),
          path: targetPath
        };
      }
    
      async findLegacyManagedFolderForRebuild(record, rootId, managedFolderIds) {
        const context = record && record.context;
        if (!context || !context.file) return null;
        const sourcePath = normalizeVaultPath(context.file.path);
        const remembered = this._folderRebuildPreviousRecords || this.settings;
        const folders = await this.queryEagleFolders();
    
        const sourceRecord = remembered.managedEagleFoldersBySource && remembered.managedEagleFoldersBySource[sourcePath];
        if (sourceRecord && String(sourceRecord.rootId || "") === String(rootId || "") && managedFolderIds.has(String(sourceRecord.id))) {
          const fromSource = findEagleFolderById(folders, sourceRecord.id);
          if (fromSource) return fromSource;
        }
    
        const targetPath = await this.getManagedEagleFolderPathForContext(context);
        const exact = await this.findExistingEagleFolderForVaultPath(targetPath, rootId);
        if (exact && managedFolderIds.has(String(exact.id))) return exact;
    
        // Versions before 0.4.130 only remembered folder paths. The former default
        // naming rule was title-date, so it is a safe first migration fallback.
        const identity = String(context.identity || await this.getEagleFolderIdentityForFile(context.file) || "");
        const date = (identity.match(/-(\d{8})$/) || [])[1] || getFileIdentityDate(context.file);
        const legacyLeaf = buildTitleDateIdentity(
          normalizeIdentityTitle(stripExtension(vaultPathBasename(context.file.path))),
          date
        );
        const legacyParent = this.settings.useObsidianFolderTree === true
          ? getSourceParentPathFromPath(context.file.path)
          : "";
        const legacyPath = legacyParent ? `${legacyParent}/${legacyLeaf}` : legacyLeaf;
        const legacyRecord = remembered.managedEagleFolders && remembered.managedEagleFolders[legacyPath];
        if (legacyRecord && managedFolderIds.has(String(legacyRecord.id))) {
          const found = findEagleFolderById(folders, legacyRecord.id);
          if (found) return found;
        }
    
        // Last resort for legacy data: infer ownership from the current direct
        // references. A tie is deliberately ignored rather than renaming a folder
        // that may belong to a different note with shared assets.
        const scores = new Map();
        for (const itemId of record.itemIds || []) {
          const item = await this.queryEagleItemInfo(itemId, { force: true });
          for (const folderId of getEagleItemFolderIds(item)) {
            const cleanFolderId = String(folderId || "");
            if (!managedFolderIds.has(cleanFolderId)) continue;
            scores.set(cleanFolderId, (scores.get(cleanFolderId) || 0) + 1);
          }
        }
        const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
        if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1])) return null;
        return findEagleFolderById(folders, ranked[0][0]) || null;
      }
    
      async resolveRebuildFolderForRecord(record, rootId, managedFolderIds) {
        const context = record.context;
        const targetPath = await this.getManagedEagleFolderPathForContext(context);
        const targetName = vaultPathBasename(targetPath);
        const targetParentPath = getSourceParentPathFromPath(targetPath);
        const targetParentId = targetParentPath
          ? await this.resolveEagleFolderIdForVaultPath(targetParentPath, rootId, false, true)
          : rootId;
        const existing = await this.findLegacyManagedFolderForRebuild(record, rootId, managedFolderIds);
    
        if (existing && existing.id) {
          const folders = await this.queryEagleFolders();
          const parentInfo = findEagleFolderWithParentById(folders, existing.id);
          const sameParent = parentInfo && String(parentInfo.parentId || "") === String(targetParentId || "");
          if (sameParent) {
            if (normalizeFolderName(existing.name) !== normalizeFolderName(targetName)) {
              const renamed = await this.updateEagleFolderName(existing.id, targetName);
              if (!renamed) throw new Error(`无法重命名 Eagle 文件夹：${existing.name}`);
            }
            this.recordManagedFolderForRebuild(context, existing.id, rootId, targetPath);
            return { id: String(existing.id), reused: true, targetPath };
          }
        }
    
        const createdId = await this.resolveEagleFolderIdForVaultPath(targetPath, rootId, false, true);
        if (!createdId || createdId === rootId) {
          throw new Error(`无法创建 Eagle 专属文件夹：${targetPath}`);
        }
        this.recordManagedFolderForRebuild(context, createdId, rootId, targetPath);
        return { id: String(createdId), reused: false, targetPath };
      }
    
      async rebuildAllVaultTags() {
        if (this.settings.tagManagementEnabled === false) {
          throw new Error("标签管理当前已关闭。请先在设置中开启后再重建。");
        }
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (!rootId) {
          throw new Error("请先在设置中填写 Eagle 文件夹 ID，再执行全库标签重建。");
        }
        return this.runVaultRebuildTask({
          title: "重新生成所有标签",
          description: "正在扫描全库、清理旧的 Obsidian 管理标签，并按当前规则统一写回。",
          run: async update => {
            const plan = await this.collectVaultEagleBridgePlan(progress => {
              update({ phase: "扫描笔记和白板", ...progress });
            });
            const items = await this.collectEagleItemsForVaultPlan(plan, rootId);
            const cleanupTotal = items.length;
            let cleared = 0;
            update({ phase: "清理旧标签", completed: 0, total: cleanupTotal });
            for (let index = 0; index < items.length; index += 1) {
              const item = items[index];
              const itemId = stripInfoSuffix(getEagleItemId(item));
              if (!itemId) continue;
              const current = await this.queryEagleItemInfo(itemId, { force: true }) || item;
              const existingTags = Array.isArray(current.tags) ? current.tags : [];
              const nextTags = existingTags.filter(tag => !isObsidianManagedTag(tag));
              if (nextTags.length !== existingTags.length) {
                await this.updateEagleItemTags(itemId, nextTags);
                cleared += 1;
              }
              update({ phase: "清理旧标签", completed: index + 1, total: cleanupTotal, detail: getAssetDisplayName(current) });
              if (index % 8 === 7) await sleep(0);
            }
    
            const assignments = Array.from(plan.tagsByItemId.entries());
            let written = 0;
            update({ phase: "写入当前标签规则", completed: 0, total: assignments.length });
            for (let index = 0; index < assignments.length; index += 1) {
              const [itemId, tagSet] = assignments[index];
              const current = await this.queryEagleItemInfo(itemId, { force: true });
              if (!current) continue;
              const existingTags = Array.isArray(current.tags) ? current.tags : [];
              const desiredTags = Array.from(tagSet);
              const nextTags = Array.from(new Set([
                ...existingTags.filter(tag => !isObsidianManagedTag(tag)),
                ...desiredTags
              ]));
              if (nextTags.length !== existingTags.length || nextTags.some(tag => !existingTags.includes(tag))) {
                await this.updateEagleItemTags(itemId, nextTags);
                written += 1;
              }
              update({ phase: "写入当前标签规则", completed: index + 1, total: assignments.length, detail: getAssetDisplayName(current) });
              if (index % 8 === 7) await sleep(0);
            }
            return `完成：扫描 ${plan.files.length} 个笔记/白板；清理 ${cleared} 个素材；重新写入 ${written} 个素材。`;
          }
        });
      }
    
      async rebuildAllVaultFolders() {
        if (this.settings.folderManagementEnabled === false) {
          throw new Error("文件夹管理当前已关闭。请先在设置中开启后再重建。");
        }
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (!rootId) {
          throw new Error("请先在设置中填写 Eagle 文件夹 ID，再执行全库文件夹重建。");
        }
        return this.runVaultRebuildTask({
          title: "重新生成所有文件夹",
          description: "正在扫描全库，复用并重命名已有专属文件夹，再按当前引用重建文件夹归属。素材本身不会删除。",
          run: async update => {
            const plan = await this.collectVaultEagleBridgePlan(progress => {
              update({ phase: "扫描笔记和白板", ...progress });
            });
            const managedFolders = await this.getManagedFoldersBelowRoot(rootId);
            const managedFolderIds = new Set(managedFolders.map(folder => String(folder.id)));
            this._folderRebuildPreviousRecords = {
              managedEagleFolders: Object.assign({}, this.settings.managedEagleFolders || {}),
              managedEagleFoldersBySource: Object.assign({}, this.settings.managedEagleFoldersBySource || {})
            };
            this._folderRebuildNextRecords = {
              managedEagleFolders: {},
              managedEagleFoldersBySource: {}
            };
            let detached = 0;
            let added = 0;
            let reused = 0;
            let created = 0;
            try {
              update({ phase: "复用并更新专属文件夹", completed: 0, total: plan.records.length });
              for (let index = 0; index < plan.records.length; index += 1) {
                const record = plan.records[index];
                const folder = await this.resolveRebuildFolderForRecord(record, rootId, managedFolderIds);
                if (folder.reused) reused += 1;
                else {
                  created += 1;
                  managedFolderIds.add(String(folder.id));
                }
    
                // A dedicated folder may still contain references deleted from the
                // note later on. Clear only this folder membership, then rebuild it
                // from the current direct references. Other Eagle folders stay intact.
                const assigned = await this.getEagleItemsAssignedToFolder(folder.id);
                for (const item of assigned) {
                  const itemId = stripInfoSuffix(getEagleItemId(item));
                  if (!itemId) continue;
                  const removed = await this.removeEagleItemFoldersViaHelper(itemId, [folder.id]);
                  if (removed > 0) detached += 1;
                }
    
                for (const itemId of record.itemIds) {
                  const item = await this.queryEagleItemInfo(itemId, { force: true });
                  if (!item || itemHasEagleFolder(item, folder.id)) continue;
                  if (await this.updateEagleItemFolder(itemId, folder.id)) added += 1;
                }
                update({ phase: "复用并写入当前文件夹规则", completed: index + 1, total: plan.records.length, detail: record.context.file.path });
                if (index % 3 === 2) await sleep(0);
              }
              this.settings.managedEagleFolders = this._folderRebuildNextRecords.managedEagleFolders;
              this.settings.managedEagleFoldersBySource = this._folderRebuildNextRecords.managedEagleFoldersBySource;
              this.eagleFolderCache = null;
              await this.saveSettings();
            } finally {
              delete this._folderRebuildPreviousRecords;
              delete this._folderRebuildNextRecords;
            }
            return `完成：扫描 ${plan.files.length} 个笔记/白板；复用 ${reused} 个专属文件夹，新建 ${created} 个；更新 ${detached} 个旧归属并加入 ${added} 个当前归属。`;
          }
        });
      }
    
      async runVaultRebuildTask({ title, description, run }) {
        const modal = new EagleBridgeProgressModal(this.app, title, description);
        modal.open();
        await sleep(0);
        try {
          const result = await run(update => modal.update(update));
          modal.finish(result);
          this.invalidateLibraryReferenceSummaries();
          await this.refreshReferenceViewsForCurrentNote(null, { force: true });
          return result;
        } catch (error) {
          console.error("Vault rebuild failed:", error);
          const message = `重建失败：${error && error.message ? error.message : String(error)}`;
          modal.finish(message, true);
          // The modal is the user-facing error surface. Do not rethrow here,
          // otherwise a failed rebuild can also leave an unhandled settings-page promise.
          return null;
        }
      }
    
      async confirmAndRebuildAllTags() {
        const choice = await chooseInObsidianModal(
          this.app,
          "重新生成所有标签",
          "将扫描整个库，清理相关素材上所有以 Obsidian 开头的标签，再按当前命名规则统一写回；其他标签会保留。大量素材时可能需要等待一会儿。",
          [{ value: "continue", label: "开始重建", cta: true }],
          "取消"
        );
        if (choice !== "continue") return;
        await this.rebuildAllVaultTags();
      }
    
      async confirmAndRebuildAllFolders() {
        const choice = await chooseInObsidianModal(
          this.app,
          "重新生成所有文件夹",
          "将扫描整个库，在原有专属文件夹基础上按当前规则重命名并重建素材归属，不会删除原有文件夹或 Eagle 素材；没有专属文件夹时才会新建。大量素材时可能需要等待一会儿。",
          [{ value: "continue", label: "开始重建", cta: true }],
          "取消"
        );
        if (choice !== "continue") return;
        await this.rebuildAllVaultFolders();
      }
    
      async confirmAndNormalizeAllEagleReferenceLabels() {
        const choice = await chooseInObsidianModal(
          this.app,
          this.t("settingNormalizeAllReferencesName"),
          "将扫描整个库的 Markdown 笔记与白板，按照当前替换模板统一现有 OE Link 引用，修正 undefined、重复句点和表格图片尺寸分隔符，并保留文件名和显示宽度。不会重新导入，也不会改动 Eagle 素材、标签或文件夹。",
          [{ value: "continue", label: this.t("settingNormalizeAllReferencesButton"), cta: true }],
          "取消"
        );
        if (choice !== "continue") return;
        await this.normalizeAllEagleReferenceLabels();
      }
    
      async normalizeAllEagleReferenceLabels() {
        return this.runVaultRebuildTask({
          title: this.t("settingNormalizeAllReferencesName"),
          description: "正在统一修正历史 Eagle 引用文本。",
          run: async update => this.runWithReferenceViewRefreshPaused(async () => {
            const files = this.getAllObsidianAssetSourceFiles();
            let updatedFiles = 0;
            let updatedLinks = 0;
    
            for (let index = 0; index < files.length; index += 1) {
              const file = files[index];
              const source = await this.app.vault.read(file);
              const result = this.normalizeLegacyEagleBridgeReferenceLabels(source);
              if (result.text !== source) {
                await this.app.vault.modify(file, result.text);
                updatedFiles += 1;
                updatedLinks += result.changed;
              }
              update(`正在检查 ${index + 1}/${files.length}：${file.path}`);
            }
    
            if (!updatedLinks) return "没有需要修正的 Eagle 引用链接。";
            return `已在 ${updatedFiles} 个文件中修正 ${updatedLinks} 条 Eagle 引用链接。`;
          })
        });
      }
    
      async getObsidianManagedEagleFolderIds(rootId = null) {
        const cleanRootId = String(rootId || this.settings.eagleFolderId || "").trim();
        if (!cleanRootId) return [];
        const folders = await this.queryEagleFolders();
        const root = findEagleFolderById(folders, cleanRootId);
        if (!root) return [cleanRootId];
        return collectEagleFolderIds(root);
      }
    
      async queryEagleItemsByFolderPage(folderId, offset = 0, limit = 24) {
        const cleanFolderId = String(folderId || "").trim();
        if (!cleanFolderId) return [];
        const params = new URLSearchParams({
          folders: cleanFolderId,
          offset: String(Math.max(0, Number(offset) || 0)),
          limit: String(Math.max(1, Number(limit) || 24))
        });
        const body = await this.requestEagleApiJson({
          url: this.getEagleApiUrl(`api/item/list?${params.toString()}`),
          method: "GET"
        });
        return Array.isArray(body && body.data) ? body.data : [];
      }
    
      async createObsidianLibraryPager(filterItem = null) {
        const folderIds = await this.getObsidianManagedEagleFolderIds();
        const plugin = this;
        const seen = new Set();
        let folderIndex = 0;
        let offset = 0;
        let exhausted = !folderIds.length;
    
        return {
          async nextPage(limit = 24) {
            const page = [];
            const pageLimit = Math.max(1, Number(limit) || 24);
            while (!exhausted && page.length < pageLimit) {
              const folderId = folderIds[folderIndex];
              const items = await plugin.queryEagleItemsByFolderPage(folderId, offset, pageLimit);
              offset += items.length;
              if (items.length < pageLimit) {
                folderIndex += 1;
                offset = 0;
                if (folderIndex >= folderIds.length) exhausted = true;
              }
              for (const item of items) {
                const itemId = getEagleItemId(item);
                const key = itemId || item.fileURL || item.name || JSON.stringify(item);
                if (seen.has(key)) continue;
                seen.add(key);
                if (typeof filterItem === "function" && !filterItem(item)) continue;
                page.push(item);
                if (page.length >= pageLimit) break;
              }
              if (!items.length && !exhausted) continue;
            }
            return { items: page, hasMore: !exhausted };
          }
        };
      }
    
      createArrayPager(items, filterItem = null) {
        const source = Array.isArray(items) ? items : [];
        let offset = 0;
        return {
          async nextPage(limit = 24) {
            const page = [];
            const pageLimit = Math.max(1, Number(limit) || 24);
            while (offset < source.length && page.length < pageLimit) {
              const item = source[offset++];
              if (typeof filterItem === "function" && !filterItem(item)) continue;
              page.push(item);
            }
            return { items: page, hasMore: offset < source.length };
          }
        };
      }
    
      getLibraryAssetKey(item) {
        if (!item) return "";
        if (item.__libraryKey) return String(item.__libraryKey);
        const source = String(item.__assetSource || "eagle");
        const id = source === "eagle" || source === "trash"
          ? stripInfoSuffix(getEagleItemId(item))
          : String(item.id || "");
        return id ? `${source}:${id}` : "";
      }
    
      async queryObsidianLibraryItemsViaHelper(folderIds, tagPrefixes, referencedItemIds = []) {
        const cleanFolderIds = Array.from(new Set((folderIds || []).map(value => String(value || "").trim()).filter(Boolean)));
        const cleanTagPrefixes = Array.from(new Set((tagPrefixes || []).map(value => String(value || "").trim()).filter(Boolean)));
        const request = () => Promise.race([
          this.requestEagleHelperJson("item/list-obsidian", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderIds: cleanFolderIds,
              tagPrefixes: cleanTagPrefixes,
              referencedItemIds: []
            })
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Eagle helper list request timed out.")), 5000))
        ]);
        let body;
        try {
          body = await request();
        } catch (firstError) {
          await sleep(160);
          body = await request().catch(secondError => {
            secondError.cause = firstError;
            throw secondError;
          });
        }
        return Array.isArray(body.data && body.data.items) ? body.data.items : [];
      }
    
      async collectObsidianLibrarySourceAssets() {
        const vaultFiles = this.app.vault.getFiles()
          .filter(file => file instanceof TFile && !isInsideEagleLibrary(file.path));
        const sourceFiles = vaultFiles
          .filter(file => file.extension === "md" || file.extension === "canvas");
        const eagleReferenceFilesById = new Map();
        const localItemsByPath = new Map();
        const externalLocalItemsByPath = new Map();
        const internetItemsByUrl = new Map();
        const readSource = typeof this.app.vault.cachedRead === "function"
          ? file => this.app.vault.cachedRead(file)
          : file => this.app.vault.read(file);
    
        const addReference = (map, key, filePath) => {
          if (!key || !filePath) return;
          if (!map.has(key)) map.set(key, new Set());
          map.get(key).add(filePath);
        };
    
        const createLocalItem = file => {
          const key = file.path;
          const fullPath = this.getFullPath(file);
          return {
            id: `local:${key}`,
            name: file.name,
            fileURL: fullPath ? normalizeFileUrl(fullPath) : "",
            resourceURL: this.getResourcePath(file),
            __extension: nodePath.extname(file.name).toLowerCase(),
            __assetSource: "local",
            __localFile: file,
            __libraryKey: `local:${key}`
          };
        };
    
        await mapWithConcurrency(sourceFiles, 8, async file => {
          try {
            const text = await readSource(file);
            for (const id of this.extractEagleBridgeItemIds(text)) {
              addReference(eagleReferenceFilesById, stripInfoSuffix(id), file.path);
            }
    
            const localLinks = file.extension === "canvas"
              ? this.findCanvasAttachmentLinks(text, file)
              : this.findLocalAttachmentLinks(text, file, false);
            for (const link of localLinks) {
              if (!(link.file instanceof TFile)) continue;
              const key = link.file.path;
              let item = localItemsByPath.get(key);
              if (!item) {
                item = createLocalItem(link.file);
                localItemsByPath.set(key, item);
              }
              addReference(item.__libraryReferences || (item.__libraryReferences = new Map()), item.__libraryKey, file.path);
            }
    
            const externalLocalLinks = file.extension === "canvas"
              ? this.findCanvasExternalLocalAttachmentLinks(text)
              : this.findExternalLocalAttachmentLinks(text);
            for (const link of externalLocalLinks) {
              const key = link.localPath;
              let item = externalLocalItemsByPath.get(key);
              if (!item) {
                item = {
                  id: `external-local:${key}`,
                  name: link.name || nodePath.basename(key),
                  fileURL: normalizeFileUrl(key),
                  resourceURL: normalizeFileUrl(key),
                  __extension: nodePath.extname(key).toLowerCase(),
                  __assetSource: "external-local",
                  __externalLocalPath: key,
                  __externalLocalLink: link,
                  __libraryKey: `external-local:${key}`
                };
                externalLocalItemsByPath.set(key, item);
              }
              addReference(item.__libraryReferences || (item.__libraryReferences = new Map()), item.__libraryKey, file.path);
            }
    
            const internetLinks = file.extension === "canvas"
              ? this.findCanvasInternetAttachmentLinks(text, file)
              : this.findInternetAttachmentLinks(text);
            for (const link of internetLinks) {
              const key = String(link.url || "");
              if (!key) continue;
              let item = internetItemsByUrl.get(key);
              if (!item) {
                item = {
                  id: `internet:${key}`,
                  name: link.name,
                  fileURL: key,
                  resourceURL: key,
                  url: key,
                  __extension: nodePath.extname(key.split("?")[0]).toLowerCase(),
                  __assetSource: "internet",
                  __isImage: !!link.__isImage,
                  __internetLink: link,
                  __libraryKey: `internet:${key}`
                };
                internetItemsByUrl.set(key, item);
              } else if (link.__isImage) item.__isImage = true;
              addReference(item.__libraryReferences || (item.__libraryReferences = new Map()), item.__libraryKey, file.path);
            }
          } catch (error) {
            console.warn("Failed to scan Obsidian library source file:", file.path, error);
          }
        });
    
        // Add every vault attachment after reference parsing. This lets the global
        // library surface unreferenced PDFs, design files, media, archives, and
        // other attachments without treating notes or Obsidian configuration as assets.
        for (const file of vaultFiles) {
          if (file.extension === "md" || file.extension === "canvas") continue;
          if (file.path.startsWith(".obsidian/") || file.path.startsWith(".trash/")) continue;
          if (!isSupportedAttachment(file.path)) continue;
          if (!localItemsByPath.has(file.path)) {
            localItemsByPath.set(file.path, createLocalItem(file));
          }
        }
    
        const sourceReferences = new Map();
        for (const item of [...localItemsByPath.values(), ...externalLocalItemsByPath.values(), ...internetItemsByUrl.values()]) {
          const references = item.__libraryReferences && item.__libraryReferences.get(item.__libraryKey);
          if (references && references.size) sourceReferences.set(item.__libraryKey, references);
          delete item.__libraryReferences;
        }
        return {
          eagleReferenceFilesById,
          sourceReferences,
          localItems: Array.from(localItemsByPath.values()),
          externalLocalItems: Array.from(externalLocalItemsByPath.values()),
          internetItems: Array.from(internetItemsByUrl.values())
        };
      }
    
      async collectObsidianTrashLibraryItems() {
        const adapter = this.app.vault && this.app.vault.adapter;
        if (!adapter || typeof adapter.list !== "function") return [];
    
        const filePaths = [];
        const walk = async folderPath => {
          let listing;
          try {
            listing = await adapter.list(folderPath);
          } catch (_error) {
            // A vault without a local .trash directory simply has no local trash items.
            return;
          }
          for (const filePath of Array.isArray(listing && listing.files) ? listing.files : []) {
            if (isSupportedAttachment(filePath)) filePaths.push(filePath);
          }
          for (const childPath of Array.isArray(listing && listing.folders) ? listing.folders : []) {
            await walk(childPath);
          }
        };
    
        await walk(".trash");
        return mapWithConcurrency(filePaths, 6, async filePath => {
          let stat = null;
          try {
            stat = typeof adapter.stat === "function" ? await adapter.stat(filePath) : null;
          } catch (_error) {
            // Keep the card usable even if its file changed during the scan.
          }
          const resourceURL = typeof adapter.getResourcePath === "function"
            ? adapter.getResourcePath(filePath)
            : "";
          const name = nodePath.basename(filePath);
          return {
            id: `local-trash:${filePath}`,
            name,
            fileURL: resourceURL,
            resourceURL,
            __extension: nodePath.extname(name).toLowerCase(),
            __assetSource: "local",
            __inObsidianTrash: true,
            __localTrashPath: filePath,
            __libraryKey: `local-trash:${filePath}`,
            size: stat && stat.size,
            mtime: stat && stat.mtime
          };
        });
      }
    
      async getObsidianLibraryReferenceSummary() {
        const collected = await this.collectObsidianLibrarySourceAssets();
        let folderIds;
        try {
          folderIds = await this.getObsidianManagedEagleFolderIds();
        } catch (error) {
          console.warn("Failed to expand the Eagle folder tree; continuing with the configured root and tags:", error);
          folderIds = [String(this.settings.eagleFolderId || "").trim()].filter(Boolean);
        }
        const tagPrefixes = this.getManagedTagPrefixes();
        let eagleItems = [];
        try {
          const helperItems = await this.queryObsidianLibraryItemsViaHelper(
            folderIds,
            tagPrefixes,
            Array.from(collected.eagleReferenceFilesById.keys())
          );
          // Older helper builds can serialize Eagle item objects as [{}...]. Do not
          // treat that as an empty library: use the stable folder pager instead.
          if (helperItems.length && helperItems.some(item => !stripInfoSuffix(getEagleItemId(item)))) {
            throw new Error("Eagle helper returned non-serializable item records.");
          }
          eagleItems = helperItems;
        } catch (error) {
          console.warn("Failed to read the complete Obsidian Eagle library through helper; falling back to folders:", error);
          const pager = await this.createObsidianLibraryPager();
          while (true) {
            const page = await pager.nextPage(100);
            eagleItems.push(...page.items);
            if (!page.hasMore) break;
          }
        }
    
        const referencedIds = new Set(collected.eagleReferenceFilesById.keys());
        const activeEagleItemIds = new Set(
          eagleItems
            .map(item => stripInfoSuffix(getEagleItemId(item)))
            .filter(Boolean)
        );
        // Eagle's list APIs omit trashed items. Probe only IDs that Obsidian still
        // references but which are absent from the active Eagle result set.
        const missingReferencedIds = Array.from(referencedIds)
          .filter(itemId => !activeEagleItemIds.has(itemId));
        if (missingReferencedIds.length) {
          const trashedReferencedItems = await mapWithConcurrency(
            missingReferencedIds,
            6,
            async itemId => {
              try {
                const item = await this.queryEagleItemInfo(itemId);
                return item && isEagleItemTrashed(item) ? item : null;
              } catch (error) {
                console.warn(`Skipping unavailable Eagle item ${itemId}:`, error);
                return null;
              }
            }
          );
          eagleItems.push(...trashedReferencedItems.filter(Boolean));
        }
        const referencedFilesById = collected.eagleReferenceFilesById;
        const assetReferenceFilesByKey = new Map(collected.sourceReferences);
        const libraryItemIds = new Set();
        const items = [];
        for (const rawItem of eagleItems) {
          const itemId = stripInfoSuffix(getEagleItemId(rawItem));
          if (!itemId || libraryItemIds.has(itemId)) continue;
          libraryItemIds.add(itemId);
          const item = Object.assign({}, rawItem, {
            __assetSource: isEagleItemTrashed(rawItem) ? "trash" : "eagle",
            __libraryKey: `eagle:${itemId}`
          });
          const references = referencedFilesById.get(itemId);
          if (references && references.size) assetReferenceFilesByKey.set(item.__libraryKey, references);
          items.push(item);
        }
        const localTrashItems = await this.collectObsidianTrashLibraryItems();
        items.push(...collected.localItems, ...localTrashItems, ...collected.externalLocalItems, ...collected.internetItems);
        const referenced = items.filter(item => {
          const refs = assetReferenceFilesByKey.get(this.getLibraryAssetKey(item));
          return !!(refs && refs.size);
        }).length;
        const sourceCounts = { eagle: 0, local: 0, "external-local": 0, internet: 0, trash: 0, localTrash: 0 };
        for (const item of items) {
          if (item.__inObsidianTrash) {
            sourceCounts.localTrash += 1;
            continue;
          }
          const source = String(item.__assetSource || "eagle");
          if (Object.prototype.hasOwnProperty.call(sourceCounts, source)) sourceCounts[source] += 1;
        }
        return {
          referencedIds,
          referencedFilesById,
          assetReferenceFilesByKey,
          libraryItemIds,
          items,
          sourceCounts,
          total: items.length,
          referenced,
          unreferenced: Math.max(0, items.length - referenced)
        };
      }
    
      async reconcileCurrentContextEagleBridgeTags(context, existingText = null, showNotice = true) {
        if (this.settings.tagManagementEnabled === false) return;
        const text = existingText !== null ? existingText : await this.app.vault.read(context.file);
        await this.syncCurrentNoteEagleBridgeLinkTags(context, text, showNotice);
        await this.removeStaleContextTags(context, text, showNotice);
      }
    
      async removeStaleContextTags(context, existingText = null, showNotice = true) {
        if (this.settings.tagManagementEnabled === false) return;
        try {
          const text = existingText !== null ? existingText : await this.app.vault.read(context.file);
          const currentIds = new Set(this.extractEagleBridgeItemIds(text).map(id => stripInfoSuffix(id)));
          const tagsToClean = this.getContextTagsToClean(context);
          if (!tagsToClean.length) return;
    
          const taggedItems = await this.queryEagleItemsByTags(tagsToClean);
          let updated = 0;
          for (const item of taggedItems) {
            const itemId = getEagleItemId(item);
            if (!itemId || currentIds.has(itemId)) continue;
            const detailedItem = await this.queryEagleItemInfo(itemId) || item;
            const existingTags = Array.isArray(detailedItem && detailedItem.tags) ? detailedItem.tags : [];
            const nextTags = existingTags.filter(tag => !tagsToClean.includes(tag));
            if (nextTags.length === existingTags.length) continue;
            await this.updateEagleItemTags(itemId, nextTags);
            updated += 1;
          }
          if (updated && showNotice) {
            new Notice(this.t("noticeRemovedStaleTags", { count: updated }));
          }
        } catch (error) {
          console.warn("Failed to remove stale EagleBridge link tags:", error);
        }
      }
    
      getContextTagsToClean(context) {
        const tags = new Set(context.tags || []);
        const noteRename = this.lastNoteRename;
        if (context && context.kind === "markdown" && noteRename && noteRename.path === context.file.path) {
          for (const tag of noteRename.oldTags || []) tags.add(tag);
        }
        const rename = this.lastCanvasRename;
        if (context && context.kind === "canvas" && rename && rename.path === context.file.path) {
          for (const tag of rename.oldTags || []) tags.add(tag);
        }
        return Array.from(tags).filter(Boolean);
      }
    
      getRemovableTagsForContext(context, existingTags = []) {
        if (context && context.kind === "canvas") {
          const rename = this.lastCanvasRename;
          if (!rename || rename.path !== context.file.path) return [];
          const hasNewTag = rename.newTags.some(tag => context.tags.includes(tag));
          if (!hasNewTag) return [];
          return rename.oldTags.filter(tag => existingTags.includes(tag));
        }
        const tags = [];
        const rename = this.lastNoteRename;
        if (context && context.kind === "markdown" && rename && rename.path === context.file.path) {
          const hasNewTag = rename.newTags.some(tag => context.tags.includes(tag));
          if (hasNewTag) {
            tags.push(...rename.oldTags.filter(tag => existingTags.includes(tag)));
          }
        }
        return Array.from(new Set(tags));
      }
    
      extractEagleBridgeItemIds(text) {
        return this.extractEagleBridgeItemReferences(text).map(ref => ref.id);
      }
    
      extractEagleBridgeItemReferences(text) {
        const refs = [];
        const seen = new Set();
        const source = String(text || "");
        const addRef = (id, label = "", start = 0, end = 0) => {
          const cleanId = stripInfoSuffix(safeDecode(id));
          if (!cleanId || seen.has(cleanId)) return;
          seen.add(cleanId);
          refs.push({ id: cleanId, label: cleanEagleBridgeLabel(label), start, end });
        };
    
        const mdRe = /!?\[([^\]]*)\]\((https?:\/\/localhost:\d+\/images\/([^)\s"'<>]+)\.info)\)/g;
        let match;
        while ((match = mdRe.exec(source)) !== null) {
          addRef(match[3], match[1], match.index, match.index + match[0].length);
        }
    
        const urlRe = /https?:\/\/localhost:\d+\/images\/([^)\s"'<>]+)\.info/g;
        while ((match = urlRe.exec(source)) !== null) {
          addRef(match[1], "", match.index, match.index + match[0].length);
        }
    
        return refs;
      }
    
      async updateEagleItemTags(itemId, tags) {
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        try {
          const response = await requestUrl({
            url: `${base}/api/item/update`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: itemId, tags })
          });
          const body = response.json;
          if (body && body.status && body.status !== "success") {
            throw new Error(body.message || "Eagle item/update failed.");
          }
          this.invalidateEagleItemInfo(itemId);
          return body;
        } catch (error) {
          const response = await requestUrl({
            url: `${base}/api/item/update?id=${encodeURIComponent(itemId)}&tags=${encodeURIComponent(JSON.stringify(tags))}`,
            method: "POST"
          });
          const body = response.json;
          if (body && body.status && body.status !== "success") {
            throw new Error(body.message || error.message || "Eagle item/update failed.");
          }
          this.invalidateEagleItemInfo(itemId);
          return body;
        }
      }
    
      async updateEagleItemFolder(itemId, folderId) {
        const cleanItemId = String(itemId || "").trim();
        const cleanFolderId = String(folderId || "").trim();
        if (!cleanItemId || !cleanFolderId) return false;
    
        const helperOk = await this.addEagleItemToFolderViaHelper(cleanItemId, cleanFolderId);
        if (helperOk) return true;
    
        const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
        const attempts = [
          { endpoint: "moveToFolder", payload: { id: cleanItemId, itemId: cleanItemId, folderId: cleanFolderId, folderID: cleanFolderId } },
          { endpoint: "moveTo", payload: { id: cleanItemId, itemId: cleanItemId, folderId: cleanFolderId, folderID: cleanFolderId } },
          { endpoint: "move", payload: { id: cleanItemId, itemId: cleanItemId, folderId: cleanFolderId, folderID: cleanFolderId } },
          { endpoint: "update", payload: { id: cleanItemId, folderId: cleanFolderId, folderID: cleanFolderId } },
          { endpoint: "update", payload: { id: cleanItemId, itemId: cleanItemId, folders: [cleanFolderId] } },
          { endpoint: "update", payload: { id: cleanItemId, itemId: cleanItemId, folderIds: [cleanFolderId] } },
          { endpoint: "update", payload: { id: cleanItemId, itemId: cleanItemId, folderIDs: [cleanFolderId] } }
        ];
    
        for (const attempt of attempts) {
          try {
            const response = await requestUrl({
              url: `${base}/api/item/${attempt.endpoint}`,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attempt.payload)
            });
            const body = response.json;
            if (body && body.status && body.status !== "success") continue;
            this.invalidateEagleItemInfo(cleanItemId);
            const updated = await this.queryEagleItemInfo(cleanItemId, { force: true });
            if (itemHasEagleFolder(updated, cleanFolderId)) return true;
          } catch (error) {
            console.warn("Failed to update Eagle item folder:", error);
          }
        }
    
        const queryAttempts = [
          `moveToFolder?id=${encodeURIComponent(cleanItemId)}&folderId=${encodeURIComponent(cleanFolderId)}`,
          `moveToFolder?itemId=${encodeURIComponent(cleanItemId)}&folderId=${encodeURIComponent(cleanFolderId)}`,
          `move?id=${encodeURIComponent(cleanItemId)}&folderId=${encodeURIComponent(cleanFolderId)}`
        ];
        for (const path of queryAttempts) {
          try {
            const response = await requestUrl({
              url: `${base}/api/item/${path}`,
              method: "POST"
            });
            const body = response.json;
            if (body && body.status && body.status !== "success") continue;
            this.invalidateEagleItemInfo(cleanItemId);
            const updated = await this.queryEagleItemInfo(cleanItemId, { force: true });
            if (itemHasEagleFolder(updated, cleanFolderId)) return true;
          } catch (error) {
            console.warn("Failed to update Eagle item folder with query endpoint:", error);
          }
        }
    
        return false;
      }
    
      async addEagleItemToFolderViaHelper(itemId, folderId) {
        try {
          const body = await this.requestEagleHelperJson("item/add-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId, folderId })
          });
          this.invalidateEagleItemInfo(itemId);
          const updated = await this.queryEagleItemInfo(itemId, { force: true });
          return itemHasEagleFolder(updated, folderId);
        } catch (error) {
          console.warn("Eagle helper add-folder failed:", error);
          return false;
        }
      }
    
      async restoreUnfiledEagleItemToRoot(itemId, rootId) {
        const cleanItemId = stripInfoSuffix(String(itemId || "").trim());
        const cleanRootId = String(rootId || "").trim();
        if (!cleanItemId || !cleanRootId) return false;
    
        const item = await this.queryEagleItemInfo(cleanItemId, { force: true });
        if (!item || isEagleItemTrashed(item) || getEagleItemFolderIds(item).length > 0) return false;
    
        return this.addEagleItemToFolderViaHelper(cleanItemId, cleanRootId);
      }
    
      async removeEagleItemFoldersViaHelper(itemId, folderIds) {
        const ids = Array.from(new Set((folderIds || []).map(id => String(id || "").trim()).filter(Boolean)));
        if (!ids.length) return 0;
        const body = await this.requestEagleHelperJson("item/remove-folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, folderIds: ids })
        });
        this.invalidateEagleItemInfo(itemId);
        const data = body.data || {};
        return Number(data.removed || 0);
      }
    
      async deleteEagleFolderIfEmptyViaHelper(folderId) {
        const cleanFolderId = String(folderId || "").trim();
        if (!cleanFolderId) return false;
        const body = await this.requestEagleHelperJson("folder/delete-if-empty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: cleanFolderId })
        });
        return Boolean(body.data && body.data.deleted);
      }
    
      async moveEagleItemsToTrashViaHelper(itemIds) {
        const ids = Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean)));
        if (!ids.length) return 0;
        const health = await this.requestEagleHelperJson("health", { method: "GET" });
        if (health.status !== "success" || compareVersions(String(health.version || "0.0.0"), EAGLE_HELPER_PLUGIN_VERSION) < 0) {
          throw new Error(`OE Link 辅助插件版本过旧（当前 ${health.version || "未知"}，需要 ${EAGLE_HELPER_PLUGIN_VERSION}）。请在 Obsidian 设置中安装/更新辅助插件，然后重启 Eagle。`);
        }
        const body = await this.requestEagleHelperJson("item/move-to-trash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: ids })
        });
        ids.forEach(itemId => this.invalidateEagleItemInfo(itemId));
        return Number((body.data && body.data.moved) || ids.length);
      }
    
      async getEagleItemEmbedUrl(item) {
        if (!item) return "";
        if (item.fileURL) return normalizeFileUrl(item.fileURL);
        if (item.url && /^file:\/\//i.test(item.url)) return item.url;
        if (item.thumbnailURL) {
          if (/\/api\/item\/thumbnail/i.test(item.thumbnailURL)) {
            return await this.resolveEaglePathEndpoint(item.thumbnailURL);
          }
          return normalizeFileUrl(item.thumbnailURL);
        }
        if (item.id) {
          const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
          return await this.resolveEaglePathEndpoint(`${base}/api/item/thumbnail?id=${encodeURIComponent(item.id)}`);
        }
        return "";
      }
    
      async getEagleItemThumbnailUrl(item) {
        if (!item) return "";
        if (item.thumbnailURL) {
          if (/\/api\/item\/thumbnail/i.test(item.thumbnailURL)) {
            return await this.resolveEaglePathEndpoint(item.thumbnailURL);
          }
          return normalizeFileUrl(item.thumbnailURL);
        }
        const itemId = getEagleItemId(item);
        if (itemId) {
          const base = this.settings.eagleApiBaseUrl.replace(/\/+$/, "");
          const resolved = await this.resolveEaglePathEndpoint(`${base}/api/item/thumbnail?id=${encodeURIComponent(itemId)}`);
          if (resolved) return resolved;
        }
        if (item.fileURL) return normalizeFileUrl(item.fileURL);
        if (item.url && /^file:\/\//i.test(item.url)) return item.url;
        return "";
      }
    
      getEagleBridgeUrl(item) {
        const itemId = getEagleItemId(item);
        if (!itemId) return "";
        const base = this.getCompanionMediaUrl();
        return `${base}/images/${encodeURIComponent(stripInfoSuffix(itemId))}.info`;
      }
    
      isEagleBridgeAssetUrl(url) {
        const text = String(url || "").trim();
        if (!/^https?:\/\//i.test(text)) return false;
        const configuredBase = this.getCompanionMediaUrl().toLowerCase();
        const lower = text.toLowerCase();
        if (configuredBase && lower.startsWith(`${configuredBase}/images/`) && /\.info(?:$|[?#/])/i.test(text)) {
          return true;
        }
        return /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/images\/[^/?#]+\.info(?:$|[?#/])/i.test(text);
      }
    
      buildCanvasEagleBridgeUrl(bridgeUrl, fileName) {
        try {
          const parsedUrl = new URL(bridgeUrl);
          if (isPreviewableImage(fileName)) {
            return `${parsedUrl.origin}/__eaglebridge__/canvas-image?src=${encodeURIComponent(bridgeUrl)}`;
          }
          return `${parsedUrl.origin}/__eaglebridge__/canvas-resource?src=${encodeURIComponent(bridgeUrl)}&filename=${encodeURIComponent(fileName || "")}`;
        } catch (error) {
          return bridgeUrl;
        }
      }
    
      async resolveEaglePathEndpoint(url) {
        try {
          const response = await requestUrl({ url, method: "GET" });
          const body = response.json;
          if (body && body.status && body.status !== "success") return "";
          if (typeof (body && body.data) === "string") {
            return normalizeFileUrl(body.data);
          }
          return "";
        } catch (error) {
          console.warn("Failed to resolve Eagle path endpoint:", error);
          return "";
        }
      }
    
      async trashImportedFiles(importedItems) {
        if (!this.settings.trashAfterImport) return;
        const seen = new Set();
        for (const imported of importedItems) {
          const file = imported && imported.sourceFile;
          if (!file || seen.has(file.path)) continue;
          seen.add(file.path);
          try {
            await this.trashLocalFile(file);
          } catch (error) {
            console.warn("Failed to trash imported attachment:", file.path, error);
            new Notice(this.t("noticeImportedTrashFailed", { name: file.name }));
          }
        }
      }
    
      async trashLocalFile(file) {
        const sourcePath = String(file && file.path || "").trim();
        const currentFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(currentFile instanceof TFile)) {
          const error = new Error(`Local attachment no longer exists: ${sourcePath}`);
          error.code = "ENOENT";
          throw error;
        }
    
        // Let Obsidian manage its special .trash folder and any duplicate names.
        if (typeof this.app.vault.trash === "function") {
          await this.app.vault.trash(currentFile, false);
          return sourcePath;
        }
    
        // Older Obsidian builds still expose FileManager's native trash command.
        if (this.app.fileManager && typeof this.app.fileManager.trashFile === "function") {
          await this.app.fileManager.trashFile(currentFile);
          return sourcePath;
        }
    
        throw new Error("This Obsidian version does not provide a local trash API.");
      }
    
      async getAuthoritativeEagleItem(item) {
        const itemId = stripInfoSuffix(getEagleItemId(item));
        if (!itemId) return item;
        try {
          return await this.queryEagleItemInfo(itemId, { force: true }) || item;
        } catch (error) {
          console.warn("Unable to read authoritative Eagle item metadata:", error);
          return item;
        }
      }
    
      async normalizeEagleBridgeReferenceLabels(context, sourceText) {
        const source = String(sourceText || "");
        const refs = this.extractEagleBridgeItemReferences(source);
        if (!context || !refs.length) return source;
    
        const namesById = new Map();
        for (const ref of refs) {
          const itemId = stripInfoSuffix(ref.id);
          if (!itemId || namesById.has(itemId)) continue;
          const item = await this.getAuthoritativeEagleItem({ id: itemId });
          const fallback = sanitizeEagleBridgeEmbedLabel(ref.label);
          const canonicalName = this.getCanonicalEagleFileName(item, fallback);
          if (canonicalName) namesById.set(itemId, canonicalName);
        }
    
        const markdownRef = /(!?\[)([^\]]*)(\]\((https?:\/\/[^)\s"'<>]+\/images\/([^\)\s"'<>]+)\.info)\))/g;
        return source.replace(markdownRef, (full, opening, label, closing, url, rawId, offset) => {
          if (!this.isEagleBridgeAssetUrl(url)) return full;
          const canonicalName = namesById.get(stripInfoSuffix(safeDecode(rawId)));
          const parts = String(label || "").replace(/\\\|/g, "|").split("|");
          const width = parts.map(part => String(part || "").trim()).find(part => /^\d{1,5}$/.test(part));
          const normalizedLabel = sanitizeEagleBridgeEmbedLabel(canonicalName || parts[0]);
          if (!normalizedLabel) return full;
          const nextLabel = [normalizedLabel, width].filter(Boolean).join("|");
          return makeMarkdownTableSafeReference(source, offset, `${opening}${nextLabel}${closing}`);
        });
      }
    
      normalizeLegacyEagleBridgeReferenceLabels(sourceText) {
        const source = String(sourceText || "");
        let changed = 0;
        const markdownRef = /(!?\[)([^\]]*)(\]\((https?:\/\/[^)\s"'<>]+\/images\/([^\)\s"'<>]+)\.info)\))/g;
        const text = source.replace(markdownRef, (full, opening, label, closing, url, rawId, offset) => {
          if (!this.isEagleBridgeAssetUrl(url)) return full;
          const parts = String(label || "").replace(/\\\|/g, "|").split("|");
          const filename = sanitizeEagleBridgeEmbedLabel(parts[0]);
          const width = parts.map(part => String(part || "").trim()).find(part => /^\d{1,5}$/.test(part));
          if (!filename) return full;
          const itemId = stripInfoSuffix(safeDecode(rawId));
          const templateReference = this.buildReplacement({ name: filename }, {
            displayName: filename,
            itemId,
            bridgeUrl: url,
            url
          });
          const sizedReference = preserveAttachmentDisplaySize(full, templateReference);
          const nextReference = makeMarkdownTableSafeReference(source, offset, sizedReference);
          if (nextReference === full) return full;
          changed += 1;
          return nextReference;
        });
        return { text, changed };
      }
    
      getCanonicalEagleFileName(item, fallbackName = "") {
        const fallback = String(fallbackName || "").trim();
        const eagleName = String(item && (item.name || item.filename || item.fileName || item.title) || "").trim();
        const baseName = eagleName || fallback || "attachment";
        // Preserve the extension from Obsidian's original link whenever it is
        // known. Eagle can return a PNG preview name for formats such as JFIF.
        const sourceExtension = normalizeExtension(nodePath.extname(fallback));
        const extension = sourceExtension || normalizeExtension(getAssetExtension(item) || nodePath.extname(baseName));
        const stem = nodePath.extname(baseName) ? stripExtension(baseName) : baseName;
        return extension ? `${stem}${extension}` : baseName;
      }
    
      buildReplacement(sourceFile, values = {}) {
        const displayName = sanitizeEagleBridgeEmbedLabel(values.displayName || sourceFile.name) || "attachment";
        if (!isPreviewableImage(displayName)) {
          return `[${displayName}](${values.bridgeUrl || values.url || ""})`;
        }
        const template = this.settings && this.settings.replacementTemplate || DEFAULT_SETTINGS.replacementTemplate;
        return template
          .replaceAll("{name}", stripExtension(displayName))
          .replaceAll("{filename}", displayName)
          .replaceAll("{itemId}", values.itemId || "")
          .replaceAll("{bridgeUrl}", values.bridgeUrl || "")
          .replaceAll("{url}", values.url || "");
      }
    
      async normalizeLegacyNonImageEagleBridgeEmbeds(file) {
        if (!(file instanceof TFile) || file.extension !== "md") return 0;
        const source = await this.app.vault.read(file);
        const normalized = normalizeLegacyNonImageEmbeds(source, this);
        if (normalized.count) await this.app.vault.modify(file, normalized.text);
        return normalized.count;
      }
    
      decorateEagleBridgeFileLinks(root) {
        if (!root || typeof root.querySelectorAll !== "function") return;
        const sources = [];
        if (root.matches && root.matches("a[href], img[src]")) sources.push(root);
        sources.push(...root.querySelectorAll("a[href], img[src]"));
        for (const source of sources) {
          if (source.closest(".eaglebridge-note-assets-view")) continue;
          const isLegacyImage = source.tagName === "IMG";
          const url = source.getAttribute(isLegacyImage ? "src" : "href") || source.href || source.src || "";
          const displayName = sanitizeEagleBridgeEmbedLabel(isLegacyImage ? source.getAttribute("alt") : source.textContent) || "attachment";
          if (isPreviewableImage(displayName)) continue;
          if (this.isEagleBridgeAssetUrl(url)) {
            const idMatch = url.match(/\/images\/([^/?#]+)\.info(?:$|[?#/])/i);
            if (!idMatch) continue;
            source.replaceWith(createAttachmentElement(this, {
              name: displayName,
              url,
              itemId: stripInfoSuffix(safeDecode(idMatch[1])),
              kind: getAttachmentKind(displayName)
            }));
            continue;
          }
          const localPath = externalLocalPathFromTarget(url);
          if (!localPath) continue;
          source.replaceWith(createAttachmentElement(this, {
            name: displayName,
            url: normalizeFileUrl(localPath),
            localPath,
            kind: getAttachmentKind(displayName)
          }));
        }
      }
    
      getFullPath(file) {
        const adapter = this.app.vault.adapter;
        if (adapter && typeof adapter.getFullPath === "function") {
          return adapter.getFullPath(file.path);
        }
        return "";
      }
    
      getResourcePath(file) {
        if (this.app.vault && typeof this.app.vault.getResourcePath === "function") {
          return this.app.vault.getResourcePath(file);
        }
        return "";
      }
    
      findLocalAttachmentLinks(text, sourceFile, includeMissing = false) {
        const links = [];
        const seenRanges = new Set();
        const sourcePath = sourceFile.path;
    
        const addLink = (matchText, rawPath, start, end) => {
          const cleaned = cleanAttachmentTarget(rawPath);
          if (!cleaned || isExternalLink(cleaned) || externalLocalPathFromTarget(cleaned)) return;
          if (!isSupportedAttachment(cleaned)) return;
          const file = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
          if (!(file instanceof TFile)) {
            if (includeMissing) {
              const key = `${start}:${end}:${cleaned}`;
              if (seenRanges.has(key)) return;
              seenRanges.add(key);
              links.push({
                original: matchText,
                target: cleaned,
                file: null,
                start,
                end,
                __missingAttachment: true
              });
            }
            return;
          }
          if (!isSupportedAttachment(file.path)) return;
          const key = `${start}:${end}:${file.path}`;
          if (seenRanges.has(key)) return;
          seenRanges.add(key);
          links.push({ original: matchText, target: cleaned, file, start, end });
        };
    
        const wikiRe = /!?\[\[((?:\\\||[^\]])+)\]\]/g;
        let match;
        while ((match = wikiRe.exec(text)) !== null) {
          addLink(match[0], getWikiAttachmentTarget(match[1]), match.index, match.index + match[0].length);
        }
    
        for (const mdLink of findMarkdownAttachmentReferences(text)) {
          addLink(mdLink.original, mdLink.target, mdLink.start, mdLink.end);
        }
    
        const htmlAttrRe = /<(?:img|video|audio|source|embed|object|a)\b[^>]*?\s(?:src|href|data)=["']([^"']+)["'][^>]*>/gi;
        while ((match = htmlAttrRe.exec(text)) !== null) {
          addLink(match[0], match[1], match.index, match.index + match[0].length);
        }
    
        return links;
      }
    
      findExternalLocalAttachmentLinks(text) {
        const links = [];
        const seenRanges = new Set();
        const addLink = (matchText, rawPath, start, end, label = "") => {
          const localPath = externalLocalPathFromTarget(rawPath);
          if (!localPath || !isSupportedAttachment(localPath)) return;
          try {
            if (!nodeFs.statSync(localPath).isFile()) return;
          } catch (_) {
            return;
          }
          const key = `${start}:${end}:${localPath}`;
          if (seenRanges.has(key)) return;
          seenRanges.add(key);
          const parsed = parseAttachmentReference({ label, target: rawPath, start, end });
          links.push({
            kind: "external-local",
            original: matchText,
            target: cleanAttachmentTarget(rawPath),
            localPath,
            name: parsed.displayName || nodePath.basename(localPath),
            start,
            end
          });
        };
    
        for (const mdLink of findMarkdownAttachmentReferences(text)) {
          addLink(mdLink.original, mdLink.target, mdLink.start, mdLink.end, mdLink.label);
        }
    
        const htmlAttrRe = /<(?:img|video|audio|source|embed|object|a)\b[^>]*?\s(?:src|href|data)=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = htmlAttrRe.exec(text)) !== null) {
          const altMatch = match[0].match(/\salt=["']([^"']*)["']/i);
          addLink(match[0], match[1], match.index, match.index + match[0].length, altMatch ? unescapeHtmlAttr(altMatch[1]) : "");
        }
        return links;
      }
    
      findInternetAttachmentLinks(text) {
        const links = [];
        const seenRanges = new Set();
    
        const addLink = (matchText, rawUrl, start, end, label = "", allowExtensionless = false, isImage = false) => {
          const url = cleanExternalAttachmentUrl(String(rawUrl || "").trim());
          if (!/^https?:\/\//i.test(url)) return;
          if (this.isEagleBridgeAssetUrl(url)) return;
          if (!allowExtensionless && !isSupportedAttachment(url)) return;
          const key = `${start}:${end}:${url}`;
          if (seenRanges.has(key)) return;
          seenRanges.add(key);
          const name = getInternetAttachmentDisplayName(label, url);
          links.push({ kind: "internet", original: matchText, target: url, url, name, start, end, __isImage: isImage });
        };
    
        for (const mdLink of findMarkdownAttachmentReferences(text)) {
          addLink(mdLink.original, mdLink.target, mdLink.start, mdLink.end, mdLink.label, !!mdLink.isEmbed, !!mdLink.isEmbed);
        }
    
        const htmlTagRe = /<(img|video|audio|source|embed|object|a)\b[^>]*>/gi;
        let match;
        while ((match = htmlTagRe.exec(text)) !== null) {
          const tag = match[1].toLowerCase();
          const altMatch = match[0].match(/\salt=["']([^"']*)["']/i);
          const attrRe = /\s(src|href|data|srcset)=["']([^"']+)["']/gi;
          let attr;
          while ((attr = attrRe.exec(match[0])) !== null) {
            const attribute = attr[1].toLowerCase();
            const allowExtensionless = (tag === "img" || tag === "source") && (attribute === "src" || attribute === "srcset");
            const urls = attribute === "srcset"
              ? attr[2].split(",").map(value => value.trim().split(/\s+/)[0]).filter(Boolean)
              : [attr[2]];
            for (const rawUrl of urls) {
              addLink(match[0], rawUrl, match.index, match.index + match[0].length, altMatch ? unescapeHtmlAttr(altMatch[1]) : "", allowExtensionless, tag === "img");
            }
          }
        }
    
        return links;
      }
    
      findCanvasAttachmentLinks(text, sourceFile) {
        const links = [];
        const seen = new Set();
    
        const addFilePath = (rawPath, original = "", start = 0, end = 0, canvasNodeId = "") => {
          const cleaned = cleanAttachmentTarget(rawPath);
          if (!cleaned || isExternalLink(cleaned) || externalLocalPathFromTarget(cleaned)) return;
          if (!isSupportedCanvasAttachment(cleaned)) return;
          const file = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourceFile.path);
          if (!(file instanceof TFile)) return;
          if (!isSupportedCanvasAttachment(file.path)) return;
          if (seen.has(file.path)) return;
          seen.add(file.path);
          links.push({
            original: original || cleaned,
            target: cleaned,
            file,
            start,
            end,
            canvasNodeId
          });
        };
    
        try {
          const canvas = JSON.parse(text);
          const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            if (typeof node.file === "string") {
              addFilePath(node.file, node.file, 0, 0, String(node.id || ""));
            }
          }
        } catch (error) {
          console.warn("Failed to parse Canvas attachments:", error);
        }
    
        return links;
      }
    
      findCanvasInternetAttachmentLinks(text, sourceFile) {
        const links = [];
        const seen = new Set();
        try {
          const canvas = JSON.parse(text);
          const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
          for (const node of nodes) {
            if (!node || typeof node.url !== "string" || !/^https?:\/\//i.test(node.url)) continue;
            const url = cleanExternalAttachmentUrl(node.url);
            if (this.isEagleBridgeAssetUrl(url) || seen.has(url)) continue;
            seen.add(url);
            links.push({
              kind: "internet",
              original: node.url,
              target: url,
              url,
              name: getInternetAttachmentDisplayName("", url),
              start: 0,
              end: 0,
              canvasNodeId: String(node.id || "")
            });
          }
        } catch (error) {
          console.warn("Failed to parse Canvas network attachments:", error);
        }
        return links;
      }
    
      findCanvasExternalLocalAttachmentLinks(text) {
        const links = [];
        const seen = new Set();
        try {
          const canvas = JSON.parse(text);
          const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            const rawPath = typeof node.url === "string" ? node.url : typeof node.file === "string" ? node.file : "";
            const localPath = externalLocalPathFromTarget(rawPath);
            if (!localPath || seen.has(localPath) || !isSupportedCanvasAttachment(localPath)) continue;
            try {
              if (!nodeFs.statSync(localPath).isFile()) continue;
            } catch (_) {
              continue;
            }
            seen.add(localPath);
            links.push({
              kind: "external-local",
              original: rawPath,
              target: cleanAttachmentTarget(rawPath),
              localPath,
              name: nodePath.basename(localPath),
              start: 0,
              end: 0,
              canvasNodeId: String(node.id || "")
            });
          }
        } catch (error) {
          console.warn("Failed to parse Canvas external local attachments:", error);
        }
        return links;
      }
    
      findCanvasNoteLinks(text, sourceFile) {
        const links = [];
        const seen = new Set();
    
        const addNotePath = rawPath => {
          const cleaned = cleanAttachmentTarget(rawPath);
          if (!cleaned || isExternalLink(cleaned)) return;
          if (nodePath.extname(stripAttachmentSubpath(cleaned)).toLowerCase() !== ".md") return;
          const file = this.app.metadataCache.getFirstLinkpathDest(cleaned, sourceFile.path);
          if (!(file instanceof TFile) || file.extension !== "md") return;
          if (seen.has(file.path)) return;
          seen.add(file.path);
          links.push({
            id: `note:${file.path}`,
            name: file.name,
            filename: file.name,
            __extension: ".md",
            __assetSource: "note",
            __noteFile: file
          });
        };
    
        try {
          const canvas = JSON.parse(text);
          const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            if (typeof node.file === "string") {
              addNotePath(node.file);
            }
          }
        } catch (error) {
          console.warn("Failed to parse Canvas note links:", error);
        }
    
        return links;
      }
    
      openExternalUrl(url) {
        if (!url) return;
        try {
          const electron = require("electron");
          if (electron && electron.shell) {
            electron.shell.openExternal(url);
            return;
          }
          window.open(url);
        } catch (error) {
          try {
            window.open(url);
          } catch (innerError) {
            console.warn("Failed to open Eagle:", error, innerError);
          }
        }
      }
    
      openEagleApp() {
        this.openExternalUrl(this.settings.eagleProtocolUrl);
      }
    
      async openEagleForContext(context, options = {}) {
        const activeFile = this.app.workspace.getActiveFile();
        const preferActive = options.preferActive !== false;
        if (preferActive && activeFile && isSupportedSourceFile(activeFile)) {
          const contextFilePath = context && context.file instanceof TFile ? context.file.path : "";
          if (contextFilePath !== activeFile.path) {
            context = await this.getAssetContext(activeFile, true);
          }
        } else {
          context = null;
        }
        const folderId = await this.resolveEagleFolderIdForContext(context);
        if (folderId) {
          this.openExternalUrl(buildEagleFolderUrl(this.settings.eagleProtocolUrl, folderId));
          return;
        }
        this.openEagleApp();
      }
    
      async findExistingEagleFolderIdForContext(context) {
        const rootId = String(this.settings.eagleFolderId || "").trim();
        if (this.settings.folderManagementEnabled === false) return "";
        if (!rootId || !context || !(context.file instanceof TFile)) return "";
        const targetPath = await this.getManagedEagleFolderPathForContext(context);
        if (!targetPath) return "";
        try {
          const folder = await this.findExistingEagleFolderForVaultPath(targetPath, rootId);
          return folder && folder.id ? String(folder.id) : "";
        } catch (error) {
          console.warn("Failed to find matching Eagle folder for current context:", error);
          return "";
        }
      }
    };
    
    class EagleAssetsView extends ItemView {
      constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentFilePath = "";
        this.currentContext = null;
        this.sourceLeaf = null;
        this.parentContext = null;
        this.repairChoice = null;
        this.isLibraryMode = false;
        this.libraryModePinned = false;
        this.loadRequestId = 0;
        // Source and reference status are independent. A local attachment can be
        // referenced or unreferenced too, so source must not be a status category.
        this.librarySourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
        this.libraryReferenceFilters = new Set(["referenced", "unreferenced", "trash"]);
        this.contextSourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
        this.libraryReferenceSummary = null;
        this.libraryReferenceSummaryGeneration = 0;
        this.libraryReferenceSummaryTask = null;
        this.libraryControls = null;
        this.libraryStatsEl = null;
        this.assetViewportStates = new Map();
        this.pendingAssetViewportState = null;
        this.backgroundSyncScheduler = new KeyedTaskScheduler();
        this.assetRenderGeneration = 0;
        this.pendingAssetCardClick = 0;
        this.selectedAssetItems = new Map();
        this.assetSelectionAnchorKey = "";
      }
    
      getViewType() {
        return VIEW_TYPE;
      }
    
      getDisplayText() {
        return "OE Link";
      }
    
      getIcon() {
        return "eagle-outline";
      }
    
      async onOpen() {
        this.registerDomEvent(document, "pointerdown", event => {
          if (event.button !== 0 || !this.selectedAssetItems.size) return;
          const target = event.target instanceof Element ? event.target : null;
          if (!target || target.closest(".eaglebridge-note-assets-grid, .menu, .modal-container, .suggestion-container")) return;
          this.clearAssetSelection();
        }, true);
        await this.loadForCurrentNote(false);
      }
    
      async onClose() {
        this.loadRequestId += 1;
        this.backgroundSyncScheduler.clear();
        this.disposeAssetRendering();
      }
    
      beginLoad(requestId) {
        if (typeof requestId === "number") {
          this.loadRequestId = Math.max(this.loadRequestId, requestId);
          return requestId;
        }
        this.loadRequestId += 1;
        return this.loadRequestId;
      }
    
      isCurrentLoad(requestId) {
        return requestId === this.loadRequestId;
      }
    
      invalidateLibraryReferenceSummary() {
        this.libraryReferenceSummary = null;
        this.libraryReferenceSummaryGeneration += 1;
      }
    
      async getLibraryReferenceSummary() {
        while (!this.libraryReferenceSummary) {
          if (this.libraryReferenceSummaryTask) {
            await this.libraryReferenceSummaryTask.promise;
            continue;
          }
    
          const generation = this.libraryReferenceSummaryGeneration;
          const task = { generation, promise: null };
          task.promise = this.plugin.getObsidianLibraryReferenceSummary()
            .then(summary => {
              if (this.libraryReferenceSummaryGeneration === generation) {
                this.libraryReferenceSummary = summary;
              }
              return summary;
            })
            .finally(() => {
              if (this.libraryReferenceSummaryTask === task) {
                this.libraryReferenceSummaryTask = null;
              }
            });
          this.libraryReferenceSummaryTask = task;
          await task.promise;
        }
        return this.libraryReferenceSummary;
      }
    
      getAssetViewportKey() {
        if (this.isLibraryMode) return "library";
        return this.currentFilePath ? `context:${this.currentFilePath}` : "";
      }
    
      getAssetScrollArea() {
        return this.containerEl.children[1]?.querySelector(".eaglebridge-note-assets-scroll-area") || null;
      }
    
      captureAssetViewportState(key = this.getAssetViewportKey()) {
        const scrollArea = this.getAssetScrollArea();
        if (!key || !scrollArea) return null;
        const state = {
          scrollTop: scrollArea.scrollTop,
          renderedCount: scrollArea.querySelectorAll(".eaglebridge-note-assets-card").length
        };
        this.assetViewportStates.set(key, state);
        return state;
      }
    
      prepareAssetViewportRestore(targetKey) {
        const currentKey = this.getAssetViewportKey();
        const currentState = currentKey === targetKey ? this.captureAssetViewportState(currentKey) : null;
        this.pendingAssetViewportState = currentState || this.assetViewportStates.get(targetKey) || null;
      }
    
      enterContextMode(context, parentContext = null) {
        this.isLibraryMode = false;
        this.libraryControls = null;
        this.libraryStatsEl = null;
        this.currentFilePath = context.file.path;
        this.currentContext = context;
        this.parentContext = parentContext;
        this.sourceLeaf = this.plugin.findPreferredMarkdownLeaf(context.file.path, this.sourceLeaf);
      }
    
      enterLibraryMode() {
        this.currentFilePath = "";
        this.currentContext = null;
        this.sourceLeaf = null;
        this.parentContext = null;
        this.repairChoice = null;
        this.isLibraryMode = true;
      }
    
      async toggleLibraryMode() {
        if (this.isLibraryMode) {
          this.libraryModePinned = false;
          await this.loadForCurrentNote(false);
          return;
        }
        this.libraryModePinned = true;
        await this.loadObsidianLibrary();
      }
    
      async loadForContext(context, options = {}) {
        const requestId = this.beginLoad(options.requestId);
        const sameContext = this.currentFilePath === context.file.path
          && this.currentContext
          && this.currentContext.kind === context.kind;
        this.prepareAssetViewportRestore(`context:${context.file.path}`);
        this.enterContextMode(context, options.parentContext || null);
        if (sameContext) {
          this.setLoadingState(true);
        } else {
          this.renderLoading(context);
        }
    
        try {
          const items = await this.plugin.queryEagleItemsForNoteContext(context);
          if (!this.isCurrentLoad(requestId) || this.isLibraryMode || this.currentFilePath !== context.file.path) return;
          this.renderItems(context, items, { preserveToolbar: sameContext });
          await this.plugin.rememberCurrentFileEagleBridgeIds(context.file);
          if (!this.isCurrentLoad(requestId) || this.isLibraryMode || this.currentFilePath !== context.file.path) return;
          this.syncContextInBackground(context, requestId);
        } catch (error) {
          if (!this.isCurrentLoad(requestId)) return;
          this.renderEmpty(`Failed to read Eagle: ${error.message || error}`);
        } finally {
          if (this.isCurrentLoad(requestId)) this.setLoadingState(false);
        }
      }
    
      syncContextInBackground(context, requestId) {
        this.backgroundSyncScheduler.schedule("context", 0, async () => {
          try {
            if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
            if (this.plugin.settings.autoImportAttachments !== false) {
              await this.plugin.importAttachmentsForContext(context, { silent: true, organize: false, refresh: false });
            }
            if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
            if (this.plugin.settings.autoTagOnRefresh !== false) {
              await this.plugin.reconcileCurrentContextEagleBridgeTags(context, null, false);
            }
            if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
            if (this.plugin.settings.autoFolderOnImport !== false) {
              await this.plugin.organizeCurrentContextEagleItemsIntoFolder(context, null, { createMissing: true });
            }
          } catch (error) {
            console.warn("Failed to run background Eagle sync:", error);
          }
        }, 0);
      }
    
      async loadForCurrentNote(showNotice = true) {
        if (this.libraryModePinned && this.isLibraryMode) return;
        const requestId = this.beginLoad();
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) {
          await this.loadObsidianLibrary({ requestId });
          return;
        }
        if (!isSupportedSourceFile(file)) {
          if (showNotice) new Notice(this.plugin.t("noticeOpenNoteOrCanvas"));
          return;
        }
        const context = await this.plugin.getAssetContext(file, showNotice);
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!this.isCurrentLoad(requestId) || !activeFile || activeFile.path !== file.path) return;
        this.repairChoice = null;
        await this.loadForContext(context, { requestId });
        if (!this.isCurrentLoad(requestId)) return;
        this.plugin.scheduleTrashStatusScan(document);
      }
    
      async loadObsidianLibrary(options = {}) {
        const requestId = this.beginLoad(options.requestId);
        if (options.resetReferenceSummary) this.invalidateLibraryReferenceSummary();
        this.prepareAssetViewportRestore("library");
        const preserveToolbar = this.isLibraryMode;
        this.enterLibraryMode();
        const root = preserveToolbar ? this.containerEl.children[1] : this.getRoot();
        if (!preserveToolbar) this.renderToolbar(root, null, null, { libraryMode: true });
        const content = this.getContentRoot(root);
        this.renderLibraryHeader(content);
        const progress = content.createEl("div", { cls: "eaglebridge-note-assets-stats" });
        this.libraryStatsEl = progress;
        this.renderLibraryStats(this.libraryReferenceSummary, progress);
        try {
          let summary = this.libraryReferenceSummary;
          if (!summary) {
            progress.setText(this.plugin.t("obsidianLibraryLoading"));
            summary = await this.getLibraryReferenceSummary();
          }
          if (!this.isCurrentLoad(requestId) || !this.isLibraryMode) return;
          const visibleItems = this.getFilteredLibraryItems(summary);
          const pager = this.plugin.createArrayPager(visibleItems);
          const initialCount = Math.max(24, Number(this.pendingAssetViewportState?.renderedCount) || 0);
          const initial = await pager.nextPage(initialCount);
          this.renderLibraryStats(summary, progress);
          if (!initial.items.length) {
            content.createDiv({
              cls: "eaglebridge-library-filter-empty",
              text: summary.items.length
                ? this.plugin.t("obsidianLibraryFilterEmpty")
                : this.plugin.t("obsidianLibraryEmpty")
            });
            return;
          }
          this.renderAssetGrid(content, initial.items, {
            loadMore: () => pager.nextPage(24),
            onRendered: () => {}
          });
        } catch (error) {
          progress.setText(`Failed to read Eagle: ${error.message || error}`);
        }
      }
    
      renderLibraryStats(summary, target = this.libraryStatsEl) {
        if (!target) return;
        target.empty();
        if (!summary) {
          target.setText(this.plugin.t("obsidianLibraryLoading"));
          return;
        }
        target.addClass("eaglebridge-library-filter-stats");
        const sourceItems = [
          ["eagle", "Eagle 库内", "is-eagle"],
          ["local", "Obsidian 库内", "is-local"],
          ["external-local", "Obsidian 库外", "is-external-local"],
          ["internet", "网络", "is-internet"]
        ];
        const referenceItems = [
          ["referenced", this.plugin.t("libraryReferenced"), "is-referenced"],
          ["unreferenced", this.plugin.t("libraryUnreferenced"), "is-unreferenced"]
        ];
        const activeSources = this.getEffectiveLibraryFilterSet(this.librarySourceFilters, sourceItems.map(([key]) => key));
        const activeReferences = this.getEffectiveLibraryFilterSet(this.libraryReferenceFilters, referenceItems.map(([key]) => key));
        const includeTrash = this.libraryReferenceFilters.has("trash");
        const itemMatches = (item, sources, references) => {
          return sources.has(this.getLibraryItemSource(item))
            && references.has(this.getLibraryItemReferenceState(item))
            && (includeTrash || !this.isLibraryItemTrashed(item));
        };
        const visibleCount = summary.items.filter(item => itemMatches(item, activeSources, activeReferences)).length;
        const stats = target.createDiv({ cls: "eaglebridge-library-filter-summary" });
        stats.createEl("span", {
          cls: "eaglebridge-note-assets-stat eaglebridge-note-assets-stat-total",
          text: this.plugin.t("totalAssets", { count: summary.total })
        });
        stats.createEl("span", {
          cls: "eaglebridge-note-assets-stat eaglebridge-note-assets-stat-visible",
          text: `当前显示: ${visibleCount}`
        });
        stats.createEl("span", {
          cls: `eaglebridge-note-assets-stat eaglebridge-note-assets-stat-selected${this.selectedAssetItems.size ? "" : " is-hidden"}`,
          text: `${this.plugin.t("selectedAssetsStat", { count: this.selectedAssetItems.size })} · ${this.plugin.t("selectionInlineHint")}`
        });
    
        const renderBar = (kind, entries, selected, selectedValues, counts) => {
          const section = target.createDiv({ cls: `eaglebridge-library-filter-bar-section is-${kind}` });
          const bar = section.createDiv({
            cls: "eaglebridge-library-filter-bar",
            attr: { role: "group" }
          });
          const total = entries.reduce((sum, [key]) => sum + (counts[key] || 0), 0);
          for (const [key, label, colorClass] of entries) {
            const count = counts[key] || 0;
            const isSelected = selectedValues.has(key);
            const button = bar.createEl("button", {
              cls: `eaglebridge-library-filter-segment ${colorClass}${isSelected ? " is-enabled" : ""}`,
              text: String(count),
              attr: {
                type: "button",
                "aria-label": label,
                "aria-pressed": isSelected ? "true" : "false"
              }
            });
            button.style.flex = total && count / total >= 0.03 ? `${count} 1 0px` : "0 0 22px";
            button.addEventListener("click", async event => {
              event.preventDefault();
              event.stopPropagation();
              if (selected.has(key)) selected.delete(key);
              else selected.add(key);
              await this.loadObsidianLibrary();
            });
          }
          return section;
        };
    
        const sourceCounts = Object.fromEntries(sourceItems.map(([key]) => [key, 0]));
        for (const item of summary.items) {
          sourceCounts[this.getLibraryItemSource(item)] += 1;
        }
        renderBar("source", sourceItems, this.librarySourceFilters, activeSources, sourceCounts);
    
        const referenceCounts = Object.fromEntries(referenceItems.map(([key]) => [key, 0]));
        for (const item of summary.items) {
          if (activeSources.size && activeSources.has(this.getLibraryItemSource(item))) {
            referenceCounts[this.getLibraryItemReferenceState(item)] += 1;
          }
        }
        const referenceSection = renderBar("reference", referenceItems, this.libraryReferenceFilters, activeReferences, referenceCounts);
        const trashCount = summary.items.filter(item => activeSources.has(this.getLibraryItemSource(item))
          && activeReferences.has(this.getLibraryItemReferenceState(item))
          && this.isLibraryItemTrashed(item)).length;
        const sourceCount = summary.items.filter(item => activeSources.has(this.getLibraryItemSource(item))).length;
        const trashButton = referenceSection.createEl("button", {
          cls: `eaglebridge-library-trash-filter${includeTrash ? " is-enabled" : ""}`,
          text: String(trashCount),
          attr: { type: "button", "aria-label": this.plugin.t("trashLabel"), "aria-pressed": String(includeTrash) }
        });
        trashButton.style.flexBasis = `clamp(28px, ${sourceCount ? Math.round(trashCount / sourceCount * 100) : 0}%, 40%)`;
        setTooltip(trashButton, this.plugin.t("trashLabel"));
        trashButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          if (includeTrash) this.libraryReferenceFilters.delete("trash");
          else this.libraryReferenceFilters.add("trash");
          await this.loadObsidianLibrary();
        });
      }
    
      getLibraryAssetKey(item) {
        return this.plugin.getLibraryAssetKey(item);
      }
    
      getAssetSelectionKey(item) {
        if (!item) return "";
        const base = this.getLibraryAssetKey(item) || String(item.id || "");
        if (!base) return "";
        if (!this.isLibraryMode && typeof item.__sourceStart === "number") {
          return `${this.currentFilePath}:${item.__sourceStart}:${item.__sourceEnd}:${base}`;
        }
        return base;
      }
      isAssetImportable(item) {
        const source = String(item && item.__assetSource || "eagle");
        if (source === "external-local" && this.plugin.settings.importExternalLocalAttachments !== true) return false;
        if (source !== "local" && source !== "external-local" && source !== "internet") return false;
        return !this.isLibraryMode || this.getReferencedFilesForLibraryItem(item).length > 0;
      }
      updateAssetSelectionUi() {
        for (const card of this.containerEl.querySelectorAll(".eaglebridge-note-assets-card[data-asset-selection-key]")) {
          const checked = this.selectedAssetItems.has(card.dataset.assetSelectionKey || "");
          card.toggleClass("is-selected", checked);
          card.setAttr("aria-selected", String(checked));
        }
        const count = this.selectedAssetItems.size;
        for (const stat of this.containerEl.querySelectorAll(".eaglebridge-note-assets-stat-selected")) {
          stat.setText(`${this.plugin.t("selectedAssetsStat", { count })} · ${this.plugin.t("selectionInlineHint")}`);
          stat.toggleClass("is-hidden", count === 0);
        }
      }
      clearAssetSelection() {
        if (!this.selectedAssetItems.size) return;
        this.selectedAssetItems.clear();
        this.assetSelectionAnchorKey = "";
        this.updateAssetSelectionUi();
      }
      selectAssetFromClick(item, event, items) {
        const key = this.getAssetSelectionKey(item);
        if (!key) return false;
        if (event.shiftKey && this.assetSelectionAnchorKey) {
          const anchorIndex = items.findIndex(candidate => this.getAssetSelectionKey(candidate) === this.assetSelectionAnchorKey);
          const itemIndex = items.findIndex(candidate => this.getAssetSelectionKey(candidate) === key);
          if (anchorIndex >= 0 && itemIndex >= 0) {
            if (!event.ctrlKey && !event.metaKey) this.selectedAssetItems.clear();
            const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
            for (const candidate of items.slice(start, end + 1)) {
              const candidateKey = this.getAssetSelectionKey(candidate);
              if (candidateKey) this.selectedAssetItems.set(candidateKey, candidate);
            }
          }
        } else if (event.ctrlKey || event.metaKey) {
          if (this.selectedAssetItems.has(key)) this.selectedAssetItems.delete(key);
          else this.selectedAssetItems.set(key, item);
          this.assetSelectionAnchorKey = key;
        } else {
          this.selectedAssetItems.clear();
          this.selectedAssetItems.set(key, item);
          this.assetSelectionAnchorKey = key;
        }
        this.updateAssetSelectionUi();
        return event.shiftKey || event.ctrlKey || event.metaKey;
      }
      selectAssetForContextMenu(item) {
        const key = this.getAssetSelectionKey(item);
        if (!key || this.selectedAssetItems.has(key)) return;
        this.selectedAssetItems.clear();
        this.selectedAssetItems.set(key, item);
        this.assetSelectionAnchorKey = key;
        this.updateAssetSelectionUi();
      }
      async importSelectedAssets() {
        const items = Array.from(this.selectedAssetItems.values())
          .filter(item => this.isAssetImportable(item))
          .sort((a, b) => Number(b.__sourceStart || 0) - Number(a.__sourceStart || 0));
        if (!items.length) {
          new Notice(this.plugin.t("noImportableSelectedAssets"));
          return;
        }
        const total = { success: 0, reused: 0, failed: 0 };
        const addResult = result => {
          if (!result) {
            total.failed += 1;
            return;
          }
          total.success += Number(result.success) || 0;
          total.reused += Number(result.reused) || 0;
          total.failed += Number(result.failed) || 0;
        };
        const importOne = async item => {
          const source = String(item && item.__assetSource || "eagle");
          if (this.isLibraryMode) {
            const files = this.getReferencedFilesForLibraryItem(item);
            if (source === "local") return this.plugin.importLocalAttachmentItemFromLibrary(item, files, { silent: true });
            if (source === "external-local") return this.plugin.importExternalLocalAttachmentItemFromLibrary(item, files, { silent: true });
            return this.plugin.importInternetAttachmentItemFromLibrary(item, files, { silent: true });
          }
          if (source === "local") return this.plugin.importLocalAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
          if (source === "external-local") return this.plugin.importExternalLocalAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
          return this.plugin.importInternetAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
        };
        await this.plugin.runWithReferenceViewRefreshPaused(async () => {
          for (const item of items) {
            try {
              addResult(await importOne(item));
            } catch (error) {
              console.warn("Failed to import selected attachment:", item, error);
              total.failed += 1;
            }
          }
        }, this.currentContext && this.currentContext.file);
        new Notice(this.plugin.t("noticeProcessedAttachments", total));
        this.clearAssetSelection();
        await this.reloadDisplayedContext(false);
      }
      isLibraryAssetReferenced(item) {
        const summary = this.libraryReferenceSummary;
        const refs = summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.get(this.getLibraryAssetKey(item));
        return !!(refs && refs.size);
      }
    
      getLibraryItemSource(item) {
        const source = String(item && item.__assetSource || "eagle");
        return source === "local" || source === "external-local" || source === "internet" ? source : "eagle";
      }
    
      getLibraryItemReferenceState(item) {
        return this.isLibraryAssetReferenced(item) ? "referenced" : "unreferenced";
      }
    
      isLibraryItemTrashed(item) {
        return !!(item && item.__inObsidianTrash)
          || String(item && item.__assetSource || "eagle") === "trash"
          || isEagleItemTrashed(item);
      }
      getEffectiveLibraryFilterSet(filters, allValues) {
        return filters instanceof Set ? filters : new Set(allValues);
      }
    
      getFilteredLibraryItems(summary) {
        if (!summary || !Array.isArray(summary.items)) return [];
        const sources = this.getEffectiveLibraryFilterSet(this.librarySourceFilters, ["eagle", "local", "external-local", "internet"]);
        const references = this.getEffectiveLibraryFilterSet(this.libraryReferenceFilters, ["referenced", "unreferenced"]);
        const includeTrash = this.libraryReferenceFilters.has("trash");
        return summary.items.filter(item => {
          return sources.has(this.getLibraryItemSource(item))
            && references.has(this.getLibraryItemReferenceState(item))
            && (includeTrash || !this.isLibraryItemTrashed(item));
        });
      }
    
      getAssetStatusMarkerEntries(item, isTrashed) {
        const source = this.getLibraryItemSource(item);
        const sourceLabels = {
          eagle: this.plugin.t("inEagle"),
          local: this.plugin.t("obsidianLocal"),
          "external-local": this.plugin.t("obsidianExternalLocal"),
          internet: this.plugin.t("internetAsset")
        };
        const sourceLabel = sourceLabels[source] || source;
        const entries = [{ className: `is-${source}`, label: sourceLabel }];
        if (this.isLibraryMode) {
          const isReferenced = this.isLibraryAssetReferenced(item);
          entries.push({
            className: isReferenced ? "is-referenced" : "is-unreferenced",
            label: this.plugin.t(isReferenced ? "libraryReferenced" : "libraryUnreferenced")
          });
          if (isTrashed) entries.push({ className: "is-trash", label: this.plugin.t("trashLabel") });
        }
        return entries;
      }
      renderAssetStatusMarkers(card, entries) {
        const statusGroup = card.createDiv({ cls: "eaglebridge-asset-status-markers" });
        for (const entry of entries) {
          const marker = statusGroup.createSpan({
            cls: `eaglebridge-asset-status-marker ${entry.className}`,
            attr: { role: "img", "aria-label": entry.label }
          });
          setTooltip(marker, entry.label);
        }
      }
    
      async trashLibraryAssets(itemIds, successMessageKey, logMessage) {
        const ids = Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean)));
        if (!ids.length) return 0;
        try {
          const moved = await this.plugin.moveEagleItemsToTrashViaHelper(ids);
          new Notice(this.plugin.t(successMessageKey, { count: moved }));
          this.invalidateLibraryReferenceSummary();
          this.librarySourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
          this.libraryReferenceFilters = new Set(["referenced", "unreferenced", "trash"]);
          await this.loadObsidianLibrary();
          return moved;
        } catch (error) {
          console.warn(logMessage, error);
          new Notice(`移入 Eagle 回收站失败：${error && error.message ? error.message : error}`);
          return 0;
        }
      }
    
      getReferencedFilesForLibraryItem(itemOrId) {
        const summary = this.libraryReferenceSummary;
        const key = typeof itemOrId === "string"
          ? (summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.has(itemOrId)
            ? itemOrId
            : `eagle:${stripInfoSuffix(itemOrId)}`)
          : this.getLibraryAssetKey(itemOrId);
        const paths = summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.get(key);
        return Array.from(paths || [])
          .map(path => this.plugin.app.vault.getAbstractFileByPath(path))
          .filter(file => file instanceof TFile);
      }
    
      async getReferencedFilesForPreview(item) {
        const known = this.getReferencedFilesForLibraryItem(item);
        if (known.length || this.libraryReferenceSummary) return known;
    
        const collected = await this.plugin.collectObsidianLibrarySourceAssets();
        const key = this.getLibraryAssetKey(item);
        const source = String(item && item.__assetSource || "eagle");
        let paths = collected.sourceReferences.get(key);
    
        if ((!paths || !paths.size) && source !== "local" && source !== "external-local" && source !== "internet") {
          const itemId = stripInfoSuffix(getEagleItemId(item));
          paths = itemId ? collected.eagleReferenceFilesById.get(itemId) : null;
        }
    
        return Array.from(paths || [])
          .map(path => this.plugin.app.vault.getAbstractFileByPath(path))
          .filter(file => file instanceof TFile);
      }
    
      async openSourceFileInNewTab(file) {
        if (!(file instanceof TFile)) return;
        const leaf = this.plugin.app.workspace.getLeaf("tab");
        await leaf.openFile(file, { active: true });
      }
      async getAssetOriginalPath(item) {
        const localFile = item && item.__localFile;
        if (localFile instanceof TFile) return this.plugin.getFullPath(localFile);
        if (item && item.__assetSource === "external-local") return String(item.__externalLocalPath || "");
        if (item && item.__assetSource !== "internet") return await this.plugin.getOriginalPathForEagleItem(item) || "";
        return "";
      }
      async openLibraryAssetWithDefaultApp(item) {
        const fullPath = await this.getAssetOriginalPath(item);
        if (!fullPath) throw new Error("无法找到该附件的原始文件。");
        const electron = require("electron");
        const result = await electron.shell.openPath(fullPath);
        if (result) throw new Error(result);
      }
    
      async copyAssetImageToClipboard(item) {
        const { clipboard, nativeImage } = require("electron");
        const paths = [];
        if (item && item.__localFile instanceof TFile) {
          paths.push(this.plugin.getFullPath(item.__localFile));
        }
        if (item && item.__assetSource === "external-local" && item.__externalLocalPath) {
          paths.push(item.__externalLocalPath);
        }
        if (item && item.__assetSource !== "internet") {
          paths.push(await this.plugin.getOriginalPathForEagleItem(item));
        }
        for (const filePath of paths.filter(Boolean)) {
          const image = nativeImage.createFromPath(filePath);
          if (!image.isEmpty()) {
            clipboard.writeImage(image);
            return;
          }
          clipboard.writeBuffer("application/x-eaglebridge-attachment", nodeFs.readFileSync(filePath));
          clipboard.writeText(`file:///${filePath.replace(/\\/g, "/")}`);
          return;
        }
        const url = item && (item.resourceURL || item.fileURL || item.url);
        if (url) {
          const response = await requestUrl({ url, method: "GET" });
          const image = nativeImage.createFromBuffer(Buffer.from(response.arrayBuffer));
          if (!image.isEmpty()) {
            clipboard.writeImage(image);
            return;
          }
          clipboard.writeBuffer("application/x-eaglebridge-attachment", Buffer.from(response.arrayBuffer));
          clipboard.writeText(url);
          return;
        }
        throw new Error("\u65e0\u6cd5\u8bfb\u53d6\u6b64\u56fe\u7247\u7684\u539f\u59cb\u6570\u636e\u3002");
      }
      async copyAssetsToClipboard(items) {
        const selected = Array.from(items || []).filter(Boolean);
        if (selected.length === 1) return this.copyAssetImageToClipboard(selected[0]);
        const paths = await Promise.all(selected.map(item => this.getAssetOriginalPath(item)));
        if (!paths.length || paths.some(filePath => !filePath)) throw new Error(this.plugin.t("bulkCopyLocalFilesOnly"));
        if (process.platform !== "win32") throw new Error(this.plugin.t("bulkCopyWindowsOnly"));
        const payload = Buffer.from(JSON.stringify(paths), "utf8").toString("base64");
        const script = `$paths=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json; Add-Type -AssemblyName System.Windows.Forms; $files=New-Object Collections.Specialized.StringCollection; foreach($path in $paths){[void]$files.Add($path)}; [Windows.Forms.Clipboard]::SetFileDropList($files)`;
        await new Promise((resolve, reject) => require("child_process").execFile(
          "powershell.exe",
          ["-NoProfile", "-STA", "-Command", script],
          { windowsHide: true },
          error => error ? reject(error) : resolve()
        ));
      }
    
      isPreviewableAssetItem(item) {
        if (item && item.__isImage) return true;
        const extension = normalizeExtension(getAssetExtension(item));
        const candidates = [
          getAssetDisplayName(item),
          item && item.resourceURL,
          item && item.fileURL,
          item && item.url,
          extension ? `attachment${extension}` : ""
        ];
        return candidates.some(candidate => isPreviewableImage(candidate));
      }
    
      async openAssetPreview(item) {
        if (!this.isPreviewableAssetItem(item)) return;
        const itemSource = String(item && item.__assetSource || "eagle");
        const eagleItemId = itemSource === "eagle" || itemSource === "trash"
          ? stripInfoSuffix(getEagleItemId(item))
          : "";
        const bridgeUrl = eagleItemId ? this.plugin.getEagleBridgeUrl(item) : "";
        const source = bridgeUrl
          || (item && item.__assetSource === "internet" && (item.url || item.fileURL))
          || (item && item.resourceURL)
          || (item && (item.fileURL || item.url));
        if (!source) {
          new Notice("\u65e0\u6cd5\u8bfb\u53d6\u6b64\u9644\u4ef6\u7684\u9884\u89c8\u3002");
          return;
        }
    
        // Prefer the actual action attached to the currently rendered editor
        // image. Off-screen embeds do not receive Obsidian's native lightbox.
        try {
          const normalizeSource = (value) => {
            try {
              return new URL(String(value || ""), window.location.href).href;
            } catch (_) {
              return String(value || "");
            }
          };
          const expectedSource = normalizeSource(source);
          const matchingImages = Array.from(document.querySelectorAll("img[src]")).filter((image) => {
            const imageSource = String(image.getAttribute("src") || "");
            const imageItemId = stripInfoSuffix(extractEagleBridgeItemIdFromText(imageSource));
            if (eagleItemId && imageItemId === eagleItemId) return true;
            return normalizeSource(imageSource) === expectedSource;
          });
          // Prefer the active editor image over the same image rendered in this sidebar.
          const matchingImage = matchingImages.find(image => image.closest(".image-embed, .table-cell-wrapper"))
            || matchingImages[0];
          const imageContainer = matchingImage?.closest(".image-embed")
            || matchingImage?.parentElement?.parentElement
            || matchingImage?.parentElement;
          const findNativeZoomAction = () => imageContainer?.querySelector('.embed-action[aria-label="放大"]')
            || imageContainer?.querySelector('.embed-action .lucide-zoom-in')?.closest(".embed-action")
            || imageContainer?.querySelector('.embed-action[aria-label="Zoom"]')
            || imageContainer?.querySelector('.embed-action:not(.edit-block-button)');
          const tableCell = matchingImage?.closest(".table-cell-wrapper")?.closest("td");
          const findFloatingTableZoomAction = (imageRect) => {
            if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) return null;
            const actions = Array.from(document.querySelectorAll(".embed-action"))
              .filter(action => !action.classList.contains("edit-block-button"))
              .filter(action => action.querySelector(".lucide-zoom-in"))
              .map(action => ({ action, rect: action.getBoundingClientRect() }))
              .filter(({ rect }) => {
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                return rect.width > 0
                  && rect.height > 0
                  && centerX >= imageRect.left - 16
                  && centerX <= imageRect.right + 16
                  && centerY >= imageRect.top - 16
                  && centerY <= imageRect.bottom + 16;
              });
            if (actions.length !== 1) return null;
            return actions[0].action;
          };
    
          if (tableCell && matchingImage) {
            // Table cells use their own editor. A complete pointer sequence activates
            // that editor, after which Obsidian creates the native image-preview action.
            const imageRect = matchingImage.getBoundingClientRect();
            const view = matchingImage.ownerDocument?.defaultView || window;
            const point = {
              clientX: imageRect.left + imageRect.width / 2,
              clientY: imageRect.top + imageRect.height / 2
            };
            const pointerOptions = {
              bubbles: true,
              cancelable: true,
              composed: true,
              view,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: 1,
              ...point
            };
            tableCell.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
            tableCell.dispatchEvent(new PointerEvent("pointerup", { ...pointerOptions, buttons: 0 }));
            tableCell.dispatchEvent(new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              view,
              button: 0,
              buttons: 0,
              ...point
            }));
            await new Promise(resolve => window.setTimeout(resolve, 180));
            const tableZoomAction = findFloatingTableZoomAction(imageRect);
            if (tableZoomAction) {
              tableZoomAction.click();
              return;
            }
          }
    
          let nativeZoomAction = findNativeZoomAction();
          if (nativeZoomAction) {
            nativeZoomAction.click();
            return;
          }
        } catch (error) {
          console.warn("Failed to access the active editor image zoom action.", error);
        }
    
        new Notice("Obsidian 当前无法为这个附件调用原生放大预览。");
      }
    
      async getAssetReferenceLink(item) {
        let link = "";
        if (item && item.__localFile instanceof TFile) {
          link = `![[${item.__localFile.path}]]`;
        } else if (item && item.__assetSource === "external-local" && item.__externalLocalPath) {
          link = `![${getAssetDisplayName(item) || "attachment"}](<${normalizeFileUrl(item.__externalLocalPath)}>)`;
        } else if (item && item.__assetSource === "internet") {
          const url = cleanExternalAttachmentUrl(item.resourceURL || item.fileURL || item.url);
          const itemId = extractEagleBridgeItemIdFromText(url);
          if (itemId && this.plugin.isEagleBridgeAssetUrl(url)) {
            const eagleItem = await this.plugin.queryEagleItemInfo(itemId) || item;
            const displayName = this.plugin.getCanonicalEagleFileName(eagleItem, getAssetDisplayName(eagleItem));
            link = this.plugin.buildReplacement({ name: displayName }, { displayName, itemId, bridgeUrl: url, url });
          } else if (url) {
            link = `![${getAssetDisplayName(item) || "image"}](${url})`;
          }
        } else {
          const itemId = stripInfoSuffix(getEagleItemId(item));
          if (itemId) {
            const displayName = this.plugin.getCanonicalEagleFileName(item, getAssetDisplayName(item));
            const bridgeUrl = this.plugin.getEagleBridgeUrl(item) || `${this.plugin.settings.eagleBridgeBaseUrl}/images/${itemId}.info`;
            link = this.plugin.buildReplacement({ name: displayName }, { displayName, itemId, bridgeUrl, url: bridgeUrl });
          }
        }
        if (!link) throw new Error("\u65e0\u6cd5\u751f\u6210\u6b64\u9644\u4ef6\u7684\u5f15\u7528\u94fe\u63a5\u3002");
        return link;
      }
      async copyAssetReferenceLinks(items) {
        const links = await Promise.all(Array.from(items || []).map(item => this.getAssetReferenceLink(item)));
        const text = links.join("\n");
        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          require("electron").clipboard.writeText(text);
        }
        return text;
      }
      async copyAssetReferenceLink(item) {
        return this.copyAssetReferenceLinks([item]);
      }
    
      async trashSingleUnreferencedLibraryAsset(itemId) {
        const cleanId = stripInfoSuffix(itemId);
        if (!cleanId) return;
        if (this.isLibraryAssetReferenced({ id: cleanId, __assetSource: "eagle", __libraryKey: `eagle:${cleanId}` })) {
          new Notice("该素材仍被笔记或白板引用，不能移入 Eagle 回收站。");
          return;
        }
        await this.trashLibraryAssets([cleanId], "trashedSingleUnreferencedAsset", "Failed to move Eagle asset to trash");
      }
    
      async reloadDisplayedContext(showNotice = false) {
        if (this.isLibraryMode) {
          await this.loadObsidianLibrary({ resetReferenceSummary: true });
          return;
        }
        if (this.currentContext && this.currentContext.file instanceof TFile) {
          await this.loadForContext(this.currentContext, { parentContext: this.parentContext });
          return;
        }
        await this.loadForCurrentNote(showNotice);
      }
    
      async drillIntoCanvasNote(item) {
        const noteFile = item && item.__noteFile;
        const parentContext = this.currentContext && this.currentContext.kind === "canvas"
          ? this.currentContext
          : this.parentContext;
        if (!(noteFile instanceof TFile) || !parentContext) return;
        const context = await this.plugin.getNoteContext(noteFile, false);
        this.repairChoice = null;
        await this.loadForContext(context, { parentContext });
      }
    
      async returnToParentContext() {
        if (!this.parentContext) return;
        const context = this.parentContext;
        this.repairChoice = null;
        await this.loadForContext(context);
      }
    
      getRoot() {
        this.disposeAssetRendering();
        const root = this.containerEl.children[1];
        root.empty();
        root.addClass("eaglebridge-note-assets-view");
        return root;
      }
    
      getContentRoot(root = this.containerEl.children[1]) {
        this.disposeAssetRendering();
        this.selectedAssetItems.clear();
        this.assetSelectionAnchorKey = "";
        let content = root.querySelector(".eaglebridge-note-assets-content");
        if (!content) content = root.createDiv({ cls: "eaglebridge-note-assets-content" });
        content.empty();
        return content;
      }
    
      disposeAssetRendering() {
        this.assetRenderGeneration += 1;
        if (typeof this.assetInfiniteScrollCleanup === "function") {
          this.assetInfiniteScrollCleanup();
        }
        this.assetInfiniteScrollCleanup = null;
        this.assetRenderNextBatch = null;
      }
    
      renderLoading(context) {
        const root = this.getRoot();
        this.renderToolbar(root, context, context.file);
        root.createEl("div", {
          cls: "eaglebridge-note-assets-meta",
          text: this.plugin.t("readingLinks", { name: context.file.basename })
        });
      }
    
      setLoadingState(loading) {
        const root = this.containerEl.children[1];
        if (root && root.classList) root.toggleClass("is-loading", !!loading);
      }
    
      renderEmpty(message, file = null) {
        const root = this.getRoot();
        this.renderToolbar(root, null, file);
        root.createEl("div", { cls: "eaglebridge-note-assets-empty", text: message });
      }
    
      renderLibraryHeader(root) {
        const header = root.createDiv({ cls: "eaglebridge-library-header" });
        header.createEl("div", {
          cls: "eaglebridge-note-assets-meta eaglebridge-library-title",
          text: this.plugin.t("obsidianLibrary")
        });
        this.renderInlineViewSwitcher(header, async () => {
          await this.loadObsidianLibrary();
        });
        return header;
      }
    
      renderInlineViewSwitcher(parent, onChange) {
        const switcher = parent.createDiv({ cls: "eaglebridge-library-view-switcher" });
        const currentMode = normalizeAssetViewMode(this.plugin.settings.assetViewMode);
        const modes = [
          ["waterfall", "viewModeWaterfall"],
          ["list", "viewModeList"],
          ["normal", "viewModeNormal"]
        ];
        modes.forEach(([mode, labelKey], index) => {
          if (index) switcher.createSpan({ cls: "eaglebridge-library-view-separator" });
          const label = this.plugin.t(labelKey);
          const button = switcher.createEl("button", {
            cls: currentMode === mode
              ? "eaglebridge-library-view-icon is-enabled"
              : "eaglebridge-library-view-icon"
          });
          button.setAttr("aria-label", label);
          button.setAttr("aria-pressed", String(currentMode === mode));
          button.innerHTML = LIBRARY_VIEW_ICONS[mode];
          button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            if (this.plugin.settings.assetViewMode === mode) return;
            this.plugin.settings.assetViewMode = mode;
            await this.plugin.saveSettings();
            await onChange(mode);
          });
        });
        return switcher;
      }
    
      renderToolbar(root, context = null, file = null, options = {}) {
        const toolbar = root.createDiv({ cls: "eaglebridge-note-assets-toolbar" });
        const getActiveContext = () => this.currentContext || context;
        const createLibraryModeToggle = () => {
          const libraryToggle = toolbar.createEl("button", { cls: "eaglebridge-library-mode-toggle" });
          const label = options.libraryMode ? "\u8fd4\u56de\u5f53\u524d\u7b14\u8bb0" : "\u6253\u5f00 Obsidian \u7d20\u6750\u5e93";
          libraryToggle.setAttr("aria-label", label);
          libraryToggle.innerHTML = "<svg viewBox='0 0 1024 1024' aria-hidden='true'><path d='M453.344 846.256c-0.16 0-0.28 0.088-0.432 0.088-125.264-19.192-234.808-95.264-294.4-210.36-4.992-12.656-17.2-21.744-31.56-21.744h-3.504c-15.2 0-27.68 10.272-32.04 24.08-0.912 2.432-1.16 4.96-1.536 7.536-0.064 0.856-0.504 1.6-0.504 2.48v1.76c-0.04 1.712-0.2 3.32 0 5.048v164.184a34.192 34.192 0 0 0 34.08 34.104h3.504a34.192 34.192 0 0 0 34.08-34.104v-52.92c71.728 80.936 169.368 133.144 276.936 150.6 4.72 2.168 10.768 2.152 16.288 2.152 0.144 0 0.264-0.08 0.408-0.08 0.08 0 0.136 0.032 0.208 0.04v-0.088c20.208-0.352 35.592-15.328 35.592-35.624a37.136 37.136 0 0 0-37.12-37.152zM908.528 191.12h-3.504a34.192 34.192 0 0 0-34.08 34.104v53.352c-69.12-79.888-163.096-132.6-267.296-152.536a36.32 36.32 0 0 0-13.12-3.232c-0.984-0.16-1.896-0.56-2.88-0.72v0.296a36.88 36.88 0 0 0-36.504 36.848 36.872 36.872 0 0 0 36.504 36.848v0.336c122.152 22.44 227.752 99.136 284.864 213.336 3.144 6.28 8.128 10.656 13.68 14.08 5.472 3.76 11.728 6.48 18.832 6.48h3.504a34.184 34.184 0 0 0 34.08-34.096V225.224a34.192 34.192 0 0 0-34.08-34.104z'></path><path d='M172 172v216a16 16 0 0 0 16 16h216a16 16 0 0 0 16-16v-216a16 16 0 0 0-16-16h-216a16 16 0 0 0-16 16z m-4-88h256a68 68 0 0 1 68 68v256a68 68 0 0 1-68 68H168a68 68 0 0 1-68-68V152a68 68 0 0 1 68-68zM620 636v216a16 16 0 0 0 16 16h216a16 16 0 0 0 16-16v-216a16 16 0 0 0-16-16h-216a16 16 0 0 0-16 16z m-4-88h256a68 68 0 0 1 68 68v256a68 68 0 0 1-68 68H616a68 68 0 0 1-68-68V616a68 68 0 0 1 68-68z'></path></svg>";
          libraryToggle.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            libraryToggle.disabled = true;
            try {
              await this.toggleLibraryMode();
            } finally {
              libraryToggle.disabled = false;
            }
          });
          return libraryToggle;
        };
        const createCompoundAutoControl = (parent, options) => {
          const controlClasses = [options.controlClass, "eaglebridge-compound-auto-control"];
          if (options.enabled) controlClasses.push("is-enabled");
          if (options.disabled) controlClasses.push("is-management-disabled");
          const control = parent.createDiv({ cls: controlClasses.join(" ") });
          const primaryButton = control.createEl("button", {
            text: options.primaryText,
            cls: `${options.primaryClass} eaglebridge-compound-primary-button`
          });
          primaryButton.disabled = !!options.primaryDisabled || !!options.disabled;
          primaryButton.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            await options.onPrimary();
          });
          const autoButton = control.createEl("button", {
            cls: `${options.autoClass} eaglebridge-compound-auto-toggle`
          });
          autoButton.disabled = !!options.disabled;
          const track = autoButton.createSpan({ cls: "eaglebridge-auto-toggle-track" });
          track.createSpan({ text: "AUTO", cls: "eaglebridge-auto-toggle-label" });
          track.createSpan({ cls: "eaglebridge-auto-toggle-knob" });
          autoButton.setAttr("aria-pressed", options.enabled ? "true" : "false");
          autoButton.setAttr("aria-label", "AUTO");
          const update = enabled => {
            control.toggleClass("is-enabled", !!enabled);
            autoButton.setAttr("aria-pressed", enabled ? "true" : "false");
          };
          autoButton.addEventListener("mousedown", event => {
            event.preventDefault();
            event.stopPropagation();
          });
          autoButton.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            if (options.disabled) return;
            await options.onToggle(update);
          });
          return { control, primaryButton, autoButton, update };
        };
    
        if (options.libraryMode) {
          createLibraryModeToggle();
          this.libraryControls = null;
          const actionsRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row eaglebridge-library-actions-row" });
          const actionsGroup = actionsRow.createDiv({ cls: "eaglebridge-segmented-group eaglebridge-library-actions-group" });
          const addBulkAction = (label, handler) => {
            const button = actionsGroup.createEl("button", {
              text: label,
              cls: "eaglebridge-segmented-button eaglebridge-library-bulk-action"
            });
            button.addEventListener("click", async event => {
              event.preventDefault();
              event.stopPropagation();
              button.disabled = true;
              try {
                const result = await handler();
                if (result) {
                  this.invalidateLibraryReferenceSummary();
                  await this.loadObsidianLibrary();
                }
              } finally {
                button.disabled = false;
              }
            });
          };
          addBulkAction("导入所有附件", () => this.plugin.confirmAndImportAllUnimportedAttachments());
          addBulkAction("清理导入附件", () => this.plugin.confirmAndCleanupAllImportedLocalCopies());
          return toolbar;
        }
    
        const tagRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
        const tagGroup = tagRow.createDiv({ cls: "eaglebridge-tag-group eaglebridge-segmented-group" });
        const tagManagementDisabled = this.plugin.settings.tagManagementEnabled === false;
        if (tagManagementDisabled) tagRow.style.display = "none";
        createCompoundAutoControl(tagGroup, {
          controlClass: "eaglebridge-tag-auto-control",
          primaryClass: "eaglebridge-add-tags-button",
          autoClass: "eaglebridge-tag-auto-button",
          primaryText: this.plugin.t("addTags"),
          primaryDisabled: !context,
          disabled: tagManagementDisabled,
          enabled: this.plugin.settings.autoTagOnRefresh !== false,
          onPrimary: async () => {
            const activeContext = getActiveContext();
            if (!activeContext) return;
            await this.plugin.reconcileCurrentContextEagleBridgeTags(activeContext, null, true);
            await this.reloadDisplayedContext();
          },
          onToggle: async update => {
            this.plugin.settings.autoTagOnRefresh = this.plugin.settings.autoTagOnRefresh === false;
            update(this.plugin.settings.autoTagOnRefresh);
            await this.plugin.saveSettings();
          }
        });
        const clearTagsButton = tagGroup.createEl("button", {
          text: this.plugin.t("clearObsidianTags"),
          cls: "eaglebridge-clear-ob-tags-button eaglebridge-segmented-button"
        });
        clearTagsButton.disabled = !context || tagManagementDisabled;
        clearTagsButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          const activeContext = getActiveContext();
          if (!activeContext) return;
          const scope = await chooseInObsidianModal(
            this.plugin.app,
            this.plugin.t("clearObsidianTagsTitle"),
            this.plugin.t("noticeConfirmClearObsidianTags"),
            [
              { value: "current", label: this.plugin.t("clearCurrentFileTagsOption"), cta: true },
              { value: "all", label: this.plugin.t("clearAllAttachmentTagsOption") }
            ],
            this.plugin.t("cancel")
          );
          if (!scope) return;
          const updated = await this.plugin.clearObsidianTagsForCurrentContext(activeContext, scope);
          new Notice(this.plugin.t("noticeClearedObsidianTags", { count: updated }));
        });
        const copyButton = tagGroup.createEl("button", {
          text: this.plugin.t("copyFirstTag"),
          cls: "eaglebridge-segmented-button"
        });
        copyButton.disabled = !context || !(context.tags && context.tags.length) || tagManagementDisabled;
        copyButton.addEventListener("click", async () => {
          const activeContext = getActiveContext();
          if (!activeContext || !(activeContext.tags && activeContext.tags.length)) return;
          await navigator.clipboard.writeText(activeContext.tags[0]);
          new Notice(this.plugin.t("noticeCopied", { value: activeContext.tags[0] }));
        });
        createLibraryModeToggle();
    
        const folderRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
        const folderGroup = folderRow.createDiv({ cls: "eaglebridge-folder-group eaglebridge-segmented-group" });
        const folderManagementDisabled = this.plugin.settings.folderManagementEnabled === false;
        if (folderManagementDisabled) folderRow.style.display = "none";
        createCompoundAutoControl(folderGroup, {
          controlClass: "eaglebridge-folder-auto-control",
          primaryClass: "eaglebridge-add-folder-button",
          autoClass: "eaglebridge-folder-auto-button",
          primaryText: this.plugin.t("addToFolder"),
          primaryDisabled: !context,
          disabled: folderManagementDisabled,
          enabled: this.plugin.settings.autoFolderOnImport !== false,
          onPrimary: async () => {
            const activeContext = getActiveContext();
            if (!activeContext) return;
            const moved = await this.plugin.organizeCurrentContextEagleItemsIntoFolder(activeContext, null, { createMissing: true });
            new Notice(this.plugin.t("noticeJoinedFolder", { count: moved }));
            await this.reloadDisplayedContext();
          },
          onToggle: async update => {
            this.plugin.settings.autoFolderOnImport = this.plugin.settings.autoFolderOnImport === false;
            update(this.plugin.settings.autoFolderOnImport);
            await this.plugin.saveSettings();
          }
        });
        const clearFoldersButton = folderGroup.createEl("button", {
          text: this.plugin.t("clearObsidianFolders"),
          cls: "eaglebridge-clear-ob-folders-button eaglebridge-segmented-button"
        });
        clearFoldersButton.disabled = !context || folderManagementDisabled;
        clearFoldersButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          const activeContext = getActiveContext();
          if (!activeContext) return;
          const scope = await chooseInObsidianModal(
            this.plugin.app,
            this.plugin.t("clearObsidianFoldersTitle"),
            this.plugin.t("noticeConfirmClearObsidianFolders"),
            [
              { value: "current", label: this.plugin.t("clearCurrentFileFoldersOption"), cta: true },
              { value: "all", label: this.plugin.t("clearAllAttachmentFoldersOption") }
            ],
            this.plugin.t("cancel")
          );
          if (!scope) return;
          try {
            const result = await this.plugin.clearObsidianFoldersForCurrentContext(activeContext, scope);
            const noticeKey = result.deletedCurrentFolder
              ? "noticeClearedObsidianFoldersAndDeleted"
              : "noticeClearedObsidianFolders";
            new Notice(this.plugin.t(noticeKey, { count: result.updated }));
          } catch (error) {
            console.warn("Failed to clear Obsidian-managed Eagle folders:", error);
            new Notice(this.plugin.t("noticeClearObsidianFoldersNeedsHelper"));
          }
        });
        const importRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
        const importGroup = importRow.createDiv({ cls: "eaglebridge-import-group eaglebridge-segmented-group" });
        createCompoundAutoControl(importGroup, {
          controlClass: "eaglebridge-import-auto-control",
          primaryClass: "eaglebridge-import-button",
          autoClass: "eaglebridge-import-auto-button",
          primaryText: this.plugin.t("importNoteAttachments"),
          primaryDisabled: !context,
          enabled: this.plugin.settings.autoImportAttachments !== false,
          onPrimary: async () => {
            const activeContext = getActiveContext();
            if (!activeContext) return;
            await this.plugin.importAttachmentsForContext(activeContext);
            await this.reloadDisplayedContext();
          },
          onToggle: async update => {
            this.plugin.settings.autoImportAttachments = this.plugin.settings.autoImportAttachments === false;
            update(this.plugin.settings.autoImportAttachments);
            await this.plugin.saveSettings();
          }
        });
        createCompoundAutoControl(importGroup, {
          controlClass: "eaglebridge-cleanup-auto-control",
          primaryClass: "eaglebridge-cleanup-button",
          autoClass: "eaglebridge-delete-local-button",
          primaryText: this.plugin.t("cleanupLocalCopies"),
          primaryDisabled: !context,
          enabled: this.plugin.settings.trashAfterImport,
          onPrimary: async () => {
            const activeContext = getActiveContext();
            if (!activeContext) return;
            await this.plugin.cleanupLocalCopiesForContext(activeContext);
            await this.reloadDisplayedContext();
          },
          onToggle: async update => {
            this.plugin.settings.trashAfterImport = !this.plugin.settings.trashAfterImport;
            update(this.plugin.settings.trashAfterImport);
            await this.plugin.saveSettings();
          }
        });
        return toolbar;
      }
    
      renderItems(context, items, options = {}) {
        const root = options.preserveToolbar ? this.containerEl.children[1] : this.getRoot();
        if (!options.preserveToolbar) this.renderToolbar(root, context, context.file);
        const content = this.getContentRoot(root);
    
        const visibleItems = this.getFilteredContextItems(items);
        this.renderAssetSummary(content, items, context, visibleItems);
        this.renderDrilldownHeader(content);
        this.renderRepairChoice(content);
        this.renderAssetGrid(content, visibleItems);
      }
    
      renderDrilldownHeader(root) {
        if (!this.parentContext || !this.currentContext) return;
        const header = root.createDiv({ cls: "eaglebridge-drilldown-header" });
        const button = header.createEl("button", {
          cls: "eaglebridge-drilldown-back",
          text: this.plugin.t("backToCanvas")
        });
        button.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          await this.returnToParentContext();
        });
        header.createEl("div", {
          cls: "eaglebridge-drilldown-title",
          text: this.plugin.t("viewingEmbeddedNote", { name: this.currentContext.file.name })
        });
      }
    
      renderRepairChoice(root) {
        const choice = this.repairChoice;
        if (!choice || !Array.isArray(choice.candidates) || !choice.candidates.length) return;
    
        const panel = root.createDiv({ cls: "eaglebridge-repair-choice-panel" });
        panel.createEl("div", {
          cls: "eaglebridge-repair-choice-title",
          text: "请选择要替换成哪个 Eagle 素材："
        });
    
        const list = panel.createDiv({ cls: "eaglebridge-repair-choice-list" });
        for (const candidate of choice.candidates) {
          const itemId = getEagleItemId(candidate);
          const candidateName = getAssetDisplayName(candidate) || itemId;
          const candidateExt = getAssetExtension(candidate);
          const candidateLabel = candidateExt && !candidateName.toLowerCase().endsWith(`.${candidateExt}`)
            ? `${candidateName}.${candidateExt}`
            : candidateName;
          const button = list.createEl("button", { cls: "eaglebridge-repair-choice-card" });
          const preview = button.createDiv({ cls: "eaglebridge-repair-choice-preview" });
          const img = preview.createEl("img");
          img.alt = candidateLabel;
          img.src = this.plugin.getEagleBridgeUrl(candidate);
          img.addEventListener("error", async () => {
            const thumbnailUrl = await this.plugin.getEagleItemThumbnailUrl(candidate);
            if (thumbnailUrl && img.src !== thumbnailUrl) {
              img.src = thumbnailUrl;
              return;
            }
            img.remove();
            createFilePlaceholder(preview, candidateExt, this.plugin.t("filePlaceholder"));
          }, { once: true });
          const info = button.createDiv({ cls: "eaglebridge-repair-choice-info" });
          info.createDiv({ cls: "eaglebridge-repair-choice-name", text: candidateLabel });
          info.createDiv({ cls: "eaglebridge-repair-choice-id", text: `${itemId}.info` });
          button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            const ok = await this.plugin.applyEagleBridgeLinkReplacement(choice.ref, itemId);
            if (ok) {
              this.repairChoice = null;
              new Notice("已替换为选中的 Eagle 素材。");
              await this.reloadDisplayedContext(false);
            } else {
              new Notice("替换失败：没有找到可替换的 OE Link 链接。");
            }
          });
        }
    
        const cancelButton = panel.createEl("button", {
          cls: "eaglebridge-repair-choice-cancel",
          text: "取消"
        });
        cancelButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          this.repairChoice = null;
          await this.reloadDisplayedContext(false);
        });
      }
    
      async handleMissingItemRepair(item, displayName) {
        if (item.__missingReason !== "eagle") {
          new Notice("这个缺失素材不是 OE Link 链接，暂时无法自动修复。");
          return;
        }
        const sourceRef = {
          id: item.id,
          label: item.__noteLinkName || displayName,
          start: item.__sourceStart,
          end: item.__sourceEnd
        };
        const result = await this.plugin.prepareEagleBridgeRepairCandidates(sourceRef);
        if (!result) {
          new Notice("没有在当前笔记中找到这条 OE Link 链接。");
          return;
        }
        if (!result.candidates.length) {
          new Notice("没有找到名称和扩展名匹配的可用 Eagle 素材。");
          return;
        }
        if (result.candidates.length === 1) {
          const replacementId = getEagleItemId(result.candidates[0]);
          const ok = await this.plugin.applyEagleBridgeLinkReplacement(result.ref, replacementId);
          if (ok) {
            new Notice("已自动修复这个 Eagle 图片链接。");
            await this.reloadDisplayedContext(false);
          } else {
            new Notice("替换失败：没有找到可替换的 OE Link 链接。");
          }
          return;
        }
        this.repairChoice = result;
        await this.reloadDisplayedContext(false);
      }
    
      async trashLocalUnreferencedLibraryAttachment(item) {
        const localFile = item && item.__localFile;
        if (!(localFile instanceof TFile)) {
          new Notice(this.plugin.t("noticeNoAttachmentAtCursor"));
          return;
        }
    
        if (this.isLibraryAssetReferenced(item)) {
          new Notice(this.plugin.t("localAttachmentStillReferenced"));
          return;
        }
    
        const choice = await chooseInObsidianModal(
          this.plugin.app,
          this.plugin.t("trashLocalAttachmentTitle"),
          this.plugin.t("trashLocalAttachmentConfirm", { name: localFile.name }),
          [{ value: "trash", label: this.plugin.t("moveToObsidianTrash"), cta: true }],
          this.plugin.t("cancel")
        );
        if (choice !== "trash") return;
    
        const currentFile = this.plugin.app.vault.getAbstractFileByPath(localFile.path);
        if (!(currentFile instanceof TFile)) {
          new Notice(this.plugin.t("localAttachmentNoLongerExists"));
          await this.reloadDisplayedContext(false);
          return;
        }
    
        try {
          await this.plugin.trashLocalFile(currentFile);
          new Notice(this.plugin.t("trashedLocalUnreferencedAttachment", { name: currentFile.name }));
          await this.reloadDisplayedContext(false);
        } catch (error) {
          console.warn("Failed to move local attachment to Obsidian trash:", error);
          if (error && error.code === "ENOENT") {
            new Notice(this.plugin.t("localAttachmentNoLongerExists"));
            await this.reloadDisplayedContext(false);
            return;
          }
          new Notice(this.plugin.t("trashLocalAttachmentFailed", {
            name: localFile.name,
            message: error && error.message ? error.message : error
          }));
        }
      }
    
      async trashSelectedLocalAttachments(items) {
        const files = items.map(item => item.__localFile).filter(file => file instanceof TFile);
        const choice = await chooseInObsidianModal(
          this.plugin.app,
          this.plugin.t("trashLocalAttachmentTitle"),
          this.plugin.t("trashSelectedLocalAttachmentsConfirm", { count: files.length }),
          [{ value: "trash", label: this.plugin.t("moveToObsidianTrash"), cta: true }],
          this.plugin.t("cancel")
        );
        if (choice !== "trash") return;
        let moved = 0;
        for (const file of files) {
          const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
          if (!(currentFile instanceof TFile)) continue;
          try {
            await this.plugin.trashLocalFile(currentFile);
            moved += 1;
          } catch (error) {
            console.warn("Failed to move selected local attachment to Obsidian trash:", error);
          }
        }
        new Notice(this.plugin.t("trashedSelectedLocalAttachments", { count: moved }));
        this.clearAssetSelection();
        await this.reloadDisplayedContext(false);
      }
      async showAssetCardContextMenu(event, item) {
        event.preventDefault();
        event.stopPropagation();
        this.selectAssetForContextMenu(item);
    
        const menu = new Menu();
        const source = String(item && item.__assetSource || "eagle");
        const isLocalItem = source === "local" && item.__localFile instanceof TFile;
        const isExternalLocalItem = source === "external-local" && !!item.__externalLocalPath;
        const isInternetItem = source === "internet";
        const isMissingItem = source === "missing" || !!(item && item.__missingAttachment);
        const itemId = stripInfoSuffix(getEagleItemId(item));
        const isEagleItem = !!itemId && !isLocalItem && !isExternalLocalItem && !isInternetItem && !isMissingItem;
        const isTrashed = isEagleItem && isEagleItemTrashed(item);
        const displayName = getAssetDisplayName(item) || itemId || this.plugin.t("untitledAsset");
        const run = (label, task, icon = "") => {
          menu.addItem(menuItem => {
            menuItem.setTitle(label);
            if (icon) menuItem.setIcon(icon);
            menuItem.onClick(() => {
              Promise.resolve(task()).catch(error => {
                console.warn(`Failed to ${label}:`, error);
                new Notice(`${label}失败：${error && error.message ? error.message : error}`);
              });
            });
          });
        };
        const addEagleFolderMenu = async folderIds => {
          if (!folderIds.length) return;
          const folders = await this.plugin.queryEagleFolders().catch(() => []);
          menu.addItem(menuItem => {
            menuItem.setTitle("打开 Eagle 文件夹").setIcon("folder-open");
            const submenu = menuItem.setSubmenu();
            for (const folderId of folderIds) {
              const folder = findEagleFolderById(folders, folderId);
              submenu.addItem(folderItem => folderItem
                .setTitle(String(folder && folder.name || folderId))
                .setIcon("folder")
                .onClick(() => this.plugin.openExternalUrl(buildEagleFolderUrl(this.plugin.settings.eagleProtocolUrl, folderId))));
            }
          });
        };
        const addReferenceMenu = (references, targetItem) => {
          if (!references.length) return;
          menu.addItem(menuItem => {
            menuItem.setTitle("\u5b9a\u4f4d\u5230\u5f15\u7528\u4f4d\u7f6e").setIcon("map-pin");
            const submenu = menuItem.setSubmenu();
            for (const file of references) {
              submenu.addItem(referenceItem => referenceItem
                .setTitle(file.basename || file.path)
                .setIcon(file.extension === "canvas" ? "layout-dashboard" : "file-text")
                .onClick(() => file.path === this.currentFilePath && typeof targetItem.__sourceStart === "number"
                  ? this.plugin.revealAssetInSource(file.path, targetItem, this.sourceLeaf)
                  : this.openSourceFileInNewTab(file)));
            }
          });
        };
    
        const selectedItems = Array.from(this.selectedAssetItems.values());
        if (selectedItems.length > 1) {
          run(this.plugin.t("copyAttachment"), () => this.copyAssetsToClipboard(selectedItems), "copy");
          run(this.plugin.t("copyAttachmentReference"), async () => {
            await this.copyAssetReferenceLinks(selectedItems);
            new Notice(this.plugin.t("copiedAttachmentReferences", { count: selectedItems.length }));
          }, "copy");
          if (selectedItems.every(selected => this.isAssetImportable(selected))) {
            run(this.plugin.t("importSelectedToEagle"), () => this.importSelectedAssets(), "eagle-outline");
          }
          const allLocalTrashable = this.isLibraryMode && selectedItems.every(selected =>
            String(selected && selected.__assetSource || "eagle") === "local"
            && selected.__localFile instanceof TFile
            && !this.isLibraryAssetReferenced(selected));
          if (allLocalTrashable) {
            run(this.plugin.t("moveToObsidianTrash"), () => this.trashSelectedLocalAttachments(selectedItems), "trash-2");
          }
          const allEagleTrashable = this.isLibraryMode && selectedItems.every(selected => {
            const selectedSource = String(selected && selected.__assetSource || "eagle");
            return selectedSource === "eagle"
              && !!stripInfoSuffix(getEagleItemId(selected))
              && !isEagleItemTrashed(selected)
              && !this.isLibraryAssetReferenced(selected);
          });
          if (allEagleTrashable) {
            run(this.plugin.t("moveToEagleTrash"), () => this.trashLibraryAssets(
              selectedItems.map(selected => getEagleItemId(selected)),
              "trashedSelectedEagleAssets",
              "Failed to move selected Eagle assets to trash"
            ), "trash-2");
          }
          const folderGroups = selectedItems.map(selected => getEagleItemFolderIds(selected).map(String));
          const commonFolderIds = folderGroups[0].filter(folderId => folderGroups.slice(1).every(ids => ids.includes(folderId)));
          await addEagleFolderMenu(Array.from(new Set(commonFolderIds)));
          const currentFile = !this.isLibraryMode && this.currentFilePath
            ? this.plugin.app.vault.getAbstractFileByPath(this.currentFilePath)
            : null;
          const referenceGroups = await Promise.all(selectedItems.map(selected =>
            currentFile instanceof TFile && typeof selected.__sourceStart === "number"
              ? [currentFile]
              : this.getReferencedFilesForPreview(selected)));
          const commonReferences = referenceGroups[0].filter(file =>
            referenceGroups.slice(1).every(files => files.some(candidate => candidate.path === file.path)));
          addReferenceMenu(commonReferences, item);
          menu.showAtMouseEvent(event);
          return;
        }
        run(this.plugin.t("copyAttachment"), () => this.copyAssetImageToClipboard(item), "copy");
        run(this.plugin.t("copyAttachmentReference"), async () => {
          await this.copyAssetReferenceLink(item);
          new Notice(this.plugin.t("copiedAttachmentReferences", { count: 1 }));
        }, "copy");
    
        if (isMissingItem) {
          run("尝试修复", () => this.handleMissingItemRepair(item, displayName), "wrench");
        }
    
        if (isLocalItem) {
          if (this.isLibraryMode && !this.isLibraryAssetReferenced(item)) {
            run(this.plugin.t("moveToObsidianTrash"), () => this.trashLocalUnreferencedLibraryAttachment(item), "trash-2");
          } else {
            run(this.plugin.t("importSelectedToEagle"), async () => {
              if (this.isLibraryMode) {
                await this.plugin.importLocalAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
              } else {
                await this.plugin.importLocalAttachmentItemFromPanel(this.currentFilePath, item);
              }
              if (this.isLibraryMode) await this.reloadDisplayedContext(false);
            }, "eagle-outline");
          }
        } else if (isExternalLocalItem && this.plugin.settings.importExternalLocalAttachments === true) {
          run(this.plugin.t("importSelectedToEagle"), async () => {
            if (this.isLibraryMode) {
              await this.plugin.importExternalLocalAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
            } else {
              await this.plugin.importExternalLocalAttachmentItemFromPanel(this.currentFilePath, item);
            }
            if (this.isLibraryMode) await this.reloadDisplayedContext(false);
          }, "eagle-outline");
        } else if (isInternetItem) {
          run(this.plugin.t("importSelectedToEagle"), async () => {
            if (this.isLibraryMode) {
              await this.plugin.importInternetAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
            } else {
              await this.plugin.importInternetAttachmentItemFromPanel(this.currentFilePath, item);
            }
            if (this.isLibraryMode) await this.reloadDisplayedContext(false);
          }, "eagle-outline");
        } else if (isEagleItem && this.isLibraryMode && !isTrashed && !this.isLibraryAssetReferenced(item)) {
          run(this.plugin.t("moveToEagleTrash"), () => this.trashSingleUnreferencedLibraryAsset(itemId), "trash-2");
        }
    
        if ((isLocalItem || isExternalLocalItem || isEagleItem) && !isPreviewableImage(displayName)) {
          run("用默认应用打开", () => this.openLibraryAssetWithDefaultApp(item), "external-link");
        }
    
        if (isLocalItem) {
          run("打开文件所在位置", () => {
            const fullPath = this.plugin.getFullPath(item.__localFile);
            if (!fullPath) throw new Error("无法找到本地附件。");
            require("electron").shell.showItemInFolder(fullPath);
          }, "folder-open");
        } else if (isExternalLocalItem) {
          run("打开文件所在位置", () => require("electron").shell.showItemInFolder(item.__externalLocalPath), "folder-open");
        } else if (isInternetItem) {
          const url = item.resourceURL || item.fileURL || item.url;
          if (url) {
            run("在浏览器中打开原始链接", () => this.plugin.openExternalUrl(url), "external-link");
            run(this.plugin.t("copyOriginalLink"), async () => {
              try {
                await navigator.clipboard.writeText(url);
              } catch (_) {
                require("electron").clipboard.writeText(url);
              }
              new Notice(this.plugin.t("noticeCopied", { value: url }));
            }, "copy");
          }
        } else if (isEagleItem) {
          run("在 Eagle 中打开", () => this.plugin.openEagleItem(itemId), "eagle-outline");
          await addEagleFolderMenu(getEagleItemFolderIds(item));
        }
    
        const currentFile = !this.isLibraryMode && this.currentFilePath
          ? this.plugin.app.vault.getAbstractFileByPath(this.currentFilePath)
          : null;
        const references = currentFile instanceof TFile && typeof item.__sourceStart === "number"
          ? [currentFile]
          : await this.getReferencedFilesForPreview(item);
        addReferenceMenu(references, item);
    
        if (menu.items.length) {
          menu.showAtMouseEvent(event);
        }
      }
    
      renderWaterfallOverlay(card, item, displayName, statusText, statusClass) {
        const overlay = card.createDiv({ cls: "eaglebridge-waterfall-overlay" });
        overlay.createDiv({
          cls: "eaglebridge-waterfall-overlay-name",
          text: displayName || item.id || this.plugin.t("untitledAsset")
        });
        overlay.createDiv({
          cls: `eaglebridge-waterfall-overlay-status ${statusClass || ""}`,
          text: statusText
        });
        const itemId = getEagleItemId(item);
        if (itemId) {
          overlay.createDiv({
            cls: "eaglebridge-waterfall-overlay-id",
            text: `${itemId}.info`
          });
        }
      }
    
      applyAssetCardSize(grid, viewMode) {
        if (!grid) return;
        if (viewMode === "list") {
          const rowHeight = clampNumber(this.plugin.settings.assetListRowHeight, 40, 120, DEFAULT_SETTINGS.assetListRowHeight);
          grid.style.setProperty("--eaglebridge-asset-list-row-height", `${rowHeight}px`);
          return;
        }
        const size = clampNumber(this.plugin.settings.assetCardSize, 64, 260, DEFAULT_SETTINGS.assetCardSize);
        grid.style.setProperty("--eaglebridge-asset-card-size", `${size}px`);
      }
    
      registerAssetZoomHandler(grid, viewMode) {
        if (!grid) return;
        grid.addEventListener("wheel", event => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          event.stopPropagation();
          const isList = viewMode === "list";
          const settingKey = isList ? "assetListRowHeight" : "assetCardSize";
          const minimum = isList ? 40 : 64;
          const maximum = isList ? 120 : 260;
          const fallback = isList ? DEFAULT_SETTINGS.assetListRowHeight : DEFAULT_SETTINGS.assetCardSize;
          const cssProperty = isList ? "--eaglebridge-asset-list-row-height" : "--eaglebridge-asset-card-size";
          const current = clampNumber(this.plugin.settings[settingKey], minimum, maximum, fallback);
          const next = clampNumber(current + (event.deltaY < 0 ? 3 : -3), minimum, maximum, fallback);
          if (next === current) return;
          this.plugin.settings[settingKey] = next;
          grid.style.setProperty(cssProperty, `${next}px`);
          if (this.assetZoomSaveTimer) window.clearTimeout(this.assetZoomSaveTimer);
          this.assetZoomSaveTimer = window.setTimeout(() => {
            this.plugin.saveSettings().catch(error => console.warn("Failed to save asset view zoom:", error));
          }, 250);
        }, { passive: false });
      }
    
      getContextItemSource(item) {
        const source = String(item && item.__assetSource || "eagle");
        if (source === "note") return "note";
        if (source === "missing") return String(item && item.__missingReason || "eagle") === "local" ? "local" : "eagle";
        if (source === "local" || source === "external-local" || source === "internet") return source;
        return "eagle";
      }
    
      getFilteredContextItems(items) {
        const filters = this.getEffectiveLibraryFilterSet(this.contextSourceFilters, ["eagle", "local", "external-local", "internet"]);
        return (items || []).filter(item => {
          const source = this.getContextItemSource(item);
          return source === "note" || filters.has(source);
        });
      }
    
      renderAssetSummary(root, items, context = null, visibleItems = items) {
        const summary = getAssetSummary(items);
        const visibleSummary = getAssetSummary(visibleItems);
        const header = root.createDiv({ cls: "eaglebridge-library-header eaglebridge-asset-summary-header" });
        if (context && context.tags && context.tags.length) {
          const meta = header.createDiv({ cls: "eaglebridge-note-assets-meta eaglebridge-library-title" });
          meta.createEl("div", { text: this.plugin.t("triedTags", { tags: context.tags.join(" | ") }) });
        }
        this.renderInlineViewSwitcher(header, async () => {
          if (context) await this.loadForContext(context, { parentContext: this.parentContext });
        });
    
        const stats = root.createDiv({ cls: "eaglebridge-note-assets-stats eaglebridge-context-asset-stats" });
        const addStat = (text, cls = "") => stats.createEl("div", { cls: `eaglebridge-note-assets-stat ${cls}`.trim(), text });
        addStat(this.plugin.t("totalAssets", { count: summary.total }), "eaglebridge-note-assets-stat-total");
        addStat(`当前显示: ${visibleSummary.total}`, "eaglebridge-note-assets-stat-visible");
        addStat(
          `${this.plugin.t("selectedAssetsStat", { count: this.selectedAssetItems.size })} · ${this.plugin.t("selectionInlineHint")}`,
          `eaglebridge-note-assets-stat-selected${this.selectedAssetItems.size ? "" : " is-hidden"}`
        );
        this.renderContextSourceBar(root, summary, context, items);
      }
    
      renderContextSourceBar(root, summary, context, items) {
        const entries = [
          ["eagle", "Eagle 库内", "is-eagle", summary.inEagle + summary.trash],
          ["local", "Obsidian 库内", "is-local", summary.local],
          ["external-local", "Obsidian 库外", "is-external-local", summary.externalLocal],
          ["internet", "网络", "is-internet", summary.internet]
        ];
        const total = entries.reduce((sum, [, , , count]) => sum + count, 0);
        const bar = root.createDiv({
          cls: "eaglebridge-library-filter-bar eaglebridge-context-source-bar",
          attr: { "aria-label": "素材来源", role: "group" }
        });
        for (const [key, label, colorClass, count] of entries) {
          const enabled = this.contextSourceFilters.has(key);
          const segment = bar.createEl("button", {
            cls: `eaglebridge-library-filter-segment ${colorClass}${enabled ? " is-enabled" : ""}`,
            attr: {
              type: "button",
              "aria-label": key === "eagle" ? `Eagle 库内: ${summary.inEagle}，Eagle 回收站: ${summary.trash}` : `${label}: ${count}`,
              "aria-pressed": String(enabled)
            }
          });
          segment.createSpan({ text: String(key === "eagle" ? summary.inEagle : count) });
          if (key === "eagle" && summary.trash > 0) {
            segment.createSpan({ cls: "eaglebridge-context-trash-count", text: `+${summary.trash}` });
          }
          segment.style.flex = total && count / total >= 0.03 ? `${count} 1 0px` : "0 0 22px";
          segment.addEventListener("click", () => {
            if (enabled) this.contextSourceFilters.delete(key);
            else this.contextSourceFilters.add(key);
            this.renderItems(context, items, { preserveToolbar: true });
          });
        }
      }
    
      renderAssetGrid(root, items, options = {}) {
        const renderGeneration = ++this.assetRenderGeneration;
        const isCurrentRender = () => renderGeneration === this.assetRenderGeneration;
        if (!items.length) {
          root.createDiv({ cls: "eaglebridge-note-assets-scroll-area" }).createEl("div", {
            cls: "eaglebridge-note-assets-empty",
            text: this.plugin.t("noSupportedAssets")
          });
          return;
        }
    
        const restoreState = this.pendingAssetViewportState;
        this.pendingAssetViewportState = null;
        const scrollArea = root.createDiv({ cls: "eaglebridge-note-assets-scroll-area" });
        const viewMode = normalizeAssetViewMode(this.plugin.settings.assetViewMode);
        const usesHoverOverlay = viewMode === "waterfall" || viewMode === "normal";
        const grid = scrollArea.createDiv({ cls: `eaglebridge-note-assets-grid eaglebridge-note-assets-grid-${viewMode}` });
        scrollArea.addEventListener("click", event => {
          if (event.target === scrollArea || event.target === grid) this.clearAssetSelection();
        });
        this.applyAssetCardSize(grid, viewMode);
        this.registerAssetZoomHandler(grid, viewMode);
        const batchSize = 24;
        let renderedCount = 0;
        let loadMoreHint = null;
        const loadMore = typeof options.loadMore === "function" ? options.loadMore : null;
        let hasRemoteMore = !!loadMore;
        let loadingRemotePage = false;
        const updateLoadMoreHint = () => {
          if (!loadMoreHint) return;
          loadMoreHint.toggleClass("is-hidden", renderedCount >= items.length && !hasRemoteMore);
          loadMoreHint.toggleClass("is-loading", loadingRemotePage);
        };
        const renderNextBatch = () => {
          const batch = items.slice(renderedCount, renderedCount + batchSize);
          if (!batch.length) return false;
          for (const [batchIndex, item] of batch.entries()) {
          const card = grid.createDiv({ cls: `eaglebridge-note-assets-card eaglebridge-note-assets-card-${viewMode}` });
          card.style.setProperty("--eaglebridge-card-reveal-delay", `${Math.min(batchIndex, 12) * 16}ms`);
          const itemSource = String(item && item.__assetSource || "eagle");
          const eagleItemId = itemSource === "eagle" || itemSource === "trash"
            ? stripInfoSuffix(getEagleItemId(item))
            : "";
          if (eagleItemId) card.dataset.eagleItemId = eagleItemId;
          card.dataset.assetKey = String(item.id || "");
          const isNoteItem = item.__assetSource === "note";
          if (!isNoteItem) {
            const selectionKey = this.getAssetSelectionKey(item);
            if (selectionKey) {
              card.dataset.assetSelectionKey = selectionKey;
              const selected = this.selectedAssetItems.has(selectionKey);
              card.setAttr("aria-selected", String(selected));
              card.toggleClass("is-selected", selected);
            }
          }
          const cancelPendingCardClick = () => {
            if (!this.pendingAssetCardClick) return;
            window.clearTimeout(this.pendingAssetCardClick);
            this.pendingAssetCardClick = 0;
          };
          const deferCardClick = callback => {
            cancelPendingCardClick();
            this.pendingAssetCardClick = window.setTimeout(async () => {
              this.pendingAssetCardClick = 0;
              if (!isCurrentRender()) return;
              await callback();
            }, 220);
          };
          if (isNoteItem) {
            card.addClass("eaglebridge-note-assets-card-clickable");
            card.addEventListener("click", async event => {
              event.preventDefault();
              event.stopPropagation();
              await this.drillIntoCanvasNote(item);
            });
          } else {
            if (!this.isLibraryMode && typeof item.__sourceStart === "number") {
              card.dataset.sourceStart = String(item.__sourceStart);
              card.dataset.sourceEnd = String(typeof item.__sourceEnd === "number" ? item.__sourceEnd : item.__sourceStart);
            }
            card.addClass("eaglebridge-note-assets-card-clickable");
            card.addEventListener("click", event => {
              if (event.detail > 1 || event.target.closest("button")) return;
              const modifiedSelection = this.selectAssetFromClick(item, event, items);
              if (modifiedSelection || this.isLibraryMode || typeof item.__sourceStart !== "number") return;
              deferCardClick(async () => {
                const scrollRoot = this.containerEl.children[1]?.querySelector(".eaglebridge-note-assets-scroll-area");
                const scrollTop = scrollRoot ? scrollRoot.scrollTop : 0;
                await this.plugin.revealAssetInSource(this.currentFilePath, item, this.sourceLeaf);
                if (scrollRoot) {
                  window.requestAnimationFrame(() => {
                    scrollRoot.scrollTop = scrollTop;
                  });
                }
              });
            });
          }
          const isLocalItem = item.__assetSource === "local";
          const isExternalLocalItem = item.__assetSource === "external-local";
          const isObsidianTrashedLocal = isLocalItem && !!item.__inObsidianTrash;
          const isInternetItem = item.__assetSource === "internet";
          const isMissingItem = item.__assetSource === "missing" || item.__missingAttachment;
          const isTrashedItem = isObsidianTrashedLocal || (!isLocalItem && isEagleItemTrashed(item));
          const displayName = getAssetDisplayName(item);
          const statusText = isNoteItem
            ? this.plugin.t("embeddedNote")
            : isObsidianTrashedLocal
            ? this.plugin.t("inEagleTrash")
            : isLocalItem
            ? this.plugin.t("obsidianLocal")
            : isExternalLocalItem
              ? this.plugin.t("obsidianExternalLocal")
            : isInternetItem
              ? this.plugin.t("internetAsset")
              : isMissingItem
                ? "加载失败"
                : isTrashedItem
                  ? this.plugin.t("inEagleTrash")
                  : this.plugin.t("inEagle");
          const statusClass = isNoteItem
            ? "eaglebridge-note-text"
            : isObsidianTrashedLocal
            ? "eaglebridge-trash-text"
            : isLocalItem
            ? "eaglebridge-local-text"
            : isExternalLocalItem
              ? "eaglebridge-external-local-text"
            : isInternetItem
              ? "eaglebridge-internet-text"
              : isMissingItem
                ? "eaglebridge-missing-text"
                : isTrashedItem
                  ? "eaglebridge-trash-text"
                  : "eaglebridge-eagle-text";
          const statusMarkerEntries = !isNoteItem && !isMissingItem
            ? this.getAssetStatusMarkerEntries(item, isTrashedItem)
            : [];
          const tooltipStatus = statusMarkerEntries.map(entry => entry.label).join(" | ") || statusText;
          setTooltip(card, [displayName || item.id || this.plugin.t("untitledAsset"), tooltipStatus, getEagleItemId(item)].filter(Boolean).join("\n"));
          if (isNoteItem) {
            card.addClass("eaglebridge-card-note");
          } else if (isObsidianTrashedLocal) {
            card.addClass("eaglebridge-card-in-trash");
          } else if (isLocalItem) {
            card.addClass("eaglebridge-card-local");
          } else if (isExternalLocalItem) {
            card.addClass("eaglebridge-card-external-local");
          } else if (isInternetItem) {
            card.addClass("eaglebridge-card-internet");
          } else if (isMissingItem) {
            card.addClass("eaglebridge-card-missing");
          } else if (isTrashedItem) {
            card.addClass("eaglebridge-card-in-trash");
          } else {
            card.addClass("eaglebridge-card-in-eagle");
          }
          const isLibraryAssetCard = !!(this.isLibraryMode && !isMissingItem && !isNoteItem);
          if (isLibraryAssetCard) {
            const libraryKey = this.getLibraryAssetKey(item);
            if (libraryKey) card.dataset.libraryAssetKey = libraryKey;
            card.addClass("eaglebridge-note-assets-card-clickable");
          }
          if (statusMarkerEntries.length) this.renderAssetStatusMarkers(card, statusMarkerEntries);
          if (!isNoteItem && this.isPreviewableAssetItem(item)) {
            card.addEventListener("dblclick", event => {
              if (event.target.closest("button")) return;
              event.preventDefault();
              event.stopPropagation();
              cancelPendingCardClick();
              void this.openAssetPreview(item);
            });
          }
          if (!isNoteItem) {
            card.addEventListener("contextmenu", event => {
              void this.showAssetCardContextMenu(event, item);
            });
          }
          const createPreviewPlaceholder = () => {
            const placeholder = createFilePlaceholder(card, getAssetExtension(item), this.plugin.t("filePlaceholder"));
            const firstTitle = card.querySelector(".eaglebridge-note-assets-title");
            if (firstTitle) card.insertBefore(placeholder, firstTitle);
            return placeholder;
          };
          if (isNoteItem) {
            createNotePlaceholder(card, displayName || this.plugin.t("untitledAsset"), this.plugin.t("notePlaceholder"));
          } else if (isMissingItem) {
            createPreviewPlaceholder();
          } else if (isLocalItem || isExternalLocalItem || isInternetItem) {
            const previewSource = item.resourceURL || item.fileURL || item.url || displayName || "";
            if (this.isPreviewableAssetItem(item)) {
              const img = card.createEl("img");
              img.alt = displayName || item.id || this.plugin.t(isInternetItem ? "internetAsset" : isExternalLocalItem ? "obsidianExternalLocal" : "localAttachmentAlt");
              img.loading = "lazy";
              img.decoding = "async";
              if (isInternetItem) img.referrerPolicy = "no-referrer";
              let previewFallbackShown = false;
              const showPreviewFallback = () => {
                if (previewFallbackShown) return;
                previewFallbackShown = true;
                img.remove();
                createPreviewPlaceholder();
              };
              if (isExternalLocalItem) {
                Promise.resolve(require("electron").nativeImage.createThumbnailFromPath(item.__externalLocalPath, { width: 512, height: 512 }))
                  .then(thumbnail => {
                    if (!isCurrentRender() || !img.isConnected || !thumbnail || thumbnail.isEmpty()) return showPreviewFallback();
                    img.src = thumbnail.toDataURL();
                  })
                  .catch(showPreviewFallback);
              } else {
                img.src = previewSource;
              }
              if (!isInternetItem && !isExternalLocalItem && item.resourceURL && item.fileURL) {
                img.addEventListener("error", () => {
                  if (img.src !== item.fileURL) {
                    img.src = item.fileURL;
                    return;
                  }
                  showPreviewFallback();
                });
              } else {
                img.addEventListener("error", showPreviewFallback);
              }
            } else {
              createPreviewPlaceholder();
            }
          } else {
            const img = card.createEl("img");
            img.alt = displayName || item.id || this.plugin.t("eagleAssetAlt");
            img.loading = "lazy";
            img.decoding = "async";
            let fallbackStage = 0;
            const showFallback = async () => {
              fallbackStage += 1;
              if (fallbackStage === 1) {
                const thumbnailUrl = await this.plugin.getEagleItemThumbnailUrl(item);
                if (thumbnailUrl && img.src !== thumbnailUrl) {
                  img.src = thumbnailUrl;
                  return;
                }
              }
              const fileUrl = item.fileURL || item.url;
              if (fallbackStage === 2 && fileUrl && img.src !== fileUrl) {
                img.src = fileUrl;
                return;
              }
              if (fallbackShown) return;
              fallbackShown = true;
              img.remove();
              createPreviewPlaceholder();
            };
            let fallbackShown = false;
            img.addEventListener("error", showFallback);
            const bridgeUrl = this.plugin.getEagleBridgeUrl(item);
            if (bridgeUrl) {
              img.src = bridgeUrl;
            } else {
              img.src = "";
              this.plugin.getEagleItemThumbnailUrl(item).then(url => {
                if (url) {
                  img.src = url;
                } else {
                  showFallback();
                }
              });
            }
          }
          const imagePreview = card.querySelector("img");
          if (viewMode === "waterfall" && imagePreview) {
            const signature = getEagleItemMatchSignature(item);
            if (signature && signature.width && signature.height) {
              imagePreview.addClass("eaglebridge-preview-reserved");
              imagePreview.style.aspectRatio = `${signature.width} / ${signature.height}`;
            }
          }
          const preview = card.querySelector(".eaglebridge-file-placeholder");
          card.createEl("div", {
            cls: "eaglebridge-note-assets-title",
            text: displayName || item.id || this.plugin.t("untitledAsset")
          });
          if (isNoteItem) {
            card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-note-text",
              text: this.plugin.t("embeddedNote")
            });
          } else if (isObsidianTrashedLocal) {
            card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-trash-text",
              text: this.plugin.t("inEagleTrash")
            });
          } else if (isLocalItem) {
            const localRow = card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-local-row"
            });
            localRow.createEl("span", {
              cls: "eaglebridge-local-text",
              text: this.plugin.t("obsidianLocal")
            });
          } else if (isExternalLocalItem) {
            const localRow = card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-local-row"
            });
            localRow.createEl("span", {
              cls: "eaglebridge-external-local-text",
              text: this.plugin.t("obsidianExternalLocal")
            });
          } else if (isInternetItem) {
            const internetRow = card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-local-row"
            });
            internetRow.createEl("span", {
              cls: "eaglebridge-internet-text",
              text: this.plugin.t("internetAsset")
            });
          } else if (isMissingItem) {
            const missingRow = card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-missing-row"
            });
            missingRow.createEl("span", {
              cls: "eaglebridge-missing-text",
              text: "加载失败"
            });
          } else if (isTrashedItem) {
            card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-trash-text",
              text: this.plugin.t("inEagleTrash")
            });
          } else {
            card.createEl("div", {
              cls: "eaglebridge-note-assets-title eaglebridge-eagle-text",
              text: this.plugin.t("inEagle")
            });
          }
          if (usesHoverOverlay) {
            this.renderWaterfallOverlay(card, item, displayName, statusText, statusClass);
          }
          }
          renderedCount += batch.length;
          updateLoadMoreHint();
          if (typeof options.onRendered === "function") options.onRendered(renderedCount);
          return true;
        };
        loadMoreHint = scrollArea.createDiv({
          cls: "eaglebridge-asset-load-more-hint",
          text: this.plugin.t("loadMoreAssets")
        });
        renderNextBatch();
        const restoreRenderedCount = Math.max(batchSize, Number(restoreState?.renderedCount) || 0);
        while (renderedCount < restoreRenderedCount && renderNextBatch()) {}
        updateLoadMoreHint();
    
        const scrollRoot = scrollArea;
        const loadMoreWhenNeeded = async () => {
          if (!isCurrentRender()) return;
          if (!scrollRoot) return;
          if (scrollRoot.scrollTop + scrollRoot.clientHeight < scrollRoot.scrollHeight - 180) return;
          if (renderNextBatch()) return;
          if (!loadMore || !hasRemoteMore || loadingRemotePage) return;
          loadingRemotePage = true;
          updateLoadMoreHint();
          try {
            const page = await loadMore();
            if (!isCurrentRender()) return;
            const nextItems = Array.isArray(page) ? page : (page && Array.isArray(page.items) ? page.items : []);
            if (page && typeof page.hasMore === "boolean") hasRemoteMore = page.hasMore;
            if (nextItems.length) {
              items.push(...nextItems);
              renderNextBatch();
            } else {
              hasRemoteMore = false;
            }
          } catch (error) {
            console.warn("Failed to load more Eagle assets:", error);
            hasRemoteMore = false;
          } finally {
            loadingRemotePage = false;
            updateLoadMoreHint();
          }
        };
        if (scrollRoot) {
          const handleScroll = () => {
            if (!isCurrentRender()) return;
            const key = this.getAssetViewportKey();
            if (key) this.assetViewportStates.set(key, { scrollTop: scrollRoot.scrollTop, renderedCount });
            void loadMoreWhenNeeded();
          };
          scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
          this.assetInfiniteScrollCleanup = () => scrollRoot.removeEventListener("scroll", handleScroll);
          window.requestAnimationFrame(() => {
            if (!isCurrentRender()) return;
            if (restoreState) {
              scrollRoot.scrollTop = Math.min(Number(restoreState.scrollTop) || 0, Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight));
            }
            window.requestAnimationFrame(() => {
              if (isCurrentRender()) void loadMoreWhenNeeded();
            });
          });
        }
        this.assetRenderNextBatch = renderNextBatch;
      }
    
      async scrollToAssetRange(filePath, range) {
        if (!filePath || !range) return false;
        if (filePath !== this.currentFilePath) {
          const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof TFile)) return false;
          const context = await this.plugin.getAssetContext(file, true);
          if (!context) return false;
          await this.loadForContext(context);
        }
        const root = this.containerEl.children[1];
        if (!root) return false;
        const start = String(range.start);
        const end = String(typeof range.end === "number" ? range.end : range.start);
        const itemId = stripInfoSuffix(range.itemId || "");
        const assetKey = String(range.assetKey || "");
        const findCard = () => {
          const cards = Array.from(root.querySelectorAll(".eaglebridge-note-assets-card[data-source-start]"));
          return (assetKey ? cards.find(el => el.dataset.assetKey === assetKey) : null)
            || cards.find(el => el.dataset.sourceStart === start && el.dataset.sourceEnd === end)
            || cards.find(el => el.dataset.sourceStart === start)
            || (itemId ? cards.find(el => el.dataset.eagleItemId === itemId) : null);
        };
        let card = findCard();
        while (!card && typeof this.assetRenderNextBatch === "function" && this.assetRenderNextBatch()) {
          card = findCard();
        }
        if (!card) return false;
    
        card.scrollIntoView({ block: "center", behavior: "smooth" });
        card.addClass("eaglebridge-card-source-highlight");
        window.setTimeout(() => {
          card.removeClass("eaglebridge-card-source-highlight");
        }, 1600);
        return true;
      }
    }
    
  },
  "./lib/asset-utils": function(module, exports, require, __filename, __dirname) {
    const { TFile } = require("obsidian");
    const nodePath = require("path");
    const nodeFs = require("fs");
    
    const SUPPORTED_ATTACHMENT_EXTENSIONS = [
      ".jpg", ".jpeg", ".jpe", ".jif", ".jfif", ".png", ".apng", ".gif", ".webp", ".avif", ".bmp", ".svg", ".tif", ".tiff", ".heic", ".heif", ".ico", ".raw",
      ".psd", ".psb", ".ai", ".eps", ".cdr", ".sketch", ".fig", ".xd", ".indd", ".idml", ".afdesign", ".afphoto", ".afpub", ".kra", ".clip", ".ora", ".exr", ".hdr", ".dng", ".cr2", ".nef", ".arw", ".rw2", ".raf",
      ".pdf",
      ".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v", ".flv",
      ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma",
      ".doc", ".docx", ".docm", ".dot", ".dotx", ".rtf", ".odt", ".pages",
      ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".pot", ".potx", ".odp", ".key",
      ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".csv", ".ods", ".numbers",
      ".txt", ".md",
      ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".dmg", ".pkg", ".apk",
      ".obj", ".fbx", ".blend", ".stl", ".glb", ".gltf", ".3ds", ".dae"
    ];
    
    const PREVIEWABLE_IMAGE_EXTENSIONS = [
      ".jpg", ".jpeg", ".jpe", ".jif", ".jfif", ".png", ".apng", ".gif", ".webp", ".avif", ".bmp", ".svg", ".tif", ".tiff", ".heic", ".heif", ".ico"
    ];
    
    function getAssetSummary(items) {
      const assets = (items || []).filter(item => item && item.__assetSource !== "note");
      const summary = {
        total: assets.length,
        inEagle: 0,
        local: 0,
        externalLocal: 0,
        internet: 0,
        trash: 0,
        failed: 0
      };
      for (const item of assets) {
        if (item.__assetSource === "missing" || item.__missingAttachment) {
          summary.failed += 1;
        } else if (item.__assetSource === "local") {
          summary.local += 1;
        } else if (item.__assetSource === "external-local") {
          summary.externalLocal += 1;
        } else if (item.__assetSource === "internet") {
          summary.internet += 1;
        } else if (isEagleItemTrashed(item)) {
          summary.trash += 1;
        } else {
          summary.inEagle += 1;
        }
      }
      return summary;
    }
    
    function normalizeAssetViewMode(value) {
      if (value === "compact") return "normal";
      return ["normal", "list", "waterfall"].includes(value) ? value : "normal";
    }
    
    function clampNumber(value, min, max, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.min(max, Math.max(min, number));
    }
    
    function buildEagleFolderUrl(baseUrl, folderId) {
      const rawBase = String(baseUrl || "eagle://").trim() || "eagle://";
      const base = /^eagle:\/+$/i.test(rawBase) ? "eagle://" : rawBase;
      const prefix = base.endsWith("://") ? base : `${base.replace(/\/+$/, "")}/`;
      return `${prefix}folder/${encodeURIComponent(String(folderId || "").trim())}`;
    }
    
    function formatIdentityDate(date) {
      const year = String(date.getFullYear());
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}${month}${day}`;
    }
    
    function normalizeIdentityTitle(title) {
      return String(title || "")
        .normalize("NFKC")
        .trim()
        // Preserve normal spaces and supported punctuation for direct Eagle search.
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/-+/g, "-")
        .replace(/[. ]+$/g, "")
        .replace(/^-+|-+$/g, "");
    }
    
    function buildTitleDateIdentity(title, date) {
      const cleanTitle = normalizeIdentityTitle(title) || "note";
      const cleanDate = isIdentityDate(date) ? date : formatIdentityDate(new Date());
      return `${cleanTitle}-${cleanDate}`;
    }
    
    function isIdentityDate(value) {
      return /^\d{8}$/.test(String(value || "").trim());
    }
    
    function getFileIdentityDate(file) {
      const ctime = file && file.stat && Number.isFinite(file.stat.ctime) ? file.stat.ctime : Date.now();
      return formatIdentityDate(new Date(ctime));
    }
    
    function getStableIdentityDate(file, existingDate = "") {
      return isIdentityDate(existingDate) ? existingDate : getFileIdentityDate(file);
    }
    
    function isObsidianManagedTag(tag) {
      return /^obsidian/i.test(String(tag || "").trim());
    }
    
    function isProbablyMarkdownTableRow(text, index) {
      const current = getLineAtIndex(text, index);
      if (!isProbablyMarkdownTableLine(current.line)) return false;
      const previous = getLineBefore(text, current.start);
      const next = getLineAfter(text, current.end);
      return isMarkdownTableSeparatorLine(previous) || isMarkdownTableSeparatorLine(next) || /^\s*\|/.test(current.line) || /\|\s*$/.test(current.line);
    }
    
    function isProbablyMarkdownTableLine(line) {
      return hasUnescapedPipe(line);
    }
    
    function getLineAtIndex(text, index) {
      const value = String(text || "");
      const safeIndex = Math.max(0, Math.min(index, value.length));
      const start = value.lastIndexOf("\n", safeIndex - 1) + 1;
      const nextBreak = value.indexOf("\n", safeIndex);
      const end = nextBreak === -1 ? value.length : nextBreak;
      return { line: value.slice(start, end), start, end };
    }
    
    function indexToLineCh(text, index) {
      const value = String(text || "");
      const safeIndex = Math.max(0, Math.min(index, value.length));
      const before = value.slice(0, safeIndex);
      const lines = before.split("\n");
      return {
        line: lines.length - 1,
        ch: lines[lines.length - 1].length
      };
    }
    
    function getLineBefore(text, lineStart) {
      const value = String(text || "");
      if (lineStart <= 0) return "";
      const previousEnd = lineStart - 1;
      const previousStart = value.lastIndexOf("\n", previousEnd - 1) + 1;
      return value.slice(previousStart, previousEnd);
    }
    
    function getLineAfter(text, lineEnd) {
      const value = String(text || "");
      if (lineEnd >= value.length) return "";
      const start = lineEnd + 1;
      const nextBreak = value.indexOf("\n", start);
      const end = nextBreak === -1 ? value.length : nextBreak;
      return value.slice(start, end);
    }
    
    function hasUnescapedPipe(line) {
      const value = String(line || "");
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "|") continue;
        let slashCount = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
          slashCount += 1;
        }
        if (slashCount % 2 === 0) return true;
      }
      return false;
    }
    
    function isMarkdownTableSeparatorLine(line) {
      const value = String(line || "").trim();
      if (!value || !hasUnescapedPipe(value)) return false;
      const cells = value.split("|").map(cell => cell.trim()).filter(Boolean);
      return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
    }
    
    function escapeMarkdownTablePipes(value) {
      return String(value || "").replace(/(^|[^\\])\|/g, "$1\\|");
    }
    
    function makeMarkdownTableSafeReference(source, index, reference) {
      return isProbablyMarkdownTableRow(source, index)
        ? escapeMarkdownTablePipes(reference)
        : reference;
    }
    
    function splitList(value) {
      return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter((item, index, list) => item || list.length > 1);
    }
    
    function stripExtension(fileName) {
      return fileName.replace(/\.[^.]+$/, "");
    }
    
    function getSourceParentPath(file) {
      const path = String(file && file.path || "").replace(/\\/g, "/");
      const index = path.lastIndexOf("/");
      return index > 0 ? path.slice(0, index) : "";
    }
    
    function getSourceParentPathFromPath(path) {
      const normalized = normalizeVaultPath(path);
      const index = normalized.lastIndexOf("/");
      return index > 0 ? normalized.slice(0, index) : "";
    }
    
    function getSourceManagedFolderPath(file, useObsidianFolderTree = false) {
      return getSourceManagedFolderPathFromPath(file && file.path, useObsidianFolderTree);
    }
    
    function getSourceManagedFolderPathFromPath(path, useObsidianFolderTree = false) {
      const normalized = normalizeVaultPath(path);
      if (!normalized) return "";
      const sourcePath = useObsidianFolderTree ? normalized : vaultPathBasename(normalized);
      return stripExtension(sourcePath);
    }
    
    function vaultPathBasename(path) {
      const normalized = normalizeVaultPath(path);
      const parts = normalized.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : "";
    }
    
    function normalizeVaultPath(value) {
      return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "")
        .replace(/\/{2,}/g, "/");
    }
    
    function isInsideEagleLibrary(value) {
      return /(^|\/)[^/]+\.library(?:\/|$)/i.test(normalizeVaultPath(value));
    }
    
    function findEagleFolderById(folders, id) {
      const targetId = String(id || "");
      for (const folder of Array.isArray(folders) ? folders : []) {
        if (!folder || typeof folder !== "object") continue;
        if (String(folder.id || "") === targetId) return folder;
        const child = findEagleFolderById(folder.children, targetId);
        if (child) return child;
      }
      return null;
    }
    
    function findEagleFolderWithParentById(folders, id, parent = null) {
      const targetId = String(id || "");
      for (const folder of Array.isArray(folders) ? folders : []) {
        if (!folder || typeof folder !== "object") continue;
        if (String(folder.id || "") === targetId) {
          return {
            folder,
            parent,
            parentId: parent && parent.id ? String(parent.id) : ""
          };
        }
        const child = findEagleFolderWithParentById(folder.children, targetId, folder);
        if (child) return child;
      }
      return null;
    }
    
    function normalizeFolderName(value) {
      return String(value || "").trim().toLowerCase();
    }
    
    function normalizeCreatedEagleFolder(folder, fallbackName) {
      if (!folder || typeof folder !== "object") return null;
      if (folder.name) return folder;
      return Object.assign({}, folder, {
        name: fallbackName
      });
    }
    
    function collectEagleFolderIds(folder) {
      const ids = [];
      const visit = current => {
        if (!current || typeof current !== "object") return;
        const id = String(current.id || current.folderId || current.folderID || "").trim();
        if (id) ids.push(id);
        for (const child of Array.isArray(current.children) ? current.children : []) {
          visit(child);
        }
      };
      visit(folder);
      return Array.from(new Set(ids));
    }
    
    function isSupportedSourceFile(file) {
      return file instanceof TFile && ["md", "canvas"].includes(file.extension);
    }
    
    function isExternalLink(value) {
      return /^(https?:|file:|obsidian:|eagle:|data:)/i.test(value);
    }
    
    function supportedAttachmentExtensions() {
      return SUPPORTED_ATTACHMENT_EXTENSIONS;
    }
    
    function isSupportedAttachment(value) {
      const ext = nodePath.extname(stripAttachmentSubpath(value)).toLowerCase();
      return supportedAttachmentExtensions().includes(ext);
    }
    
    function isSupportedCanvasAttachment(value) {
      const ext = nodePath.extname(stripAttachmentSubpath(value)).toLowerCase();
      return ext !== ".md" && supportedAttachmentExtensions().includes(ext);
    }
    
    function isPreviewableImage(value) {
      const ext = nodePath.extname(String(value || "").split("?")[0]).toLowerCase();
      return PREVIEWABLE_IMAGE_EXTENSIONS.includes(ext);
    }
    
    function normalizeCanvasNodeSize(node, fileName) {
      const width = Number(node && node.width);
      const height = Number(node && node.height);
      const validWidth = Number.isFinite(width) && width > 0;
      const validHeight = Number.isFinite(height) && height > 0;
      if (validWidth && validHeight) {
        return {
          width: Math.round(width),
          height: Math.round(height)
        };
      }
      if (isPreviewableImage(fileName)) {
        return { width: 320, height: 240 };
      }
      return { width: 260, height: 160 };
    }
    
    function createFilePlaceholder(parent, extension, label = "FILE") {
      const placeholder = parent.createDiv({ cls: "eaglebridge-file-placeholder" });
      placeholder.createDiv({ cls: "eaglebridge-file-placeholder-icon", text: label });
      placeholder.createDiv({
        cls: "eaglebridge-file-placeholder-ext",
        text: String(extension || "file").replace(/^\./, "").toUpperCase()
      });
      return placeholder;
    }
    
    function createNotePlaceholder(parent, fileName, label = "NOTE") {
      const placeholder = parent.createDiv({ cls: "eaglebridge-file-placeholder eaglebridge-note-placeholder" });
      placeholder.createDiv({ cls: "eaglebridge-file-placeholder-icon", text: label });
      placeholder.createDiv({
        cls: "eaglebridge-file-placeholder-ext eaglebridge-note-placeholder-name",
        text: String(fileName || "").trim() || "note.md"
      });
      return placeholder;
    }
    
    function getAssetDisplayName(item) {
      return item.__noteLinkName || item.name || item.filename || item.fileName || item.title || item.id || "";
    }
    
    function isStableEagleItem(item) {
      if (!item || isEagleItemTrashed(item)) return false;
      return !!(item.fileURL || item.thumbnailURL || item.url);
    }
    
    function isLikelySameAssetByName(item, expectedName) {
      const expected = normalizeMatchName(expectedName);
      if (!expected) return false;
      return getEagleItemNameCandidates(item).some(name => normalizeMatchName(name) === expected);
    }
    
    function isLikelySameAssetByAnyName(item, expectedNames) {
      return (expectedNames || []).some(name => isLikelySameAssetByName(item, name));
    }
    
    function getDuplicateRepairSearchNames(value) {
      const label = cleanEagleBridgeLabel(value).trim();
      const names = [stripExtension(label), label].filter(Boolean);
      return Array.from(new Set(names));
    }
    
    function getDuplicateRepairExpectedExtension(...values) {
      for (const value of values) {
        const extension = getExtensionFromDisplayName(value);
        if (extension) return extension;
        const direct = normalizeExtension(value);
        if (direct) return direct;
      }
      return "";
    }
    
    function uniqueItemsById(items) {
      const seen = new Set();
      const unique = [];
      for (const item of items || []) {
        const id = getEagleItemId(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(item);
      }
      return unique;
    }
    
    async function mapWithConcurrency(values, limit, mapper) {
      const source = Array.isArray(values) ? values : [];
      const results = new Array(source.length);
      let nextIndex = 0;
      const workerCount = Math.min(Math.max(1, Number(limit) || 1), source.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < source.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await mapper(source[index], index);
        }
      });
      await Promise.all(workers);
      return results;
    }
    
    function getEagleItemNameCandidates(item) {
      if (!item) return [];
      const values = [
        item.name,
        item.filename,
        item.fileName,
        item.title,
        getFileNameFromUrl(item.fileURL),
        getFileNameFromUrl(item.url)
      ];
      return Array.from(new Set(values.map(value => String(value || "").trim()).filter(Boolean)));
    }
    
    function normalizeMatchName(value) {
      const text = cleanEagleBridgeLabel(value)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return stripExtension(text);
    }
    
    function getEagleItemMatchSignature(item) {
      if (!item) return null;
      const width = firstNumberValue(
        item.width, item.imageWidth, item.naturalWidth, item.w,
        getNestedNumberValue(item, "metadata.width", "meta.width", "props.width", "dimensions.width")
      );
      const height = firstNumberValue(
        item.height, item.imageHeight, item.naturalHeight, item.h,
        getNestedNumberValue(item, "metadata.height", "meta.height", "props.height", "dimensions.height")
      );
      const size = firstNumberValue(
        item.size, item.fileSize, item.bytes, item.length,
        getNestedNumberValue(item, "metadata.size", "meta.size", "props.size", "file.size")
      );
      if (!width && !height && !size) return null;
      return { width, height, size };
    }
    
    function isSameEagleAssetSignature(a, b) {
      if (!a || !b) return false;
      if (a.width && b.width && a.width !== b.width) return false;
      if (a.height && b.height && a.height !== b.height) return false;
      if (a.size && b.size && a.size !== b.size) return false;
      return !!((a.width && b.width) || (a.height && b.height) || (a.size && b.size));
    }
    
    function firstNumberValue(...values) {
      for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
      }
      return 0;
    }
    
    function getNestedNumberValue(object, ...paths) {
      for (const pathText of paths) {
        const value = String(pathText || "").split(".").reduce((current, key) => current && current[key], object);
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
      }
      return 0;
    }
    
    function getAssetExtension(item) {
      const displayName = getAssetDisplayName(item);
      const candidates = [
        item.__extension,
        item.ext,
        item.extension,
        getExtensionFromDisplayName(displayName || ""),
        nodePath.extname(String(item.fileURL || "").split("?")[0]),
        nodePath.extname(String(item.url || "").split("?")[0])
      ].filter(Boolean);
      return candidates[0] || "file";
    }
    
    function getWikiAttachmentTarget(value) {
      const text = String(value || "");
      let target = "";
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === "\\" && next === "|") {
          break;
        }
        if (char === "|" || char === "#") {
          break;
        }
        target += char;
      }
      return target.replace(/\\\|/g, "|").trim();
    }
    
    function cleanEagleBridgeLabel(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      return getWikiAttachmentTarget(text) || text;
    }
    
    function sanitizeEagleBridgeEmbedLabel(value) {
      const label = cleanEagleBridgeLabel(value).trim();
      if (!label) return "";
      // Older bridge templates emitted "name|undefined|width". Keep only the
      // actual filename and repair the accidental double dot before extensions.
      return label
        .replace(/\\\|/g, "|")
        .split("|")[0]
        .trim()
        .replace(/\.{2,}([A-Za-z0-9]{1,12})$/, ".$1");
    }
    
    function getDisplayNameWithoutObsidianSize(value) {
      return sanitizeEagleBridgeEmbedLabel(value);
    }
    
    function getExtensionFromDisplayName(value) {
      return normalizeExtension(nodePath.extname(getDisplayNameWithoutObsidianSize(value)));
    }
    
    function getInternetAttachmentDisplayName(label, url) {
      const cleanLabel = sanitizeEagleBridgeEmbedLabel(label);
      const urlName = nodePath.basename(safeDecode(String(url || "").split("?")[0]).replace(/\\/g, "/"));
      const labelExtension = normalizeExtension(nodePath.extname(cleanLabel));
      // A 6060 EagleBridge URL deliberately ends in .info. Its label is the real
      // attachment filename, so never replace it with the transport filename.
      if (urlName.toLowerCase().endsWith(".info") && labelExtension) return cleanLabel;
      // Labels such as "271" are frequently Obsidian display widths. When the
      // URL has a filename, it is the dependable name for a remote attachment.
      if (urlName && normalizeExtension(nodePath.extname(urlName))) return urlName;
      if (cleanLabel && !isLikelyImageSizeLabel(cleanLabel)) return cleanLabel;
      return urlName || cleanLabel || url;
    }
    
    // Normalize every Markdown attachment reference once. Consumers can still use
    // the original fields, while names no longer inherit legacy width/undefined metadata.
    function parseAttachmentReference(reference) {
      const raw = reference || {};
      const target = cleanAttachmentTarget(raw.target || "");
      const external = isExternalLink(target);
      const displayName = external
        ? getInternetAttachmentDisplayName(raw.label, target)
        : cleanLocalCopyCandidateName(target || raw.label);
      return Object.assign({}, raw, {
        target,
        displayName,
        extension: normalizeExtension(nodePath.extname(displayName || target)),
        isExternal: external,
        eagleItemId: extractEagleBridgeItemIdFromText(target)
      });
    }
    
    function getFileNameFromUrl(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      const withoutQuery = text.split("?")[0].split("#")[0];
      return nodePath.basename(safeDecode(withoutQuery).replace(/\\/g, "/"));
    }
    
    function isLikelyImageSizeLabel(value) {
      const text = String(value || "").trim();
      if (!text) return false;
      return /^\d{1,5}$/.test(text) || /^\d{1,5}\s*[x×]\s*\d{1,5}$/i.test(text);
    }
    
    function cleanLocalCopyCandidateName(value) {
      const text = cleanEagleBridgeLabel(value);
      if (!text) return "";
      const cleaned = stripMarkdownLinkTitle(stripAttachmentSubpath(safeDecode(text))).trim();
      return nodePath.basename(cleaned.replace(/\\/g, "/"));
    }
    
    function normalizeExtension(value) {
      const text = String(value || "").trim().toLowerCase();
      if (!text || text === "file") return "";
      return text.startsWith(".") ? text : `.${text}`;
    }
    
    function cleanAttachmentTarget(value) {
      let decoded = decodeAttachmentPath(value)
        .replace(/\\([|()[\]])/g, "$1")
        .trim();
      if (decoded.startsWith("<")) {
        const end = decoded.indexOf(">");
        if (end > 0) decoded = decoded.slice(1, end).trim();
      }
      if (isExternalLink(decoded)) return cleanExternalAttachmentUrl(decoded);
      return stripMarkdownLinkTitle(stripAttachmentSubpath(decoded));
    }
    
    function cleanExternalAttachmentUrl(value) {
      let text = decodeAttachmentPath(value)
        .replace(/\\([|()[\]])/g, "$1")
        .trim();
      if (text.startsWith("<")) {
        const end = text.indexOf(">");
        if (end > 0) text = text.slice(1, end).trim();
      }
      // Markdown permits an optional quoted title after the URL. Keep query/hash
      // intact: signed and image-service URLs frequently depend on both.
      const titled = text.match(/^(\S+)(?:\s+(?:"[^"]*"|'[^']*'))?$/);
      text = titled ? titled[1] : text;
      try {
        const parsed = new URL(text);
        if (/^\/__eaglebridge__\/canvas-(?:image|resource)\/?$/i.test(parsed.pathname)) {
          const source = parsed.searchParams.get("src");
          if (/^https?:\/\//i.test(source || "")) return source;
        }
      } catch (_) {}
      return text;
    }
    
    function stripAttachmentSubpath(value) {
      const text = String(value || "").trim();
      const extEnd = findSupportedAttachmentExtensionEnd(text);
      if (extEnd > 0) return text.slice(0, extEnd);
      return text.split("?")[0].split("#")[0].trim();
    }
    
    function stripMarkdownLinkTitle(value) {
      const text = String(value || "").trim();
      const extEnd = findSupportedAttachmentExtensionEnd(text);
      if (extEnd <= 0) return text;
      return text.slice(0, extEnd);
    }
    
    function findSupportedAttachmentExtensionEnd(value) {
      const lower = String(value || "").toLowerCase();
      let bestEnd = -1;
      for (const ext of supportedAttachmentExtensions()) {
        let from = 0;
        while (from < lower.length) {
          const index = lower.indexOf(ext, from);
          if (index < 0) break;
          const end = index + ext.length;
          const next = lower[end] || "";
          if (!next || /[\s?#)'">]/.test(next)) {
            bestEnd = Math.max(bestEnd, end);
          }
          from = end;
        }
      }
      return bestEnd;
    }
    
    function findMarkdownAttachmentReferences(text) {
      const links = [];
      const source = String(text || "");
      for (let index = 0; index < source.length; index += 1) {
        const imagePrefix = source[index] === "!" && source[index + 1] === "[";
        const linkPrefix = source[index] === "[";
        if (!imagePrefix && !linkPrefix) continue;
    
        const labelStart = imagePrefix ? index + 1 : index;
        const labelEnd = findClosingBracket(source, labelStart, "[", "]");
        if (labelEnd < 0 || source[labelEnd + 1] !== "(") continue;
    
        const targetStart = labelEnd + 2;
        const targetEnd = findMarkdownTargetEnd(source, targetStart);
        if (targetEnd < 0) continue;
    
        const reference = parseAttachmentReference({
          original: source.slice(index, targetEnd + 1),
          label: source.slice(labelStart + 1, labelEnd),
          target: source.slice(targetStart, targetEnd),
          start: index,
          end: targetEnd + 1
        });
        reference.isEmbed = imagePrefix;
        links.push(reference);
        index = targetEnd;
      }
      return links;
    }
    
    function getAttachmentReferenceSignature(text, extension = "md") {
      const source = String(text || "");
      if (String(extension || "").toLowerCase() === "canvas") {
        try {
          const canvas = JSON.parse(source);
          return JSON.stringify((Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [])
            .filter(node => node && (node.file || node.url))
            .map(node => [String(node.id || ""), String(node.file || node.url || "")]));
        } catch (_) {
          return source;
        }
      }
      const references = findMarkdownAttachmentReferences(source)
        .map(reference => `${reference.isEmbed ? "!" : ""}${reference.target}`);
      const wiki = Array.from(source.matchAll(/!\[\[([^\]]+)\]\]/g), match => {
        const parts = String(match[1] || "").split("|");
        if (parts.length > 1 && isLikelyImageSizeLabel(parts.at(-1))) parts.pop();
        return `wiki:${parts.join("|")}`;
      });
      const htmlImages = Array.from(source.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi), match => `html:${match[2]}`);
      return JSON.stringify([...references, ...wiki, ...htmlImages]);
    }
    
    function preserveAttachmentDisplaySize(original, replacement) {
      const source = String(original || "");
      let next = String(replacement || "");
      const htmlWidth = source.match(/\bwidth\s*=\s*["']?(\d{1,5})["']?/i);
      const label = source.match(/^!?\[([^\]]*)\]/);
      const markdownSize = label && String(label[1] || "").split("|").find(isLikelyImageSizeLabel);
      const size = String(markdownSize || (htmlWidth && htmlWidth[1]) || "").trim();
      if (!size) return next;
      if (/^<img\b/i.test(next)) {
        const width = String(size).split("x")[0];
        return /\bwidth\s*=/i.test(next)
          ? next.replace(/\bwidth\s*=\s*(["']?)\d{1,5}\1/i, `width="${width}"`)
          : next.replace(/^<img\b/i, `<img width="${width}"`);
      }
      return next.replace(/^(!?\[)([^\]]*)(\])/, (full, open, value, close) => {
        const parts = String(value || "").split("|").filter(part => !isLikelyImageSizeLabel(part));
        return `${open}${[...parts, size].join("|")}${close}`;
      });
    }
    
    function findClosingBracket(text, start, openChar, closeChar) {
      let escaped = false;
      for (let index = start + 1; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === closeChar) return index;
        if (char === openChar) return -1;
      }
      return -1;
    }
    
    function findMarkdownTargetEnd(text, start) {
      let depth = 0;
      let escaped = false;
      let inAngle = false;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "<") inAngle = true;
        if (char === ">" && inAngle) inAngle = false;
        if (inAngle) continue;
        if (char === "(") {
          depth += 1;
          continue;
        }
        if (char === ")") {
          if (depth === 0) return index;
          depth -= 1;
        }
      }
      return -1;
    }
    
    function decodeAttachmentPath(value) {
      const withoutAngleBrackets = String(value || "").trim().replace(/^<(.+)>$/, "$1");
      try {
        return decodeURIComponent(withoutAngleBrackets);
      } catch (error) {
        return withoutAngleBrackets;
      }
    }
    
    function getItemTime(item) {
      return Number(item.modificationTime || item.lastModified || item.createdAt || item.createTime || 0);
    }
    
    function getEagleItemId(item) {
      if (!item) return "";
      const id = item.id || item.itemId || item.itemID || item._id || "";
      if (id) return stripInfoSuffix(String(id));
      const folder = item.folderName || item.resourceDir || item.path || item.fileURL || "";
      const match = String(folder).match(/\/([^/\\]+)\.info(?:\/|\\|$)/i);
      return match ? stripInfoSuffix(match[1]) : "";
    }
    
    function extractEagleBridgeItemIdFromText(value) {
      const match = String(value || "").match(/https?:\/\/localhost:\d+\/images\/([^)\s"'<>]+)\.info/i);
      return match ? stripInfoSuffix(safeDecode(match[1])) : "";
    }
    
    function isEagleItemTrashed(item) {
      if (!item) return false;
      const flags = [
        item.isDeleted,
        item.deleted,
        item.isTrash,
        item.isTrashed,
        item.trashed,
        item.inTrash,
        item.isRecycle,
        item.isRecycled
      ];
      if (flags.some(isTruthyFlag)) return true;
      const status = String(item.status || item.state || item.folderType || "").toLowerCase();
      if (["trash", "trashed", "deleted", "recycle", "recycled"].includes(status)) return true;
    
      const fields = [
        item.folderName,
        item.folder,
        item.folderId
      ].map(value => String(value || "").toLowerCase());
      return fields.some(value => ["trash", "trashed", "recycle", "recycled"].includes(value));
    }
    
    function itemHasEagleFolder(item, folderId) {
      if (!item || !folderId) return false;
      const target = String(folderId).trim();
      const values = [
        item.folderId,
        item.folderID,
        item.folder,
        item.folder_id
      ];
    
      for (const value of values) {
        if (String(value || "").trim() === target) return true;
      }
    
      const arrayFields = [
        item.folders,
        item.folderIds,
        item.folderIDs,
        item.folder_ids
      ];
      for (const field of arrayFields) {
        if (!Array.isArray(field)) continue;
        for (const entry of field) {
          if (String(entry || "").trim() === target) return true;
          if (entry && typeof entry === "object") {
            const id = entry.id || entry.folderId || entry.folderID || entry.folder_id;
            if (String(id || "").trim() === target) return true;
          }
        }
      }
    
      return false;
    }
    
    function getEagleItemFolderIds(item) {
      if (!item) return [];
      const ids = [];
      const values = [
        item.folderId,
        item.folderID,
        item.folder,
        item.folder_id
      ];
    
      for (const value of values) {
        const id = String(value || "").trim();
        if (id) ids.push(id);
      }
    
      const arrayFields = [
        item.folders,
        item.folderIds,
        item.folderIDs,
        item.folder_ids
      ];
      for (const field of arrayFields) {
        if (!Array.isArray(field)) continue;
        for (const entry of field) {
          if (entry && typeof entry === "object") {
            const id = entry.id || entry.folderId || entry.folderID || entry.folder_id;
            const clean = String(id || "").trim();
            if (clean) ids.push(clean);
          } else {
            const clean = String(entry || "").trim();
            if (clean) ids.push(clean);
          }
        }
      }
    
      return Array.from(new Set(ids));
    }
    
    function findOriginalFileInEagleInfoDir(infoDir, item) {
      if (!infoDir) return "";
      let names = [];
      try {
        names = nodeFs.readdirSync(infoDir);
      } catch (error) {
        return "";
      }
    
      const expectedExtension = normalizeExtension(getAssetExtension(item));
      const displayName = getAssetDisplayName(item);
      const expectedBase = normalizeMatchName(stripExtension(displayName));
      const candidates = [];
      for (const name of names) {
        if (!name || /^metadata(?:-|\.)/i.test(name)) continue;
        if (/_thumbnail\.[^.]+$/i.test(name)) continue;
        const fullPath = nodePath.join(infoDir, name);
        let stat = null;
        try {
          stat = nodeFs.statSync(fullPath);
        } catch (error) {
          continue;
        }
        if (!stat || !stat.isFile()) continue;
        const extension = normalizeExtension(nodePath.extname(name));
        if (expectedExtension && extension !== expectedExtension) continue;
        candidates.push({
          path: fullPath,
          baseScore: expectedBase && normalizeMatchName(stripExtension(name)) === expectedBase ? 1 : 0,
          size: stat.size || 0
        });
      }
    
      candidates.sort((a, b) => (b.baseScore - a.baseScore) || (b.size - a.size));
      return candidates[0] ? candidates[0].path : "";
    }
    
    function replaceEagleBridgeIdsInText(text, replacements) {
      let next = String(text || "");
      for (const [oldId, newId] of replacements instanceof Map ? replacements.entries() : []) {
        const cleanOld = stripInfoSuffix(oldId);
        const cleanNew = stripInfoSuffix(newId);
        if (!cleanOld || !cleanNew || cleanOld === cleanNew) continue;
        next = next.replace(
          new RegExp(`((?:https?:\\\\/\\\\/localhost:\\\\d+\\\\/images\\\\/)|(?:https?:\\/\\/localhost:\\d+\\/images\\/))${escapeRegExp(cleanOld)}(\\.info)`, "g"),
          `$1${cleanNew}$2`
        );
      }
      return next;
    }
    
    function getDefaultEaglePluginsDir() {
      const appData = process && process.env ? process.env.APPDATA : "";
      return appData ? nodePath.join(appData, "Eagle", "Plugins") : "";
    }
    
    function readJsonFile(filePath) {
      try {
        if (!filePath || !nodeFs.existsSync(filePath)) return null;
        return JSON.parse(nodeFs.readFileSync(filePath, "utf8"));
      } catch (error) {
        return null;
      }
    }
    
    function copyDirectory(sourceDir, targetDir) {
      nodeFs.mkdirSync(targetDir, { recursive: true });
      for (const entry of nodeFs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = nodePath.join(sourceDir, entry.name);
        const targetPath = nodePath.join(targetDir, entry.name);
        if (entry.isDirectory()) {
          copyDirectory(sourcePath, targetPath);
        } else if (entry.isFile()) {
          nodeFs.copyFileSync(sourcePath, targetPath);
        }
      }
    }
    
    function compareVersions(a, b) {
      const left = String(a || "").split(".").map(part => Number.parseInt(part, 10) || 0);
      const right = String(b || "").split(".").map(part => Number.parseInt(part, 10) || 0);
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        const diff = (left[index] || 0) - (right[index] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
      return 0;
    }
    
    function isTruthyFlag(value) {
      if (value === true || value === 1) return true;
      const text = String(value || "").trim().toLowerCase();
      return ["true", "1", "yes", "y"].includes(text);
    }
    
    function getTrashBadgeAnchor(image) {
      if (!image) return null;
      const embed = image.closest(".image-embed, .internal-embed, .media-embed");
      if (embed) return embed;
      return image.parentElement || image;
    }
    
    function removeTrashBadgesForImage(image) {
      const anchor = getTrashBadgeAnchor(image);
      removeFollowingTrashBadges(anchor);
      removeFollowingTrashBadges(image);
    }
    
    function removeFollowingTrashBadges(anchor) {
      let next = anchor && anchor.nextElementSibling;
      while (next && next.classList && next.classList.contains("eaglebridge-trash-badge")) {
        const current = next;
        next = next.nextElementSibling;
        current.remove();
      }
    }
    
    function stripInfoSuffix(value) {
      return String(value || "").replace(/\.info$/i, "");
    }
    
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    function normalizeFileUrl(value) {
      const text = String(value || "");
      if (!text) return "";
      if (/^file:\/\//i.test(text)) {
        return normalizeFileUrlPath(text.replace(/^file:\/\/\/?/i, ""));
      }
      if (/^[a-z]+:\/\//i.test(text)) return text;
      if (/^[a-zA-Z]:[\\/]/.test(text) || /^[a-zA-Z]:\//.test(text)) {
        return normalizeFileUrlPath(text);
      }
      return text;
    }
    
    function fileUrlToLocalPath(value) {
      const text = String(value || "");
      if (!/^file:\/\//i.test(text)) return "";
      let pathText = text.replace(/^file:\/\/\/?/i, "");
      try {
        pathText = decodeURI(pathText);
      } catch (error) {
        pathText = pathText.replace(/%25/g, "%");
        try {
          pathText = decodeURI(pathText);
        } catch (innerError) {
          // Keep best effort path.
        }
      }
      return pathText.replace(/\//g, nodePath.sep);
    }
    
    function externalLocalPathFromTarget(value) {
      const target = cleanAttachmentTarget(value);
      if (!target) return "";
      if (/^file:\/\//i.test(target)) return nodePath.normalize(fileUrlToLocalPath(target));
      if (/^[a-zA-Z]:[\\/]/.test(target) || /^\\\\/.test(target)) return nodePath.normalize(target);
      return "";
    }
    
    function eagleLocalPathToFsPath(value) {
      let pathText = String(value || "").trim();
      if (!pathText || /^[a-z]+:\/\//i.test(pathText)) return "";
      if (!/^[a-zA-Z]:[\\/]/.test(pathText) && !/^[a-zA-Z]:\//.test(pathText)) return "";
      try {
        pathText = decodeURI(pathText);
      } catch (error) {
        pathText = pathText.replace(/%25/g, "%");
        try {
          pathText = decodeURI(pathText);
        } catch (innerError) {
          // Keep best effort path.
        }
      }
      return pathText.replace(/\//g, nodePath.sep);
    }
    
    function normalizeFileUrlPath(pathText) {
      let path = String(pathText || "").replace(/\\/g, "/");
      try {
        path = decodeURI(path);
      } catch (error) {
        path = path.replace(/%25/g, "%");
        try {
          path = decodeURI(path);
        } catch (innerError) {
          // Keep the best effort path.
        }
      }
      return `file:///${encodeURI(path)}`;
    }
    
    function safeDecode(value) {
      try {
        return decodeURI(String(value || ""));
      } catch (error) {
        return String(value || "");
      }
    }
    
    function escapeRegExp(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    
    function buildHtmlImage(label, url) {
      return `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(label)}" width="200">`;
    }
    
    function buildStandardEagleBridgeEmbed(label, url, width = "200") {
      const cleanLabel = sanitizeEagleBridgeEmbedLabel(String(label || "Eagle image")
        .replace(/^!?\[/, "")
        .replace(/\]$/, "")) || "Eagle image";
      const normalizedWidth = String(width || "").trim();
      const widthSuffix = /^\d{1,5}$/.test(normalizedWidth) ? `|${normalizedWidth}` : "";
      return `![${cleanLabel}${widthSuffix}](${url})`;
    }
    
    function escapeHtmlAttr(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
    
    function unescapeHtmlAttr(value) {
      return String(value || "")
        .replace(/&quot;/g, "\"")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    }
    
    function normalizeEagleFolderId(value) {
      let text = String(value || "").trim();
      const markdownLink = text.match(/^\[[^\]]*\]\(([^)]+)\)$/);
      if (markdownLink) text = markdownLink[1].trim();
      const protocolMatch = text.match(/^eagle:\/\/folder\/([^/?#]+)/i);
      if (protocolMatch) return safeDecode(protocolMatch[1]).trim();
      try {
        const url = new URL(text);
        const queryId = url.searchParams.get("id");
        if (queryId) return queryId.trim();
      } catch (_error) {
        // A plain folder ID is already valid.
      }
      return text;
    }
    
    module.exports = {
      SUPPORTED_ATTACHMENT_EXTENSIONS, PREVIEWABLE_IMAGE_EXTENSIONS, getAssetSummary, normalizeAssetViewMode,
      clampNumber, buildEagleFolderUrl, formatIdentityDate, normalizeIdentityTitle,
      buildTitleDateIdentity, isIdentityDate, getFileIdentityDate, getStableIdentityDate,
      isObsidianManagedTag, isProbablyMarkdownTableRow, isProbablyMarkdownTableLine, getLineAtIndex,
      indexToLineCh, getLineBefore, getLineAfter, hasUnescapedPipe,
      isMarkdownTableSeparatorLine, escapeMarkdownTablePipes, makeMarkdownTableSafeReference, splitList, stripExtension,
      getSourceParentPath, getSourceParentPathFromPath, getSourceManagedFolderPath, getSourceManagedFolderPathFromPath,
      vaultPathBasename, normalizeVaultPath, isInsideEagleLibrary, findEagleFolderById, findEagleFolderWithParentById,
      normalizeFolderName, normalizeCreatedEagleFolder, collectEagleFolderIds, isSupportedSourceFile,
      isExternalLink, supportedAttachmentExtensions, isSupportedAttachment, isSupportedCanvasAttachment,
      isPreviewableImage, normalizeCanvasNodeSize, createFilePlaceholder, createNotePlaceholder,
      getAssetDisplayName, isStableEagleItem, isLikelySameAssetByName, isLikelySameAssetByAnyName,
      getDuplicateRepairSearchNames, getDuplicateRepairExpectedExtension, uniqueItemsById, mapWithConcurrency,
      getEagleItemNameCandidates, normalizeMatchName, getEagleItemMatchSignature, isSameEagleAssetSignature,
      firstNumberValue, getNestedNumberValue, getAssetExtension, getWikiAttachmentTarget,
      cleanEagleBridgeLabel, sanitizeEagleBridgeEmbedLabel, getDisplayNameWithoutObsidianSize, getExtensionFromDisplayName, getInternetAttachmentDisplayName, parseAttachmentReference,
      getFileNameFromUrl, isLikelyImageSizeLabel, cleanLocalCopyCandidateName, normalizeExtension,
      cleanAttachmentTarget, cleanExternalAttachmentUrl, stripAttachmentSubpath, stripMarkdownLinkTitle, findSupportedAttachmentExtensionEnd,
      findMarkdownAttachmentReferences, getAttachmentReferenceSignature, preserveAttachmentDisplaySize,
      findClosingBracket, findMarkdownTargetEnd, decodeAttachmentPath,
      getItemTime, getEagleItemId, extractEagleBridgeItemIdFromText, isEagleItemTrashed,
      itemHasEagleFolder, getEagleItemFolderIds, findOriginalFileInEagleInfoDir, replaceEagleBridgeIdsInText,
      getDefaultEaglePluginsDir, readJsonFile, copyDirectory, compareVersions,
      isTruthyFlag, getTrashBadgeAnchor, removeTrashBadgesForImage, removeFollowingTrashBadges,
      stripInfoSuffix, sleep, normalizeFileUrl, fileUrlToLocalPath, externalLocalPathFromTarget,
      eagleLocalPathToFsPath, normalizeFileUrlPath, safeDecode, escapeRegExp,
      buildHtmlImage, buildStandardEagleBridgeEmbed, escapeHtmlAttr, unescapeHtmlAttr, normalizeEagleFolderId
    };
    
  },
  "./lib/choice-modal": function(module, exports, require, __filename, __dirname) {
    const { Modal } = require("obsidian");
    
    function chooseInObsidianModal(app, title, message, options, cancelText) {
      return new Promise(resolve => {
        const modal = new ObsidianChoiceModal(app, title, message, options, cancelText, resolve);
        modal.open();
      });
    }
    
    class ObsidianChoiceModal extends Modal {
      constructor(app, title, message, options, cancelText, resolve) {
        super(app);
        this.title = title;
        this.message = message;
        this.options = Array.isArray(options) ? options : [];
        this.cancelText = cancelText;
        this.resolve = resolve;
        this.resolved = false;
      }
    
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("eaglebridge-confirm-modal");
        contentEl.createEl("h3", { text: this.title });
        contentEl.createEl("p", { text: this.message });
        const buttons = contentEl.createDiv({ cls: "eaglebridge-confirm-actions" });
        for (const option of this.options) {
          const button = buttons.createEl("button", {
            text: option.label,
            cls: option.cta ? "mod-cta" : ""
          });
          button.addEventListener("click", () => this.finish(option.value));
        }
        const cancelButton = buttons.createEl("button", { text: this.cancelText });
        cancelButton.addEventListener("click", () => this.finish(null));
        const firstButton = buttons.querySelector("button");
        if (firstButton && typeof firstButton.focus === "function") firstButton.focus();
      }
    
      onClose() {
        if (!this.resolved) this.finish(null, false);
      }
    
      finish(value, shouldClose = true) {
        if (this.resolved) return;
        this.resolved = true;
        this.resolve(value);
        if (shouldClose) this.close();
      }
    }
    
    module.exports = { chooseInObsidianModal };
    
  },
  "./lib/eagle-item-repository": function(module, exports, require, __filename, __dirname) {
    class EagleItemRepository {
      constructor(options) {
        this.request = options.request;
        this.getBaseUrl = options.getBaseUrl;
        this.normalizeId = options.normalizeId;
        this.cacheTtlMs = options.cacheTtlMs || 1200;
        this.cache = new Map();
        this.inFlight = new Map();
      }
    
      invalidate(itemId) {
        const id = this.normalizeId(itemId);
        if (id) this.cache.delete(id);
      }
    
      clear() {
        this.cache.clear();
        this.inFlight.clear();
      }
    
      async get(itemId, options = {}) {
        const id = this.normalizeId(itemId);
        if (!id) return null;
    
        const force = Boolean(options.force);
        const cached = this.cache.get(id);
        if (!force && cached && Date.now() - cached.updatedAt < this.cacheTtlMs) {
          return cached.item;
        }
        if (!force && this.inFlight.has(id)) return this.inFlight.get(id);
    
        const pending = this.fetch(id);
        this.inFlight.set(id, pending);
        const clearPending = () => {
          if (this.inFlight.get(id) === pending) this.inFlight.delete(id);
        };
        pending.then(clearPending, clearPending);
        return pending;
      }
    
      async fetch(id) {
        const base = String(this.getBaseUrl() || "").replace(/\/+$/, "");
        const body = await this.request({
          url: `${base}/api/item/info?id=${encodeURIComponent(id)}`,
          method: "GET"
        });
        const item = body && body.data ? body.data : null;
        if (item) this.cache.set(id, { item, updatedAt: Date.now() });
        return item;
      }
    }
    
    module.exports = { EagleItemRepository };
    
  },
  "./lib/keyed-task-scheduler": function(module, exports, require, __filename, __dirname) {
    class KeyedTaskScheduler {
      constructor(clock = globalThis.window || globalThis) {
        this.clock = clock;
        this.tasks = new Map();
      }
    
      cancel(key) {
        const timers = this.tasks.get(key);
        if (!timers) return;
        for (const timer of timers) this.clock.clearTimeout(timer);
        this.tasks.delete(key);
      }
    
      schedule(key, delay, callback) {
        this.cancel(key);
        const timers = new Set();
        const timer = this.clock.setTimeout(async () => {
          this.tasks.delete(key);
          await callback();
        }, delay);
        timers.add(timer);
        this.tasks.set(key, timers);
      }
    
      scheduleSequence(key, delays, callback) {
        this.cancel(key);
        const timers = new Set();
        for (const delay of delays) {
          timers.add(this.clock.setTimeout(() => callback(delay), delay));
        }
        const cleanupDelay = Math.max(0, ...delays) + 100;
        timers.add(this.clock.setTimeout(() => {
          if (this.tasks.get(key) === timers) this.tasks.delete(key);
        }, cleanupDelay));
        this.tasks.set(key, timers);
      }
    
      clear() {
        for (const key of Array.from(this.tasks.keys())) this.cancel(key);
      }
    }
    
    module.exports = { KeyedTaskScheduler };
    
  },
  "./lib/live-preview-attachments": function(module, exports, require, __filename, __dirname) {
    const { editorLivePreviewField, Notice, setIcon } = require("obsidian");
    const { Prec } = require("@codemirror/state");
    const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
    const nodePath = require("path");
    const { externalLocalPathFromTarget, normalizeFileUrl, normalizeExtension, sanitizeEagleBridgeEmbedLabel, stripInfoSuffix, safeDecode } = require("./asset-utils");
    
    const AUDIO_EXTENSIONS = new Set([".3gp", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".aac", ".opus", ".wma"]);
    const VIDEO_EXTENSIONS = new Set([".mkv", ".mov", ".mp4", ".ogv", ".webm", ".avi", ".wmv", ".m4v", ".flv"]);
    
    function getAttachmentKind(name) {
      const extension = normalizeExtension(nodePath.extname(sanitizeEagleBridgeEmbedLabel(name)));
      if (extension === ".pdf") return "pdf";
      if (AUDIO_EXTENSIONS.has(extension)) return "audio";
      if (VIDEO_EXTENSIONS.has(extension)) return "video";
      return "file";
    }
    
    function parseRenderableAttachmentLinks(text, plugin) {
      const refs = [];
      const source = String(text || "");
      const re = /(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^\n)]*["'])?\)/g;
      let match;
      while ((match = re.exec(source)) !== null) {
        const label = sanitizeEagleBridgeEmbedLabel(String(match[2] || "attachment").replace(/\\([\\[\]])/g, "$1"));
        const target = String(match[3] || match[4] || "");
        if (plugin.isEagleBridgeAssetUrl(target)) {
          const idMatch = target.match(/\/images\/([^/?#]+)\.info(?:$|[?#/])/i);
          if (!idMatch || plugin.isPreviewableAttachmentImage(label)) continue;
          refs.push({ from: match.index, to: match.index + match[0].length, name: label, url: target, itemId: stripInfoSuffix(safeDecode(idMatch[1])), kind: getAttachmentKind(label) });
          continue;
        }
        const localPath = externalLocalPathFromTarget(target);
        if (!localPath || plugin.isPreviewableAttachmentImage(label)) continue;
        refs.push({ from: match.index, to: match.index + match[0].length, name: label, url: normalizeFileUrl(localPath), localPath, kind: getAttachmentKind(label) });
      }
      return refs;
    }
    
    function normalizeLegacyNonImageEmbeds(text, plugin) {
      let count = 0;
      const normalized = String(text || "").replace(/!\[([^\]\n]*)\]\((https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/images\/[^)\s]+\.info)\)/gi, (full, label, url) => {
        const name = sanitizeEagleBridgeEmbedLabel(label);
        if (!plugin.isEagleBridgeAssetUrl(url) || plugin.isPreviewableAttachmentImage(name)) return full;
        count += 1;
        return `[${label}](${url})`;
      });
      return { text: normalized, count };
    }
    
    function createAttachmentElement(plugin, ref) {
      let element;
      if (ref.kind === "audio" || ref.kind === "video") {
        element = document.createElement(ref.kind);
        element.controls = true;
        element.preload = "metadata";
        element.src = ref.url;
        element.className = "eaglebridge-media-embed";
      } else if (ref.kind === "pdf") {
        element = document.createElement("iframe");
        element.src = ref.url;
        element.className = "eaglebridge-pdf-embed";
        element.setAttribute("title", ref.name);
      } else {
        element = document.createElement("button");
        element.type = "button";
        element.className = "eaglebridge-file-embed";
        const icon = document.createElement("span");
        icon.className = "eaglebridge-file-embed-icon";
        setIcon(icon, "file");
        const name = document.createElement("span");
        name.textContent = ref.name;
        element.append(icon, name);
        element.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          void plugin.openAttachmentInDefaultApp(ref).catch(error => {
            new Notice(`打开附件失败：${error && error.message ? error.message : error}`);
          });
        });
      }
      element.setAttribute("aria-label", ref.name);
      element.dataset.eaglebridgeAttachment = "true";
      if (ref.itemId) element.dataset.eaglebridgeItemId = ref.itemId;
      if (ref.localPath) element.dataset.eaglebridgeLocalPath = ref.localPath;
      element.addEventListener("pointerdown", event => event.stopPropagation());
      element.addEventListener("mousedown", event => event.stopPropagation());
      return element;
    }
    
    class AttachmentWidget extends WidgetType {
      constructor(plugin, ref) {
        super();
        this.plugin = plugin;
        this.ref = ref;
      }
    
      eq(other) {
        return this.ref.url === other.ref.url && this.ref.name === other.ref.name;
      }
    
      toDOM() {
        return createAttachmentElement(this.plugin, this.ref);
      }
    
      ignoreEvent() {
        return true;
      }
    }
    
    function buildDecorations(view, plugin) {
      if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
      const text = view.state.doc.toString();
      const selections = view.state.selection.ranges;
      const ranges = parseRenderableAttachmentLinks(text, plugin)
        .filter(ref => !selections.some(selection => selection.empty
          ? selection.from >= ref.from && selection.from < ref.to
          : selection.from < ref.to && selection.to > ref.from))
        .map(ref => Decoration.replace({ widget: new AttachmentWidget(plugin, ref), inclusive: true }).range(ref.from, ref.to));
      return Decoration.set(ranges, true);
    }
    
    function createLivePreviewAttachmentExtension(plugin) {
      return Prec.highest(ViewPlugin.fromClass(class {
        constructor(view) {
          this.decorations = buildDecorations(view, plugin);
        }
    
        update(update) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view, plugin);
          }
        }
      }, { decorations: value => value.decorations }));
    }
    
    module.exports = { createAttachmentElement, createLivePreviewAttachmentExtension, getAttachmentKind, normalizeLegacyNonImageEmbeds, parseRenderableAttachmentLinks };
    
  },
  "./lib/progress-modal": function(module, exports, require, __filename, __dirname) {
    const { Modal } = require("obsidian");
    
    class EagleBridgeProgressModal extends Modal {
      constructor(app, title, description) {
        super(app);
        this.title = title;
        this.description = description;
        this.completed = false;
      }
    
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("eaglebridge-progress-modal");
        contentEl.createEl("h2", { text: this.title });
        this.descriptionEl = contentEl.createEl("p", {
          cls: "eaglebridge-progress-description",
          text: this.description
        });
        this.progressEl = contentEl.createEl("progress", {
          cls: "eaglebridge-progress-bar"
        });
        this.progressEl.max = 1;
        this.progressEl.value = 0;
        this.statusEl = contentEl.createEl("p", {
          cls: "eaglebridge-progress-status",
          text: "准备开始..."
        });
      }
    
      update({ phase = "", completed = 0, total = 0, detail = "" } = {}) {
        if (!this.statusEl || !this.progressEl) return;
        const safeTotal = Math.max(1, Number(total) || 1);
        const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
        this.progressEl.max = safeTotal;
        this.progressEl.value = safeCompleted;
        const progressText = total ? `${safeCompleted} / ${safeTotal}` : "";
        this.statusEl.setText([phase, progressText, detail].filter(Boolean).join("  "));
      }
    
      finish(message, failed = false) {
        if (!this.statusEl || !this.progressEl) return;
        this.completed = true;
        this.progressEl.value = this.progressEl.max;
        this.statusEl.setText(message);
        this.statusEl.toggleClass("is-error", failed);
        this.contentEl.createEl("button", {
          cls: "mod-cta eaglebridge-progress-close",
          text: "关闭"
        }).addEventListener("click", () => this.close());
      }
    
      onClose() {
        this.contentEl.empty();
      }
    }
    
    module.exports = { EagleBridgeProgressModal };
    
  },
  "./lib/settings-tab": function(module, exports, require, __filename, __dirname) {
    const { Notice, PluginSettingTab, Setting } = require("obsidian");
    const { getDefaultEaglePluginsDir, normalizeEagleFolderId } = require("./asset-utils");
    
    function createEagleAssetsSettingTab({ DEFAULT_SETTINGS, VIEW_TYPE }) {
      return class EagleAssetsSettingTab extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }
    
      display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: this.plugin.t("settingsTitle") });
        const showDetectionResult = (value, error) => new Notice(error
          ? this.plugin.t("noticeAutoDetectFailed", { error: error.message || error })
          : this.plugin.t("noticeAutoDetectSuccess", { value: Array.isArray(value) ? value.join("; ") : value }));
        const addTextSetting = ({ name, desc, placeholder, value, onChange, onDetect }) => {
          let input;
          const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addText(text => {
              input = text;
              return text.setPlaceholder(placeholder).setValue(value).onChange(onChange);
            });
          if (onDetect) setting.addButton(button => button
            .setButtonText(this.plugin.t("settingAutoDetect"))
            .onClick(async () => {
              button.setDisabled(true);
              try {
                const detected = await onDetect();
                input.setValue(detected);
                showDetectionResult(detected);
              } catch (error) {
                showDetectionResult(null, error);
              } finally {
                button.setDisabled(false);
              }
            }));
          return setting;
        };
    
        const languageSetting = new Setting(containerEl)
          .setName(this.plugin.t("settingLanguageName"))
          .setDesc(this.plugin.t("settingLanguageDesc"))
          .addDropdown(dropdown => dropdown
            .addOption("auto", this.plugin.t("languageAuto"))
            .addOption("zh", this.plugin.t("languageZh"))
            .addOption("en", this.plugin.t("languageEn"))
            .setValue(this.plugin.settings.language || DEFAULT_SETTINGS.language)
            .onChange(async value => {
              this.plugin.settings.language = value || DEFAULT_SETTINGS.language;
              await this.plugin.saveSettings();
              this.display();
              for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
                const view = leaf.view;
                if (view && typeof view.loadForCurrentNote === "function") {
                  await view.loadForCurrentNote(false);
                }
              }
            }));
    
        const connectionModeSetting = new Setting(containerEl)
          .setName(this.plugin.t("settingConnectionModeName"))
          .setDesc(this.plugin.t("settingLocalConnectionModeDesc"))
          .addButton(button => button
            .setButtonText(this.plugin.t("enterCloudConnectionMode"))
            .onClick(() => this.plugin.switchConnectionMode("cloud")));
    
        const targetFolderSetting = addTextSetting({
          name: this.plugin.t("settingFolderIdName"),
          desc: this.plugin.t("settingFolderIdDesc"),
          placeholder: this.plugin.t("settingFolderIdPlaceholder"),
          value: this.plugin.settings.eagleFolderId || DEFAULT_SETTINGS.eagleFolderId,
          onChange: async value => {
              this.plugin.settings.eagleFolderId = normalizeEagleFolderId(value);
              await this.plugin.saveSettings();
          }
        });
    
        const apiSetting = addTextSetting({
          name: this.plugin.t("settingApiName"),
          desc: this.plugin.t("settingApiDesc"),
          placeholder: "http://localhost:41595",
          value: this.plugin.settings.eagleApiBaseUrl,
          onChange: async value => {
              this.plugin.settings.eagleApiBaseUrl = value.trim() || DEFAULT_SETTINGS.eagleApiBaseUrl;
              await this.plugin.saveSettings();
          }
        });
    
        const bridgeSetting = addTextSetting({
          name: this.plugin.t("settingBridgeUrlName"),
          desc: this.plugin.t("settingBridgeUrlDesc"),
          placeholder: "http://localhost:6060",
          value: this.plugin.settings.eagleBridgeBaseUrl,
          onChange: async value => {
              this.plugin.settings.eagleBridgeBaseUrl = value.trim() || DEFAULT_SETTINGS.eagleBridgeBaseUrl;
              await this.plugin.saveSettings();
              this.plugin.syncCompanionMediaService().catch(error => {
                console.warn("OE Link media service is not ready:", error);
              });
          }
        });
    
        const externalLocalImportSetting = new Setting(containerEl)
          .setName(this.plugin.t("settingImportExternalLocalName"))
          .setDesc(this.plugin.t("settingImportExternalLocalDesc"))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.importExternalLocalAttachments === true)
            .onChange(async value => {
              this.plugin.settings.importExternalLocalAttachments = value;
              await this.plugin.saveSettings();
            }));
        externalLocalImportSetting.settingEl.addClass("eaglebridge-settings-toggle-row");
    
        const helperPluginSetting = new Setting(containerEl)
          .setName(this.plugin.t("settingInstallHelperName"))
          .setDesc(this.plugin.t("settingInstallHelperDesc"));
        helperPluginSetting.settingEl.addClass("eaglebridge-helper-plugin-setting");
        helperPluginSetting.controlEl.empty();
    
        const helperDirectory = helperPluginSetting.settingEl.createDiv({
          cls: "eaglebridge-helper-plugin-directory"
        });
        const helperDirectoryInput = helperDirectory.createEl("input", {
          type: "text",
          placeholder: this.plugin.t("settingHelperPluginsDirPlaceholder"),
          value: this.plugin.settings.eagleHelperPluginsDir || DEFAULT_SETTINGS.eagleHelperPluginsDir
        });
        const saveHelperDirectory = async () => {
          this.plugin.settings.eagleHelperPluginsDir = helperDirectoryInput.value.trim() || DEFAULT_SETTINGS.eagleHelperPluginsDir;
          await this.plugin.saveSettings();
        };
        helperDirectoryInput.addEventListener("change", saveHelperDirectory);
        helperDirectoryInput.addEventListener("blur", saveHelperDirectory);
    
        const detectHelperDirectoryButton = helperDirectory.createEl("button", {
          text: this.plugin.t("settingAutoDetect"),
          cls: "eaglebridge-inline-detect"
        });
        detectHelperDirectoryButton.addEventListener("click", async () => {
          detectHelperDirectoryButton.disabled = true;
          try {
            const value = await this.plugin.detectAndFillEagleHelperPluginsDir();
            helperDirectoryInput.value = value;
            showDetectionResult(value);
          } catch (error) {
            showDetectionResult(null, error);
          } finally {
            detectHelperDirectoryButton.disabled = false;
          }
        });
    
        const installButton = helperPluginSetting.controlEl.createEl("button", {
          text: this.plugin.t("installOrUpdateHelper"),
          cls: "mod-cta eaglebridge-helper-plugin-install"
        });
        installButton.addEventListener("click", async () => {
          await saveHelperDirectory();
          installButton.disabled = true;
          try {
            await this.plugin.installOrUpdateEagleHelperPlugin();
          } finally {
            installButton.disabled = false;
          }
        });
    
        const attachmentCard = containerEl.createDiv({
          cls: "eaglebridge-settings-rule-card eaglebridge-settings-attachment-card"
        });
        const attachmentHeader = attachmentCard.createDiv({ cls: "eaglebridge-settings-rule-header" });
        attachmentHeader.createEl("h4", { text: this.plugin.t("attachmentManagementTitle") });
        const attachmentDescription = attachmentCard.createEl("p", {
          text: `${this.plugin.t("attachmentManagementDesc")} `
        });
        attachmentDescription.createSpan({
          cls: "eaglebridge-settings-inline-warning",
          text: this.plugin.t("attachmentManagementWarning")
        });
        attachmentCard.appendChild(targetFolderSetting.settingEl);
        attachmentCard.appendChild(externalLocalImportSetting.settingEl);
    
        const rules = containerEl.createDiv({ cls: "eaglebridge-settings-rule-grid" });
        const createRuleHeader = (column, title, desc, enabled, onChange) => {
          const header = column.createDiv({ cls: "eaglebridge-settings-rule-header" });
          header.createEl("h4", { text: title });
          const toggleMount = header.createDiv({ cls: "eaglebridge-settings-rule-header-toggle" });
          const setting = new Setting(column)
            .addToggle(toggle => toggle
              .setValue(enabled)
              .onChange(onChange));
          toggleMount.appendChild(setting.controlEl);
          setting.settingEl.remove();
          column.createEl("p", { text: desc });
        };
    
        const tagColumn = rules.createDiv({ cls: "eaglebridge-settings-rule-card" });
        createRuleHeader(
          tagColumn,
          this.plugin.t("tagManagementTitle"),
          this.plugin.t("tagManagementDesc"),
          this.plugin.settings.tagManagementEnabled !== false,
          async value => {
            this.plugin.settings.tagManagementEnabled = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshReferenceViewsForCurrentNote(null, { force: true });
            this.display();
          }
        );
    
        new Setting(tagColumn)
          .setName(this.plugin.t("settingNoteTagNameTemplateName"))
          .setDesc(this.plugin.t("settingNoteTagNameTemplateDesc"))
          .addText(text => text
            .setPlaceholder("Obsidian-{{title}}-{{created}}")
            .setValue(this.plugin.settings.noteTagNameTemplate || DEFAULT_SETTINGS.noteTagNameTemplate)
            .onChange(async value => {
              this.plugin.settings.noteTagNameTemplate = value.trim() || DEFAULT_SETTINGS.noteTagNameTemplate;
              await this.plugin.saveSettings();
            }));
    
        new Setting(tagColumn)
          .setName(this.plugin.t("settingCanvasTagNameTemplateName"))
          .setDesc(this.plugin.t("settingCanvasTagNameTemplateDesc"))
          .addText(text => text
            .setPlaceholder("Obsidian-cavs-{{title}}-{{created}}")
            .setValue(this.plugin.settings.canvasTagNameTemplate || DEFAULT_SETTINGS.canvasTagNameTemplate)
            .onChange(async value => {
              this.plugin.settings.canvasTagNameTemplate = value.trim() || DEFAULT_SETTINGS.canvasTagNameTemplate;
              await this.plugin.saveSettings();
            }));
    
        const rebuildTagsSetting = new Setting(tagColumn)
          .setName(this.plugin.t("settingRebuildAllTagsName"))
          .setDesc(this.plugin.t("settingRebuildAllTagsDesc"))
          .addButton(button => button
            .setButtonText(this.plugin.t("settingRebuildButton"))
            .setWarning()
            .onClick(async () => {
              await this.plugin.confirmAndRebuildAllTags();
            }));
        rebuildTagsSetting.settingEl.addClass("eaglebridge-settings-action-row");
    
        const folderColumn = rules.createDiv({ cls: "eaglebridge-settings-rule-card" });
        createRuleHeader(
          folderColumn,
          this.plugin.t("folderManagementTitle"),
          this.plugin.t("folderManagementDesc"),
          this.plugin.settings.folderManagementEnabled !== false,
          async value => {
            this.plugin.settings.folderManagementEnabled = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshReferenceViewsForCurrentNote(null, { force: true });
            this.display();
          }
        );
    
        const folderTreeDescription = document.createDocumentFragment();
        folderTreeDescription.append(`${this.plugin.t("settingUseObsidianFolderTreeDesc")} `);
        const folderTreeWarning = document.createElement("span");
        folderTreeWarning.className = "eaglebridge-settings-inline-warning";
        folderTreeWarning.textContent = this.plugin.t("settingUseObsidianFolderTreeWarning");
        folderTreeDescription.appendChild(folderTreeWarning);
    
        const folderTreeSetting = new Setting(folderColumn)
          .setName(this.plugin.t("settingUseObsidianFolderTreeName"))
          .setDesc(folderTreeDescription)
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.useObsidianFolderTree === true)
            .onChange(async value => {
              this.plugin.settings.useObsidianFolderTree = value;
              await this.plugin.saveSettings();
            }));
        folderTreeSetting.settingEl.addClass("eaglebridge-settings-toggle-row");
    
        new Setting(folderColumn)
          .setName(this.plugin.t("settingFolderNameTemplateName"))
          .setDesc(this.plugin.t("settingFolderNameTemplateDesc"))
          .addText(text => text
            .setPlaceholder("{{title}}-{{created}}")
            .setValue(this.plugin.settings.eagleFolderNameTemplate || DEFAULT_SETTINGS.eagleFolderNameTemplate)
            .onChange(async value => {
              this.plugin.settings.eagleFolderNameTemplate = value.trim() || DEFAULT_SETTINGS.eagleFolderNameTemplate;
              await this.plugin.saveSettings();
            }));
    
        const rebuildFoldersSetting = new Setting(folderColumn)
          .setName(this.plugin.t("settingRebuildAllFoldersName"))
          .setDesc(this.plugin.t("settingRebuildAllFoldersDesc"))
          .addButton(button => button
            .setButtonText(this.plugin.t("settingRebuildButton"))
            .setWarning()
            .onClick(async () => {
              await this.plugin.confirmAndRebuildAllFolders();
            }));
        rebuildFoldersSetting.settingEl.addClass("eaglebridge-settings-action-row");
    
        const libraryPathsSetting = new Setting(containerEl)
          .setName(this.plugin.t("settingLibraryPathsName"))
          .setDesc(this.plugin.t("settingLibraryPathsDesc"));
        libraryPathsSetting.settingEl.addClass("eaglebridge-library-paths-setting");
        libraryPathsSetting.controlEl.empty();
    
        const pathList = libraryPathsSetting.settingEl.createDiv({
          cls: "eaglebridge-library-path-list"
        });
        const saveLibraryPaths = async () => {
          const paths = Array.from(pathList.querySelectorAll("input"))
            .map(input => String(input.value || "").trim())
            .filter(Boolean);
          this.plugin.settings.eagleBridgeLibraryPaths = [...new Set(paths)];
          await this.plugin.saveSettings();
          this.plugin.syncCompanionMediaService().catch(error => {
            console.warn("OE Link media service is not ready:", error);
          });
        };
        const detectLibraryPath = async button => {
          button.disabled = true;
          try {
            const paths = await this.plugin.detectAndFillEagleLibraryPaths();
            renderPathRows();
            showDetectionResult(paths);
          } catch (error) {
            showDetectionResult(null, error);
          } finally {
            button.disabled = false;
          }
        };
        const createPathRow = (path = "") => {
          const row = pathList.createDiv({ cls: "eaglebridge-library-path-row" });
          const input = row.createEl("input", {
            type: "text",
            value: path,
            placeholder: this.plugin.t("settingLibraryPathsPlaceholder")
          });
          input.addEventListener("change", saveLibraryPaths);
          input.addEventListener("blur", saveLibraryPaths);
          const detect = row.createEl("button", {
            text: this.plugin.t("settingAutoDetect"),
            cls: "eaglebridge-inline-detect"
          });
          detect.addEventListener("click", () => detectLibraryPath(detect));
          const remove = row.createEl("button", {
            text: "×",
            cls: "eaglebridge-library-path-remove",
            attr: { "aria-label": this.plugin.t("settingLibraryPathsRemove") }
          });
          remove.addEventListener("click", async () => {
            row.remove();
            await saveLibraryPaths();
          });
          return input;
        };
        const renderPathRows = () => {
          pathList.empty();
          const paths = Array.isArray(this.plugin.settings.eagleBridgeLibraryPaths)
            ? this.plugin.settings.eagleBridgeLibraryPaths
            : [];
          for (const path of paths) createPathRow(path);
        };
        const addPathButton = libraryPathsSetting.controlEl.createEl("button", {
          text: this.plugin.t("settingLibraryPathsAdd"),
          cls: "eaglebridge-library-path-add"
        });
        addPathButton.addEventListener("click", () => {
          createPathRow().focus();
        });
        renderPathRows();
        languageSetting.settingEl.insertAdjacentElement("afterend", connectionModeSetting.settingEl);
        connectionModeSetting.settingEl.insertAdjacentElement("afterend", helperPluginSetting.settingEl);
        helperPluginSetting.settingEl.insertAdjacentElement("afterend", libraryPathsSetting.settingEl);
        libraryPathsSetting.settingEl.insertAdjacentElement("afterend", apiSetting.settingEl);
        apiSetting.settingEl.insertAdjacentElement("afterend", bridgeSetting.settingEl);
        bridgeSetting.settingEl.insertAdjacentElement("afterend", attachmentCard);
        attachmentCard.insertAdjacentElement("afterend", rules);
    
        const templateSetting = addTextSetting({
          name: this.plugin.t("settingTemplateName"),
          desc: this.plugin.t("settingTemplateDesc"),
          placeholder: DEFAULT_SETTINGS.replacementTemplate,
          value: this.plugin.settings.replacementTemplate,
          onChange: async value => {
              this.plugin.settings.replacementTemplate = value.trim() || DEFAULT_SETTINGS.replacementTemplate;
              await this.plugin.saveSettings();
          }
        });
        attachmentCard.appendChild(templateSetting.settingEl);
    
        const normalizeReferencesSetting = new Setting(attachmentCard)
          .setName(this.plugin.t("settingNormalizeAllReferencesName"))
          .setDesc(this.plugin.t("settingNormalizeAllReferencesDesc"))
          .addButton((button) => button
            .setButtonText(this.plugin.t("settingNormalizeAllReferencesButton"))
            .onClick(async () => {
              await this.plugin.confirmAndNormalizeAllEagleReferenceLabels();
            }));
        normalizeReferencesSetting.settingEl.addClass("eaglebridge-settings-action-row");
    
        new Setting(containerEl)
          .setName(this.plugin.t("settingBuildName"))
          .setDesc(this.plugin.t("settingBuildDesc", { version: this.plugin.manifest.version }));
    
        new Setting(containerEl)
          .setName(this.plugin.t("settingDesktopDiagnosticName"))
          .setDesc(this.plugin.t("settingDesktopDiagnosticDesc"))
          .addButton(button => button
            .setButtonText(this.plugin.t("settingDesktopDiagnosticButton"))
            .onClick(async () => {
              button.setDisabled(true);
              try {
                await this.plugin.exportDesktopDiagnosticLog();
              } catch (error) {
                new Notice(this.plugin.t("noticeDesktopDiagnosticFailed", { error: error && error.message ? error.message : error }));
              } finally {
                button.setDisabled(false);
              }
            }));
      }
    };
    }
    
    module.exports = { createEagleAssetsSettingTab };
    
  },
  "./lib/translations": function(module, exports, require, __filename, __dirname) {
    module.exports = {
      en: {
        ribbonShowAssets: "Show Eagle assets for current note",
        cmdShowAssets: "Show Eagle assets for current note",
        cmdCopyTag: "Copy current note Eagle tag",
        cmdImportAttachments: "Import current note attachments to Eagle",
        cmdFixThumbnailLinks: "Fix Eagle thumbnail API links in current note",
        cmdFixDoubleEncodedLinks: "Fix double-encoded file links in current note",
        cmdConvertFileLinks: "Convert Eagle file links to OE Link links in current note",
        cmdConvertEmbedsToLinks: "Convert OE Link image embeds to links in current note",
        cmdConvertLinksToHtml: "Convert OE Link links to HTML images in current note",
        cmdConvertLinksToEmbeds: "Convert OE Link links to standard embeds in current note",
        menuImportAttachment: "Import this attachment to Eagle",
        copyAttachment: "Copy attachment",
        copyAttachmentReference: "Copy attachment reference",
        openInEagle: "Open in Eagle",
        noticeCopiedEagleTag: "Copied Eagle tag: {tag}",
        noticeOpenNoteOrCanvas: "Open a Markdown note or Canvas first.",
        noticeOpenMarkdown: "Open a Markdown note first.",
        noticeCanvasImportUnsupported: "No directly importable local file nodes were found in this Canvas.",
        noticeNoLocalAttachments: "No importable attachment links found in this note.",
        noticeNoThumbnailLinks: "No Eagle thumbnail API links found.",
        noticeFixedThumbnailLinks: "Fixed {count} Eagle thumbnail link(s).",
        noticeFixedDoubleEncodedLinks: "Fixed {count} double-encoded file link(s).",
        noticeConvertedFileLinks: "Converted {count} Eagle file link(s) to OE Link links.",
        noticeConvertedEmbedsToLinks: "Converted {count} OE Link image embed(s) to link(s).",
        noticeConvertedLinksToHtml: "Converted {count} OE Link link(s) to HTML image(s).",
        noticeConvertedLinksToEmbeds: "Converted {count} OE Link link(s) to standard embed(s).",
        noticeCannotFindRenderedImage: "Cannot find this rendered image link in the current note.",
        noticeNoAttachmentAtCursor: "No local attachment link found at the cursor.",
        noticeImportedToEagle: "Imported to Eagle: {name}",
        noticeProcessedAttachments: "Processed {success} attachment reference(s). Reused: {reused}. Failed: {failed}.",
        noticeNoEagleBridgeLinks: "No OE Link assets found in the current file.",
        noticeCleanedLocalCopies: "Moved {deleted} local copy/copies to trash. Skipped: {skipped}.",
        noticeCannotResolvePath: "Cannot resolve full path: {path}",
        noticeNoEmbedUrl: "Imported to Eagle, but cannot build embed URL for: {name}",
        noticeSyncedTags: "Synced current note tag to {count} Eagle asset(s).",
        noticeRemovedStaleTags: "Removed stale current-file tag from {count} Eagle asset(s).",
        noticeOrganizedEagleFolder: "Moved {count} Eagle asset(s) into the current file folder.",
        clearObsidianTagsTitle: "Clear attachment tags",
        noticeConfirmClearObsidianTags: "Clear all Obsidian-prefixed tags from assets referenced by this note or Canvas?",
        clearCurrentFileTagsOption: "Current note/Canvas",
        clearAllAttachmentTagsOption: "All attachment tags",
        noticeClearedObsidianTags: "Cleared Obsidian tags from {count} Eagle asset(s).",
        clearObsidianFoldersTitle: "Clear attachment folders",
        noticeConfirmClearObsidianFolders: "Clear all Obsidian-managed Eagle folders from assets referenced by this note or Canvas?",
        clearCurrentFileFoldersOption: "Current note/Canvas folder",
        clearAllAttachmentFoldersOption: "All attachment folders",
        noticeClearedObsidianFolders: "Cleared Obsidian-managed folders from {count} Eagle asset(s).",
        noticeClearedObsidianFoldersAndDeleted: "Cleared Obsidian-managed folders from {count} Eagle asset(s) and removed the empty current folder.",
        noticeClearObsidianFoldersNeedsHelper: "Please install/update the Eagle helper plugin first, then restart Eagle.",
        noticeAddedTags: "Added current tag to {count} Eagle asset(s).",
        noticeJoinedFolder: "Added {count} Eagle asset(s) to the current folder.",
        confirm: "Confirm",
        cancel: "Cancel",
        noticeImportedTrashFailed: "Imported, but failed to trash local file: {name}",
        noticeCopied: "Copied: {value}",
        trashTitle: "This Eagle asset is in Eagle trash.",
        readingLinks: "Reading current note OE Link links: {name}",
        copyFirstTag: "Copy tag",
        openEagle: "Open Eagle",
        addTags: "Add tags",
        addToFolder: "Add folder",
        importNoteAttachments: "Import attachments",
        cleanupLocalCopies: "Clean imported attachments",
        clearObsidianTags: "Clear tags",
        clearObsidianFolders: "Clear folders",
        deleteLocalOn: "AUTO",
        deleteLocalOff: "AUTO",
        refresh: "Refresh",
        autoOn: "AUTO",
        autoOff: "AUTO",
        triedTags: "Tried tags: {tags}",
        totalAssets: "Total assets: {count}",
        inEagleCount: "Eagle: {count}",
        localCount: "Obsidian: {count}",
        eagleTrashCount: "Eagle trash: {count}",
        loadFailedCount: "Load failed: {count}",
        internetCount: "Internet: {count}",
        embeddedNote: "Note",
        notePlaceholder: "NOTE",
        viewingEmbeddedNote: "Viewing note: {name}",
        backToCanvas: "Back to Canvas",
        noSupportedAssets: "No supported assets found in the current note.",
        loadMoreAssets: "Scroll down to load more assets",
        obsidianLibrary: "Obsidian asset library",
        obsidianLibraryLoading: "Loading Obsidian assets from Eagle...",
        obsidianLibraryLoaded: "Loaded: {count}",
        obsidianLibraryEmpty: "No assets were found under the configured Eagle Obsidian folder.",
        obsidianLibraryFilterEmpty: "No assets match the current filters.",
        libraryAll: "All",
        libraryReferenced: "Referenced",
        libraryUnreferenced: "Unreferenced",
        referencedCount: "Referenced: {count}",
        unreferencedCount: "Unreferenced: {count}",
        referencedBadge: "Referenced",
        unreferencedBadge: "Unreferenced",
        assetDetails: "Attachment details",
        referencedBy: "Related notes or Canvases",
        noReferences: "This asset is not referenced by an Obsidian note or Canvas.",
        assetName: "Name",
        assetType: "Type",
        assetId: "Eagle ID",
        assetLocation: "Location",
        trashedSingleUnreferencedAsset: "Moved this unreferenced asset to Eagle trash.",
        untitledAsset: "Untitled asset",
        obsidianLocal: "Inside Obsidian vault",
        obsidianExternalLocal: "Outside Obsidian vault",
        internetAsset: "Internet",
        inEagleTrash: "In trash",
        trashLabel: "Trash",
        inEagle: "Inside Eagle library",
        localAttachmentAlt: "Obsidian attachment",
        eagleAssetAlt: "Eagle asset",
        importThisToEagle: "Import this attachment to Eagle",
        moveToObsidianTrash: "Move to Obsidian trash",
        moveToEagleTrash: "Move to Eagle trash",
        trashLocalAttachmentTitle: "Move local attachment to Obsidian trash",
        trashLocalAttachmentConfirm: "Move “{name}” to the Obsidian trash? The file can be restored from Obsidian's trash.",
        localAttachmentStillReferenced: "This local attachment is still referenced by a note or Canvas and cannot be moved to the Obsidian trash.",
        trashedLocalUnreferencedAttachment: "Moved “{name}” to the Obsidian trash.",
        trashLocalAttachmentFailed: "Failed to move “{name}” to the Obsidian trash: {message}",
        localAttachmentNoLongerExists: "This local attachment no longer exists. Refreshed the asset library.",
        filePlaceholder: "FILE",
        viewModeNormal: "Tile",
        viewModeCompact: "Small",
        viewModeList: "List",
        viewModeWaterfall: "Waterfall",
        settingsTitle: "OE Link Local Connection Mode",
        settingLanguageName: "Language",
        settingLanguageDesc: "Choose the plugin UI language. Auto follows Obsidian or system language.",
        languageAuto: "Auto",
        languageZh: "中文",
        languageEn: "English",
        settingConnectionModeName: "Connection mode",
        settingLocalConnectionModeDesc: "Currently using local Eagle connection mode.",
        enterCloudConnectionMode: "Enter cloud connection mode",
        settingBuildName: "Plugin build",
        settingBuildDesc: "Version: {version}",
        settingDesktopDiagnosticName: "Desktop diagnostics",
        settingDesktopDiagnosticDesc: "Checks local image loading and Eagle item opening, then exports a log to the vault root. Passwords and tokens are never included.",
        settingDesktopDiagnosticButton: "Run and export",
        noticeDesktopDiagnosticFailed: "Diagnostic export failed: {error}",
        settingNormalizeAllReferencesName: "Normalize existing Eagle links",
        settingNormalizeAllReferencesDesc: "Apply the current replacement template to existing OE Link references in Markdown notes and canvases.",
        settingNormalizeAllReferencesButton: "Normalize links",
        settingApiName: "Eagle API URL",
        settingApiDesc: "Usually Eagle's local API address.",
        settingHelperPluginsDirName: "Eagle plugin directory",
        settingHelperPluginsDirDesc: "Folder where Eagle stores installed plugins. Used to install or update OE Link Helper.",
        settingHelperPluginsDirPlaceholder: "Enter the Eagle plugins directory",
        settingInstallHelperName: "OE Link Helper",
        settingInstallHelperDesc: "Installs or updates OE Link Helper in Eagle. Bundled version: 0.2.13. Example: C:\\Users\\username\\AppData\\Roaming\\Eagle\\Plugins.",
        installOrUpdateHelper: "Install / update OE Link Helper",
        settingAutoDetect: "Auto detect",
        noticeAutoDetectSuccess: "Detected and filled: {value}",
        noticeAutoDetectFailed: "Auto detection failed: {error}",
        noticeHelperInstalled: "OE Link Helper installed/updated. Restart Eagle or reload the plugin in Eagle if needed.",
        noticeHelperInstallFailed: "Failed to install OE Link Helper: {message}",
        noticeHelperAlreadyCurrent: "OE Link Helper is already current.",
        managementRulesTitle: "Management rules",
        attachmentManagementTitle: "Attachment management",
        attachmentManagementDesc: "Configure where attachments are imported and how OE Link references are written.",
        attachmentManagementWarning: "Imported attachment references are replaced with OE Link links and cannot be restored to their original references.",
        selectAttachment: "Select attachment",
        selectedAssetsStat: "Selected: {count}",
        selectionInlineHint: "Ctrl single · Shift range",
        importSelectedToEagle: "Import selected to Eagle",
        copiedAttachmentReferences: "Copied {count} attachment references.",
        bulkCopyLocalFilesOnly: "Multiple attachments can only be copied together when all selected items have local files.",
        bulkCopyWindowsOnly: "Copying multiple attachments is currently supported on Windows only.",
        copyOriginalLink: "Copy original link",
        noImportableSelectedAssets: "The selected items do not contain attachments that can be imported.",
        trashSelectedLocalAttachmentsConfirm: "Move {count} selected attachments to the Obsidian trash? They can be restored from Obsidian's trash.",
        trashedSelectedLocalAttachments: "Moved {count} selected attachments to the Obsidian trash.",
        trashedSelectedEagleAssets: "Moved {count} selected assets to Eagle trash.",
        tagManagementTitle: "Tag management",
        tagManagementDesc: "Write and clean Eagle tags.",
        folderManagementTitle: "Folder management",
        folderManagementDesc: "Add imports to matching Eagle folders.",
        settingTagManagementEnabledName: "Tag management",
        settingTagManagementEnabledDesc: "Master switch for writing note/canvas identity tags and cleaning stale tags.",
        settingShowClearObsidianTagsName: "Clear attachment tags button",
        settingShowClearObsidianTagsDesc: "Show the Clear attachment tags button in the sidebar. It clears all Obsidian-prefixed tags from assets referenced by the current note or Canvas.",
        settingShowClearObsidianFoldersName: "Clear attachment folders button",
        settingShowClearObsidianFoldersDesc: "Show the Clear attachment folders button in the sidebar. It clears Obsidian-managed Eagle folders from assets referenced by the current note or Canvas.",
        settingFolderManagementEnabledName: "Folder management",
        settingFolderManagementEnabledDesc: "Master switch for matching, creating, and renaming Eagle folders under the configured root folder.",
        settingUseObsidianFolderTreeName: "Mirror Obsidian folder tree",
        settingUseObsidianFolderTreeDesc: "Creates matching Eagle folders from Obsidian folder paths.",
        settingUseObsidianFolderTreeWarning: "Existing folders cannot yet be moved or deleted automatically. Enable with caution.",
        settingFolderNameTemplateName: "Folder naming rule",
        settingFolderNameTemplateDesc: "Variables: {{title}} title, {{created}} creation date.",
        settingFolderIdName: "Eagle target folder ID",
        settingFolderIdDesc: "Target folder for imported assets. Leave blank to import into Eagle Unsorted. Paste either the full copied link or its ID, for example http://localhost:41595/folder?id=ABC123 or ABC123.",
        settingFolderIdPlaceholder: "Enter the target Eagle folder ID",
        settingTagPrefixesName: "Eagle tag prefixes",
        settingTagPrefixesDesc: "Default: Obsidian-. Note assets get Obsidian-{note name-date}.",
        settingNoteTagNameTemplateName: "Note tag naming rule",
        settingNoteTagNameTemplateDesc: "Variables: {{title}} title, {{created}} creation date.",
        settingCanvasPrefixesName: "Canvas tag prefixes",
        settingCanvasPrefixesDesc: "Default: Obsidian-cavs-. Canvas assets get Obsidian-cavs-{canvas name-date}.",
        settingCanvasTagNameTemplateName: "Canvas tag naming rule",
        settingCanvasTagNameTemplateDesc: "Variables: {{title}} title, {{created}} creation date.",
        settingRebuildAllTagsName: "Rebuild all tags",
        settingRebuildAllTagsDesc: "Remove tags beginning with Obsidian, then rewrite them using the current rule.",
        settingRebuildAllFoldersName: "Rebuild all folders",
        settingRebuildAllFoldersDesc: "Rename existing dedicated folders and rebuild their memberships without deleting the original folders.",
        settingRebuildButton: "Rebuild",
        settingBridgeUrlName: "OE Link media service URL",
        settingBridgeUrlDesc: "Local URL used for Eagle asset links. Default: http://localhost:6060. Disable any other Eagle plugin using this port first.",
        settingLibraryPathsName: "Eagle Library Paths",
        settingLibraryPathsDesc: "Add one .library path per computer. OE Link Helper tries available paths in order. Example: C:\\Eagle Library.library. Auto-detection requires Eagle to be open with OE Link Helper installed.",
        settingLibraryPathsAdd: "+ Add path",
        settingLibraryPathsRemove: "Remove library path",
        settingLibraryPathsPlaceholder: "Enter an Eagle .library path",
        settingTrashAfterImportName: "Auto cleanup imported attachments",
        settingTrashAfterImportDesc: "When enabled, local files are moved to the system trash after they are successfully imported into Eagle.",
        settingImportExternalLocalName: "Import attachments outside the Obsidian vault",
        settingImportExternalLocalDesc: "Off by default. When enabled, explicit local file paths in notes can be imported into Eagle; OE Link never scans other folders automatically.",
        settingTemplateName: "Replacement template",
        settingTemplateDesc: "Used for newly imported attachments and when normalizing existing OE Link references below. Available variables: {name}, {filename}, {itemId}, {bridgeUrl}, {url}.",
        cleanLabelFallback: "Eagle image"
      },
      zh: {
        ribbonShowAssets: "显示当前笔记的 Eagle 素材",
        cmdShowAssets: "显示当前笔记的 Eagle 素材",
        cmdCopyTag: "复制当前笔记的 Eagle 标签",
        cmdImportAttachments: "将当前笔记附件导入 Eagle",
        cmdFixThumbnailLinks: "修复当前笔记中的 Eagle 缩略图链接",
        cmdFixDoubleEncodedLinks: "修复当前笔记中的双重编码文件链接",
        cmdConvertFileLinks: "将当前笔记中的 Eagle 文件链接转换为 OE Link 链接",
        cmdConvertEmbedsToLinks: "将当前笔记中的 OE Link 图片嵌入转换为链接",
        cmdConvertLinksToHtml: "将当前笔记中的 OE Link 链接转换为 HTML 图片",
        cmdConvertLinksToEmbeds: "将当前笔记中的 OE Link 链接转换为标准嵌入",
        menuImportAttachment: "导入该附件到 Eagle",
        copyAttachment: "复制附件",
        copyAttachmentReference: "复制附件引用链接",
        openInEagle: "在 Eagle 中打开",
        noticeCopiedEagleTag: "已复制 Eagle 标签：{tag}",
        noticeOpenNoteOrCanvas: "请先打开一个 Markdown 笔记或白板。",
        noticeOpenMarkdown: "请先打开一个 Markdown 笔记。",
        noticeCanvasImportUnsupported: "当前白板没有找到可直接导入的本地文件节点。",
        noticeNoLocalAttachments: "当前笔记没有找到可导入的附件链接。",
        noticeNoThumbnailLinks: "没有找到 Eagle 缩略图 API 链接。",
        noticeFixedThumbnailLinks: "已修复 {count} 个 Eagle 缩略图链接。",
        noticeFixedDoubleEncodedLinks: "已修复 {count} 个双重编码文件链接。",
        noticeConvertedFileLinks: "已将 {count} 个 Eagle 文件链接转换为 OE Link 链接。",
        noticeConvertedEmbedsToLinks: "已将 {count} 个 OE Link 图片嵌入转换为链接。",
        noticeConvertedLinksToHtml: "已将 {count} 个 OE Link 链接转换为 HTML 图片。",
        noticeConvertedLinksToEmbeds: "已将 {count} 个 OE Link 链接转换为标准嵌入。",
        noticeCannotFindRenderedImage: "在当前笔记中找不到这个渲染图片链接。",
        noticeNoAttachmentAtCursor: "光标位置没有找到本地附件链接。",
        noticeImportedToEagle: "已导入 Eagle：{name}",
        noticeProcessedAttachments: "已处理 {success} 个附件引用；复用 {reused} 个；失败 {failed} 个。",
        noticeNoEagleBridgeLinks: "当前文件没有找到 OE Link 链接素材。",
        noticeCleanedLocalCopies: "已将 {deleted} 个本地副本移入回收站；跳过 {skipped} 个。",
        noticeCannotResolvePath: "无法解析完整路径：{path}",
        noticeNoEmbedUrl: "已导入 Eagle，但无法生成嵌入链接：{name}",
        noticeSyncedTags: "已同步当前笔记标签到 {count} 个 Eagle 素材。",
        noticeRemovedStaleTags: "已从 {count} 个 Eagle 素材移除当前文件的旧标签。",
        noticeOrganizedEagleFolder: "已将 {count} 个 Eagle 素材整理到当前文件夹。",
        clearObsidianTagsTitle: "清除附件所有标签",
        noticeConfirmClearObsidianTags: "请选择要清除该笔记或白板内引用素材上的哪一类标签。",
        clearCurrentFileTagsOption: "本笔记/白板标签",
        clearAllAttachmentTagsOption: "全部附件标签",
        noticeClearedObsidianTags: "已清除 {count} 个 Eagle 素材上的 OB 标签。",
        clearObsidianFoldersTitle: "清除附件所有文件夹",
        noticeConfirmClearObsidianFolders: "请选择要清除该笔记或白板内引用素材上的哪一类文件夹归属。",
        clearCurrentFileFoldersOption: "本笔记/白板文件夹",
        clearAllAttachmentFoldersOption: "全部附件文件夹",
        noticeClearedObsidianFolders: "已清除 {count} 个 Eagle 素材上的 Ob 文件夹。",
        noticeClearedObsidianFoldersAndDeleted: "已清除 {count} 个 Eagle 素材上的 Ob 文件夹，并删除空的当前专属文件夹。",
        noticeClearObsidianFoldersNeedsHelper: "请先安装/更新 OE Link 辅助插件，然后重启 Eagle。",
        noticeAddedTags: "已给 {count} 个 Eagle 素材添加当前标签。",
        noticeJoinedFolder: "已将 {count} 个 Eagle 素材加入当前文件夹。",
        confirm: "确定",
        cancel: "取消",
        noticeImportedTrashFailed: "已导入，但未能删除本地文件：{name}",
        noticeCopied: "已复制：{value}",
        trashTitle: "这个 Eagle 素材在 Eagle 回收站中。",
        readingLinks: "正在读取当前笔记的 OE Link 链接：{name}",
        copyFirstTag: "复制标签",
        openEagle: "打开 Eagle",
        addTags: "添加标签",
        addToFolder: "加入文件夹",
        importNoteAttachments: "导入附件",
        cleanupLocalCopies: "清理已导入附件",
        clearObsidianTags: "清除标签",
        clearObsidianFolders: "清除文件夹",
        deleteLocalOn: "AUTO",
        deleteLocalOff: "AUTO",
        refresh: "刷新",
        autoOn: "AUTO",
        autoOff: "AUTO",
        triedTags: "标签：{tags}",
        totalAssets: "素材总数：{count}",
        inEagleCount: "Eagle：{count}",
        localCount: "Obsidian：{count}",
        eagleTrashCount: "Eagle 回收站：{count}",
        loadFailedCount: "加载失败：{count}",
        internetCount: "网络素材：{count}",
        embeddedNote: "笔记",
        notePlaceholder: "笔记",
        viewingEmbeddedNote: "当前笔记：{name}",
        backToCanvas: "返回白板",
        noSupportedAssets: "当前笔记没有找到支持的素材。",
        loadMoreAssets: "继续向下滚动以加载更多素材",
        obsidianLibrary: "Obsidian 素材库",
        obsidianLibraryLoading: "正在加载 Eagle 中的 Obsidian 素材...",
        obsidianLibraryLoaded: "已加载：{count}",
        obsidianLibraryEmpty: "配置的 Eagle Obsidian 文件夹下没有找到素材。",
        obsidianLibraryFilterEmpty: "当前筛选条件下没有素材。",
        libraryAll: "全部",
        libraryReferenced: "已引用",
        libraryUnreferenced: "未引用",
        referencedCount: "已引用：{count}",
        unreferencedCount: "未引用：{count}",
        referencedBadge: "已引用",
        unreferencedBadge: "未引用",
        assetDetails: "附件详情",
        referencedBy: "关联笔记或白板",
        noReferences: "当前没有 Obsidian 笔记或白板引用这个素材。",
        assetName: "名称",
        assetType: "类型",
        assetId: "Eagle ID",
        assetLocation: "位置",
        trashedSingleUnreferencedAsset: "已将这个未引用素材移入 Eagle 回收站。",
        untitledAsset: "未命名素材",
        obsidianLocal: "Obsidian 库内",
        obsidianExternalLocal: "Obsidian 库外",
        internetAsset: "网络素材",
        inEagleTrash: "在回收站",
        trashLabel: "回收站",
        inEagle: "Eagle 库内",
        localAttachmentAlt: "Obsidian 附件",
        eagleAssetAlt: "Eagle 素材",
        importThisToEagle: "导入该附件到 Eagle",
        moveToObsidianTrash: "移入 Obsidian 回收站",
        moveToEagleTrash: "移入 Eagle 回收站",
        trashLocalAttachmentTitle: "移入 Obsidian 回收站",
        trashLocalAttachmentConfirm: "确认将“{name}”移入 Obsidian 回收站吗？可在 Obsidian 回收站中还原。",
        localAttachmentStillReferenced: "该本地附件仍被笔记或白板引用，不能移入 Obsidian 回收站。",
        trashedLocalUnreferencedAttachment: "已将“{name}”移入 Obsidian 回收站。",
        trashLocalAttachmentFailed: "移入 Obsidian 回收站失败：{message}",
        localAttachmentNoLongerExists: "本地附件已不存在，已刷新素材库。",
        filePlaceholder: "文件",
        viewModeNormal: "平铺",
        viewModeCompact: "小图",
        viewModeList: "列表",
        viewModeWaterfall: "瀑布",
        settingsTitle: "OE Link 本地连接模式",
        settingLanguageName: "语言",
        settingLanguageDesc: "选择插件界面语言。自动模式会跟随 Obsidian 或系统语言。",
        languageAuto: "自动",
        languageZh: "中文",
        languageEn: "English",
        settingConnectionModeName: "连接模式",
        settingLocalConnectionModeDesc: "当前为本地连接 Eagle 模式。",
        enterCloudConnectionMode: "进入云端连接模式",
        settingBuildName: "插件版本",
        settingBuildDesc: "版本：{version}",
        settingDesktopDiagnosticName: "本地连接诊断日志",
        settingDesktopDiagnosticDesc: "检查本地图片加载和 Eagle 素材定位，并将日志导出到仓库根目录。不会记录密码或令牌。",
        settingDesktopDiagnosticButton: "运行并导出日志",
        noticeDesktopDiagnosticFailed: "诊断日志导出失败：{error}",
        settingNormalizeAllReferencesName: "统一修正现有 Eagle 引用链接",
        settingNormalizeAllReferencesDesc: "按照当前替换模板，统一 Markdown 笔记和白板中的现有 OE Link 引用。",
        settingNormalizeAllReferencesButton: "开始修正",
        settingApiName: "Eagle API 地址",
        settingApiDesc: "通常是 Eagle 的本地 API 地址。",
        settingHelperPluginsDirName: "Eagle 插件目录",
        settingHelperPluginsDirDesc: "Eagle 存放已安装插件的文件夹，用来安装或更新 OE Link 辅助插件。",
        settingHelperPluginsDirPlaceholder: "请输入 Eagle 插件目录",
        settingInstallHelperName: "OE Link 辅助插件",
        settingInstallHelperDesc: "安装或更新 Eagle 端的 OE Link 辅助插件。内置版本：0.2.13。例如：C:\\Users\\用户名\\AppData\\Roaming\\Eagle\\Plugins。",
        installOrUpdateHelper: "安装/更新 OE Link 辅助插件",
        settingAutoDetect: "自动检测",
        noticeAutoDetectSuccess: "已检测并填写：{value}",
        noticeAutoDetectFailed: "自动检测失败：{error}",
        noticeHelperInstalled: "OE Link 辅助插件已安装/更新。如未生效，请重启 Eagle 或在 Eagle 插件面板中重新加载。",
        noticeHelperInstallFailed: "安装 OE Link 辅助插件失败：{message}",
        noticeHelperAlreadyCurrent: "OE Link 辅助插件已经是最新版本。",
        managementRulesTitle: "管理规则",
        attachmentManagementTitle: "附件管理",
        attachmentManagementDesc: "设置附件导入位置与 OE Link 引用方式。",
        attachmentManagementWarning: "导入后将会将原附件引用链接替换为 OE Link 链接，不支持恢复原引用。",
        selectAttachment: "选择附件",
        selectedAssetsStat: "已选择: {count}",
        selectionInlineHint: "Ctrl 单选 · Shift 连选",
        importSelectedToEagle: "导入所选到 Eagle",
        copiedAttachmentReferences: "已复制 {count} 条附件引用链接。",
        bulkCopyLocalFilesOnly: "只有全部选中项都具有本地文件时，才能一次复制多个附件。",
        bulkCopyWindowsOnly: "当前仅支持在 Windows 中一次复制多个附件。",
        copyOriginalLink: "复制原始链接",
        noImportableSelectedAssets: "所选素材中没有可导入的附件。",
        trashSelectedLocalAttachmentsConfirm: "确认将选中的 {count} 个附件移入 Obsidian 回收站吗？可在 Obsidian 回收站中还原。",
        trashedSelectedLocalAttachments: "已将选中的 {count} 个附件移入 Obsidian 回收站。",
        trashedSelectedEagleAssets: "已将选中的 {count} 个素材移入 Eagle 回收站。",
        tagManagementTitle: "标签管理",
        tagManagementDesc: "写入与清理 Eagle 标签。",
        folderManagementTitle: "文件夹管理",
        folderManagementDesc: "将素材加入对应的 Eagle 文件夹。",
        settingTagManagementEnabledName: "标签管理",
        settingTagManagementEnabledDesc: "总开关：写入笔记/白板身份标签，并清理旧标签。",
        settingShowClearObsidianTagsName: "清除附件所有标签按钮",
        settingShowClearObsidianTagsDesc: "开启后，侧边栏会显示“清除附件所有标签”按钮，用来清除当前笔记/白板引用素材上的所有 Obsidian 开头标签。",
        settingShowClearObsidianFoldersName: "清除附件所有文件夹按钮",
        settingShowClearObsidianFoldersDesc: "开启后，侧边栏会显示“清除附件所有文件夹”按钮，用来清除当前笔记/白板引用素材上的 Obsidian 管理文件夹。",
        settingFolderManagementEnabledName: "文件夹管理",
        settingFolderManagementEnabledDesc: "总开关：匹配、创建并重命名 Eagle 文件夹。",
        settingUseObsidianFolderTreeName: "镜像 Obsidian 目录树",
        settingUseObsidianFolderTreeDesc: "开启后根据 Obsidian 文件夹路径，在 Eagle 中生成对应文件夹。",
        settingUseObsidianFolderTreeWarning: "暂不支持自动移动或删除已有文件夹，请谨慎开启。",
        settingFolderNameTemplateName: "文件夹命名规则",
        settingFolderNameTemplateDesc: "变量：{{title}} 名称，{{created}} 创建日期。",
        settingFolderIdName: "Eagle 目标文件夹 ID",
        settingFolderIdDesc: "填写素材导入的目标文件夹；留空则导入 Eagle 未分类。可粘贴完整链接或 ID，例如 http://localhost:41595/folder?id=ABC123 或 ABC123。",
        settingFolderIdPlaceholder: "请输入 Eagle 目标文件夹 ID",
        settingTagPrefixesName: "Eagle 标签前缀",
        settingTagPrefixesDesc: "默认 Obsidian-；笔记素材会写入 Obsidian-{笔记名-日期}。",
        settingNoteTagNameTemplateName: "笔记标签命名规则",
        settingNoteTagNameTemplateDesc: "变量：{{title}} 名称，{{created}} 创建日期。",
        settingCanvasPrefixesName: "白板标签前缀",
        settingCanvasPrefixesDesc: "默认 Obsidian-cavs-；白板素材会写入 Obsidian-cavs-{白板名-日期}。",
        settingCanvasTagNameTemplateName: "白板标签命名规则",
        settingCanvasTagNameTemplateDesc: "变量：{{title}} 名称，{{created}} 创建日期。",
        settingRebuildAllTagsName: "重新生成所有标签",
        settingRebuildAllTagsDesc: "清理所有以 Obsidian 开头的标签，再按当前规则重新写入。",
        settingRebuildAllFoldersName: "重新生成所有文件夹",
        settingRebuildAllFoldersDesc: "在原有专属文件夹基础上重命名并重建素材归属，不会删除原有文件夹。",
        settingRebuildButton: "重新生成",
        settingBridgeUrlName: "OE Link 素材服务地址",
        settingBridgeUrlDesc: "Eagle 素材链接使用的本地地址，默认 http://localhost:6060。请先停用其他占用该端口的 Eagle 插件。",
        settingLibraryPathsName: "Eagle 素材库路径",
        settingLibraryPathsDesc: "每台电脑添加一条 .library 路径，OE Link 辅助插件会按顺序尝试可用路径。例如：C:\\Eagle素材库.library。（自动检测需打开 Eagle 并安装辅助插件）",
        settingLibraryPathsAdd: "+ 添加路径",
        settingLibraryPathsRemove: "删除素材库路径",
        settingLibraryPathsPlaceholder: "请输入 Eagle .library 素材库路径",
        settingTrashAfterImportName: "自动清理已导入附件",
        settingTrashAfterImportDesc: "开启后，只有 Eagle 导入成功时，才会自动把本地文件移入系统回收站。",
        settingImportExternalLocalName: "导入 Obsidian 库外附件",
        settingImportExternalLocalDesc: "默认关闭。开启后可导入笔记中明确引用的库外本地文件；不会扫描电脑中的其他文件夹。",
        settingTemplateName: "替换模板",
        settingTemplateDesc: "新导入附件及下方统一修正现有 OE Link 引用时使用。可用变量：{name}、{filename}、{itemId}、{bridgeUrl}、{url}。",
        cleanLabelFallback: "Eagle 图片"
      }
    };
    
  }
  };
  const cache = Object.create(null);

  function normalizeLocalId(request, parentId) {
    const parentParts = String(parentId || "./main").split("/");
    parentParts.pop();
    const parts = parentParts.concat(String(request).split("/"));
    const normalized = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") normalized.pop();
      else normalized.push(part);
    }
    let id = "./" + normalized.join("/");
    if (id.endsWith(".js")) id = id.slice(0, -3);
    return id;
  }

  function load(request, parentId) {
    if (!String(request).startsWith(".")) return nativeRequire(request);
    const id = normalizeLocalId(request, parentId);
    if (!Object.prototype.hasOwnProperty.call(factories, id)) {
      throw new Error("Bundled module not found: " + request + " from " + parentId);
    }
    if (cache[id]) return cache[id].exports;

    const localModule = { exports: {} };
    cache[id] = localModule;
    const filename = id + ".js";
    const dirname = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : ".";
    const localRequire = childRequest => load(childRequest, id);
    factories[id](localModule, localModule.exports, localRequire, filename, dirname);
    return localModule.exports;
  }

  nativeModule.exports = load("./main", "./entry");
})(require, module);

// DESKTOP_BUNDLE_END
}
