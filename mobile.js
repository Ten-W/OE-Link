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
