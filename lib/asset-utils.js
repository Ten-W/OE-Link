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
  unescapeHtmlAttr, normalizeEagleFolderId
};
