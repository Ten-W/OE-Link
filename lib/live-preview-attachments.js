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
