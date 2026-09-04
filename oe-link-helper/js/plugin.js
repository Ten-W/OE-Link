(function () {
  const HELPER_VERSION = "0.2.13";
  const HOST = "127.0.0.1";
  const PORTS = Array.from({ length: 10 }, (_, index) => 41596 + index);
  let server = null;
  let serverPort = 0;
  let mediaServer = null;
  let mediaConfig = {
    port: 6060,
    libraryPaths: []
  };
  // The cache is deliberately process-local. It keeps repeated imports quick
  // without persisting library paths or stale hashes to disk.
  const contentHashCache = new Map();

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "app://obsidian.md",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    res.end(JSON.stringify(payload));
  }

  function writeMediaHeaders(res, statusCode, headers) {
    res.writeHead(statusCode, Object.assign({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "range, content-type",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Cache-Control": "no-store"
    }, headers || {}));
  }

  function contentTypeFor(filePath) {
    const ext = String(require("path").extname(String(filePath || ""))).toLowerCase();
    const types = {
      ".avif": "image/avif", ".bmp": "image/bmp", ".gif": "image/gif", ".ico": "image/x-icon",
      ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
      ".tif": "image/tiff", ".tiff": "image/tiff", ".webp": "image/webp", ".pdf": "application/pdf",
      ".3gp": "audio/3gpp", ".flac": "audio/flac", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg", ".wav": "audio/wav", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
      ".mp4": "video/mp4", ".ogv": "video/ogg", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8"
    };
    return types[ext] || "application/octet-stream";
  }

  function normalizeMediaPort(value) {
    const port = Number.parseInt(String(value || ""), 10);
    return Number.isInteger(port) && port >= 1000 && port <= 9999 ? port : 6060;
  }

  function normalizeLibraryPaths(paths) {
    return Array.from(new Set((Array.isArray(paths) ? paths : [])
      .map(value => String(value || "").trim())
      .filter(Boolean)));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          reject(new Error("Request body is too large."));
          req.destroy();
        }
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  async function getItemById(itemId) {
    if (!window.eagle || !eagle.item) throw new Error("Eagle item API is not available.");
    if (typeof eagle.item.getById === "function") return await eagle.item.getById(itemId);
    if (typeof eagle.item.get === "function") return await eagle.item.get(itemId);
    throw new Error("This Eagle version does not expose item lookup API.");
  }

  async function resolveItemFilePath(itemId) {
    const fs = require("fs");
    const path = require("path");
    const cleanItemId = String(itemId || "").trim().replace(/\.info$/i, "");
    let item = null;
    try {
      item = await getItemById(cleanItemId);
    } catch (error) {
      console.warn("[OE Link Helper] Eagle item lookup failed; trying the library files:", cleanItemId, error);
    }
    const candidates = [item && item.filePath, item && item.path, item && item.sourcePath]
      .map(value => String(value || "").trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { item, filePath: candidate };
        }
      } catch (error) {
        console.warn("[OE Link Helper] Cannot read candidate path:", candidate, error);
      }
    }
    const itemExt = String(item && item.ext || "").replace(/^\./, "").toLowerCase();
    const preferredExt = itemExt ? `.${itemExt}` : "";
    for (const libraryPath of mediaConfig.libraryPaths) {
      const infoDir = path.join(libraryPath, "images", `${cleanItemId}.info`);
      try {
        if (!fs.existsSync(infoDir) || !fs.statSync(infoDir).isDirectory()) continue;
        const files = fs.readdirSync(infoDir)
          .map(name => path.join(infoDir, name))
          .filter(candidate => {
            try { return fs.statSync(candidate).isFile(); } catch (error) { return false; }
          });
        const fallback = (preferredExt && files.find(candidate => path.extname(candidate).toLowerCase() === preferredExt))
          || files.find(candidate => !isAuxiliaryItemFile(candidate));
        if (fallback) return { item: item || { id: cleanItemId, ext: path.extname(fallback).slice(1) }, filePath: fallback };
      } catch (error) {
        console.warn("[OE Link Helper] Cannot inspect configured library:", libraryPath, error);
      }
    }
    throw new Error(item
      ? `Eagle did not expose a readable file path for item: ${itemId}`
      : `Cannot find Eagle item or library file: ${itemId}`);
  }

  function isAuxiliaryItemFile(filePath) {
    const path = require("path");
    const name = path.basename(String(filePath || "")).toLowerCase();
    return name === "metadata.json"
      || name.includes("thumbnail")
      || name.includes("preview");
  }

  // A library item can expose a thumbnail or another derived file before its
  // original. Content matching must inspect every plausible original file.
  function listItemFilesForContentHash(item) {
    const fs = require("fs");
    const path = require("path");
    const candidates = new Set();
    const addFile = (candidate) => {
      const normalized = String(candidate || "").trim();
      if (!normalized || isAuxiliaryItemFile(normalized)) return;
      try {
        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
          candidates.add(normalized);
        }
      } catch (error) {
        console.warn("[OE Link Helper] Cannot inspect content candidate:", normalized, error);
      }
    };

    [item && item.filePath, item && item.path, item && item.sourcePath].forEach(addFile);
    const itemId = String(item && item.id || "").trim();
    if (!itemId) return Array.from(candidates);

    for (const libraryPath of mediaConfig.libraryPaths) {
      const infoDir = path.join(libraryPath, "images", `${itemId}.info`);
      try {
        if (!fs.existsSync(infoDir) || !fs.statSync(infoDir).isDirectory()) continue;
        for (const name of fs.readdirSync(infoDir)) addFile(path.join(infoDir, name));
      } catch (error) {
        console.warn("[OE Link Helper] Cannot inspect item directory:", infoDir, error);
      }
    }
    return Array.from(candidates);
  }

  function getItemIdFromMediaUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, `http://${HOST}:${mediaConfig.port}`);
      const match = parsed.pathname.match(/^\/images\/([^/?#]+)\.info$/i);
      return match ? decodeURIComponent(match[1]).replace(/\.info$/i, "") : "";
    } catch (error) {
      return "";
    }
  }

  async function serveItemFile(req, res, itemId) {
    const fs = require("fs");
    const resolved = await resolveItemFilePath(itemId);
    const stat = fs.statSync(resolved.filePath);
    const total = stat.size;
    const range = String(req.headers.range || "");
    const baseHeaders = {
      "Content-Type": contentTypeFor(resolved.filePath),
      "Accept-Ranges": "bytes",
      "Content-Length": total
    };
    if (req.method === "HEAD") {
      writeMediaHeaders(res, 200, baseHeaders);
      return;
    }
    const match = range.match(/^bytes=(\d*)-(\d*)$/i);
    if (match) {
      const start = match[1] === "" ? 0 : Number.parseInt(match[1], 10);
      const end = match[2] === "" ? total - 1 : Math.min(Number.parseInt(match[2], 10), total - 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        writeMediaHeaders(res, 416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      writeMediaHeaders(res, 206, Object.assign({}, baseHeaders, {
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${total}`
      }));
      fs.createReadStream(resolved.filePath, { start, end }).pipe(res);
      return;
    }
    writeMediaHeaders(res, 200, baseHeaders);
    fs.createReadStream(resolved.filePath).pipe(res);
  }

  async function handleMediaRequest(req, res) {
    if (req.method === "OPTIONS") {
      writeMediaHeaders(res, 200);
      res.end();
      return;
    }
    const parsed = new URL(req.url, `http://${HOST}:${mediaConfig.port}`);
    if (req.method === "GET" && parsed.pathname === "/health") {
      return sendJson(res, 200, { status: "success", service: "media", version: HELPER_VERSION, port: mediaConfig.port });
    }
    let itemId = getItemIdFromMediaUrl(req.url);
    if (!itemId && /^\/__eaglebridge__\/canvas-(?:image|resource)$/i.test(parsed.pathname)) {
      itemId = getItemIdFromMediaUrl(parsed.searchParams.get("src") || "");
    }
    if (itemId && (req.method === "GET" || req.method === "HEAD")) {
      return serveItemFile(req, res, itemId);
    }
    writeMediaHeaders(res, 404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "error", message: "Not found." }));
  }

  function stopMediaServer() {
    return new Promise(resolve => {
      if (!mediaServer) return resolve();
      const closing = mediaServer;
      mediaServer = null;
      closing.close(() => resolve());
    });
  }

  async function startMediaServer() {
    const http = require("http");
    if (mediaServer && mediaServer.listening) return;
    const activeServer = http.createServer((req, res) => {
      handleMediaRequest(req, res).catch(error => {
        writeMediaHeaders(res, 500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", message: error && error.message ? error.message : String(error) }));
      });
    });
    mediaServer = activeServer;
    await new Promise((resolve, reject) => {
      const fail = error => {
        activeServer.removeListener("listening", ready);
        if (mediaServer === activeServer) mediaServer = null;
        reject(error);
      };
      const ready = () => {
        activeServer.removeListener("error", fail);
        console.log(`[OE Link Helper] media service listening on http://${HOST}:${mediaConfig.port}`);
        resolve();
      };
      activeServer.once("error", fail);
      activeServer.once("listening", ready);
      activeServer.listen(mediaConfig.port, HOST);
    });
  }

  async function configureMediaService(data) {
    const nextPort = normalizeMediaPort(data && data.port);
    const nextLibraryPaths = normalizeLibraryPaths(data && data.libraryPaths);
    const portChanged = nextPort !== mediaConfig.port;
    mediaConfig = { port: nextPort, libraryPaths: nextLibraryPaths };
    if (portChanged) await stopMediaServer();
    await startMediaServer();
    return { port: mediaConfig.port, libraryPaths: mediaConfig.libraryPaths, version: HELPER_VERSION };
  }

  async function addItemToFolder(itemId, folderId) {
    const cleanItemId = String(itemId || "").trim().replace(/\.info$/i, "");
    const cleanFolderId = String(folderId || "").trim();
    if (!cleanItemId) throw new Error("Missing itemId.");
    if (!cleanFolderId) throw new Error("Missing folderId.");

    const item = await getItemById(cleanItemId);
    if (!item) throw new Error(`Cannot find Eagle item: ${cleanItemId}`);

    const folders = Array.isArray(item.folders) ? item.folders.slice() : [];
    if (!folders.includes(cleanFolderId)) folders.push(cleanFolderId);
    item.folders = folders;

    if (typeof item.save !== "function") {
      throw new Error("This Eagle item object does not support save().");
    }
    await item.save();
    return { itemId: cleanItemId, folders };
  }

  async function removeItemFromFolders(itemId, folderIds) {
    const cleanItemId = String(itemId || "").trim().replace(/\.info$/i, "");
    const idsToRemove = new Set((Array.isArray(folderIds) ? folderIds : [])
      .map(id => String(id || "").trim())
      .filter(Boolean));
    if (!cleanItemId) throw new Error("Missing itemId.");
    if (!idsToRemove.size) throw new Error("Missing folderIds.");

    const item = await getItemById(cleanItemId);
    if (!item) throw new Error(`Cannot find Eagle item: ${cleanItemId}`);

    const folders = Array.isArray(item.folders) ? item.folders.slice() : [];
    const nextFolders = folders.filter(folder => {
      if (idsToRemove.has(String(folder || "").trim())) return false;
      if (folder && typeof folder === "object") {
        const id = folder.id || folder.folderId || folder.folderID || folder.folder_id;
        if (idsToRemove.has(String(id || "").trim())) return false;
      }
      return true;
    });
    item.folders = nextFolders;

    if (typeof item.save !== "function") {
      throw new Error("This Eagle item object does not support save().");
    }
    await item.save();
    return { itemId: cleanItemId, folders: nextFolders, removed: folders.length - nextFolders.length };
  }

  async function moveItemsToTrash(itemIds) {
    const ids = Array.from(new Set((Array.isArray(itemIds) ? itemIds : [itemIds])
      .map(itemId => String(itemId || "").trim().replace(/\.info$/i, ""))
      .filter(Boolean)));
    if (!ids.length) throw new Error("Missing itemIds.");
    if (!window.eagle || !eagle.item) throw new Error("Eagle item API is not available.");

    if (typeof eagle.item.moveToTrash === "function") {
      await eagle.item.moveToTrash(ids);
      return { moved: ids.length };
    }

    let moved = 0;
    for (const itemId of ids) {
      const item = await getItemById(itemId);
      if (item && typeof item.moveToTrash === "function") {
        await item.moveToTrash();
        moved += 1;
        continue;
      }
      throw new Error("This Eagle version does not expose a move-to-trash API.");
    }
    return { moved };
  }

  async function openItem(itemId) {
    const cleanItemId = String(itemId || "").trim().replace(/\.info$/i, "");
    if (!cleanItemId) throw new Error("Missing itemId.");
    if (!window.eagle || !eagle.item || typeof eagle.item.open !== "function") {
      throw new Error("This Eagle version does not expose item.open().");
    }
    await eagle.item.open(cleanItemId);
    return { itemId: cleanItemId };
  }

  async function getDiagnosticItem(itemId) {
    const fs = require("fs");
    const cleanItemId = String(itemId || "").trim().replace(/\.info$/i, "");
    const item = await getItemById(cleanItemId);
    let resolved = null;
    let resolveError = "";
    try {
      resolved = await resolveItemFilePath(cleanItemId);
    } catch (error) {
      resolveError = error && error.message ? error.message : String(error);
    }
    return {
      item: serializeItem(item),
      resolvedFile: resolved ? {
        path: resolved.filePath,
        exists: fs.existsSync(resolved.filePath),
        size: fs.existsSync(resolved.filePath) ? fs.statSync(resolved.filePath).size : 0
      } : null,
      resolveError
    };
  }

  function folderIdOf(folder) {
    if (folder && typeof folder === "object") return String(folder.id || folder.folderId || folder.folderID || "").trim();
    return String(folder || "").trim();
  }

  async function getFolderById(folderId) {
    if (!window.eagle || !eagle.folder) throw new Error("Eagle folder API is not available.");
    if (typeof eagle.folder.getById === "function") return await eagle.folder.getById(folderId);
    if (typeof eagle.folder.get === "function") return await eagle.folder.get(folderId);
    throw new Error("This Eagle version does not expose folder lookup API.");
  }

  async function deleteEmptyFolder(folderId) {
    const cleanFolderId = String(folderId || "").trim();
    if (!cleanFolderId) throw new Error("Missing folderId.");
    if (!window.eagle || !eagle.item || typeof eagle.item.getAll !== "function") {
      throw new Error("This Eagle version does not expose item.getAll().");
    }

    const folder = await getFolderById(cleanFolderId);
    if (!folder) return { deleted: false, reason: "not-found" };

    const allItems = await eagle.item.getAll();
    const isInUse = (Array.isArray(allItems) ? allItems : []).some(item => {
      const folders = Array.isArray(item && item.folders) ? item.folders : [];
      return folders.some(value => folderIdOf(value) === cleanFolderId);
    });
    if (isInUse) return { deleted: false, reason: "not-empty" };

    const removers = [];
    if (typeof eagle.folder.remove === "function") removers.push(() => eagle.folder.remove(cleanFolderId));
    if (typeof eagle.folder.delete === "function") removers.push(() => eagle.folder.delete(cleanFolderId));
    if (folder && typeof folder.remove === "function") removers.push(() => folder.remove());
    if (folder && typeof folder.delete === "function") removers.push(() => folder.delete());
    if (!removers.length) {
      throw new Error("This Eagle version does not expose a folder delete API.");
    }

    let lastError = null;
    for (const remove of removers) {
      try {
        await remove();
        const remaining = await getFolderById(cleanFolderId);
        if (!remaining) return { deleted: true };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Eagle did not remove the empty folder.");
  }

  function serializeItem(item) {
    return {
      id: String(item && item.id || ""),
      name: String(item && item.name || ""),
      ext: String(item && (item.ext || item.extension) || ""),
      extension: String(item && (item.extension || item.ext) || ""),
      width: Number(item && item.width) || 0,
      height: Number(item && item.height) || 0,
      url: String(item && item.url || ""),
      tags: Array.isArray(item && item.tags) ? item.tags.map(value => String(value || "")) : [],
      folders: Array.isArray(item && item.folders) ? item.folders.map(folderIdOf).filter(Boolean) : [],
      isDeleted: !!(item && item.isDeleted === true),
      size: Number(item && item.size) || 0,
      fileName: String(item && (item.fileName || item.filename) || ""),
      path: String(item && (item.path || item.filePath) || "")
    };
  }

  function hashFile(filePath, algorithm) {
    const fs = require("fs");
    const crypto = require("crypto");
    const normalizedAlgorithm = String(algorithm || "sha256").toLowerCase();
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(normalizedAlgorithm);
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async function getCachedFileHash(filePath, stat, algorithm) {
    const normalizedAlgorithm = String(algorithm || "sha256").toLowerCase();
    const cacheKey = `${normalizedAlgorithm}:${filePath}:${stat.size}:${Math.round(stat.mtimeMs || 0)}`;
    if (contentHashCache.has(cacheKey)) return contentHashCache.get(cacheKey);
    const digest = await hashFile(filePath, normalizedAlgorithm);
    contentHashCache.set(cacheKey, digest);
    return digest;
  }

  async function findItemsByContentHash(data) {
    const fs = require("fs");
    const expectedHash = String(data && data.hash || "").trim().toLowerCase();
    const expectedSize = Number(data && data.size) || 0;
    const algorithm = String(data && data.algorithm || "sha256").toLowerCase();
    if (!expectedHash) throw new Error("Missing content hash.");
    if (!window.eagle || !eagle.item || typeof eagle.item.getAll !== "function") {
      throw new Error("This Eagle version does not expose item.getAll().");
    }

    const rawItems = await eagle.item.getAll();
    const allItems = Array.isArray(rawItems) ? rawItems : [];
    const candidates = allItems.filter(item => {
      if (!item || item.isDeleted === true) return false;
      const itemSize = Number(item.size) || 0;
      return expectedSize > 0 && itemSize === expectedSize;
    });

    const matches = [];
    let scanned = 0;
    for (const item of candidates) {
      try {
        const filePaths = listItemFilesForContentHash(item);
        for (const filePath of filePaths) {
          const stat = fs.statSync(filePath);
          if (!stat.isFile() || (expectedSize && stat.size !== expectedSize)) continue;
          scanned += 1;
          const digest = await getCachedFileHash(filePath, stat, algorithm);
          if (digest.toLowerCase() === expectedHash) {
            matches.push(serializeItem(item));
            break;
          }
        }
      } catch (error) {
        console.warn("[OE Link Helper] Content-hash candidate skipped:", item && item.id, error);
      }
    }
    return { items: matches, candidates: candidates.length, scanned, algorithm };
  }

  async function listObsidianItems(folderIds, tagPrefixes, referencedItemIds) {
    if (!window.eagle || !eagle.item || typeof eagle.item.getAll !== "function") {
      throw new Error("This Eagle version does not expose item.getAll().");
    }
    const folders = new Set((Array.isArray(folderIds) ? folderIds : []).map(value => String(value || "").trim()).filter(Boolean));
    const prefixes = (Array.isArray(tagPrefixes) ? tagPrefixes : []).map(value => String(value || "").trim()).filter(Boolean);
    const requestedIds = new Set((Array.isArray(referencedItemIds) ? referencedItemIds : []).map(value => String(value || "").trim().replace(/\.info$/i, "")).filter(Boolean));
    const allItems = await eagle.item.getAll();
    // Keep the library listing bounded to one Eagle call. A stale reference can
    // leave getById() pending indefinitely and must not block every source view.
    const itemMap = new Map((Array.isArray(allItems) ? allItems : []).filter(Boolean).map(item => [String(item.id || ""), item]));
    const items = Array.from(itemMap.values()).filter(item => {
      const itemFolders = (Array.isArray(item && item.folders) ? item.folders : []).map(folderIdOf);
      const inManagedFolder = itemFolders.some(id => folders.has(id));
      const tags = Array.isArray(item && item.tags) ? item.tags.map(tag => String(tag || "")) : [];
      const hasObsidianTag = tags.some(tag => prefixes.some(prefix => tag.startsWith(prefix)));
      return requestedIds.has(String(item && item.id || "")) || inManagedFolder || hasObsidianTag;
    }).map(serializeItem);
    return { items };
  }

  async function handleRequest(req, res) {
    if (req.method === "OPTIONS") return sendJson(res, 200, { status: "success" });
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { status: "success", version: HELPER_VERSION, port: serverPort });
    }
    if (req.method === "GET" && req.url === "/library/current") {
      const libraryPath = window.eagle && eagle.library ? String(eagle.library.path || "").trim() : "";
      return sendJson(res, libraryPath ? 200 : 404, libraryPath
        ? { status: "success", data: { path: libraryPath } }
        : { status: "error", message: "Eagle did not return the current library path." });
    }
    if (req.method === "GET" && req.url === "/diagnostic/status") {
      const fs = require("fs");
      return sendJson(res, 200, {
        status: "success",
        data: {
          helperVersion: HELPER_VERSION,
          mediaHost: HOST,
          mediaPort: mediaConfig.port,
          mediaListening: !!(mediaServer && mediaServer.listening),
          libraryPaths: mediaConfig.libraryPaths.map(path => ({ path, exists: fs.existsSync(path) }))
        }
      });
    }
    if (req.method === "POST" && req.url === "/media/config") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await configureMediaService(data);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/add-folder") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await addItemToFolder(data.itemId, data.folderId);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/open") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await openItem(data.itemId);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/diagnostic/item") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await getDiagnosticItem(data.itemId);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/remove-folders") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await removeItemFromFolders(data.itemId, data.folderIds);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/folder/delete-if-empty") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await deleteEmptyFolder(data.folderId);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/move-to-trash") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await moveItemsToTrash(data.itemIds);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/list-obsidian") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await listObsidianItems(data.folderIds, data.tagPrefixes, data.referencedItemIds);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    if (req.method === "POST" && req.url === "/item/find-by-content-hash") {
      try {
        const data = JSON.parse(await readBody(req) || "{}");
        const result = await findItemsByContentHash(data);
        return sendJson(res, 200, { status: "success", data: result });
      } catch (error) {
        return sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
      }
    }
    sendJson(res, 404, { status: "error", message: "Not found." });
  }

  function startServer(portIndex = 0) {
    try {
      const http = require("http");
      if (server) return;
      if (portIndex >= PORTS.length) {
        console.error("[OE Link Helper] no available control port.");
        return;
      }
      const port = PORTS[portIndex];
      server = http.createServer((req, res) => {
        handleRequest(req, res).catch(error => {
          sendJson(res, 500, { status: "error", message: error && error.message ? error.message : String(error) });
        });
      });
      server.once("error", error => {
        server = null;
        if (error && error.code === "EADDRINUSE") {
          startServer(portIndex + 1);
          return;
        }
        console.error("[OE Link Helper] server error:", error);
      });
      server.listen(port, HOST, () => {
        serverPort = port;
        console.log(`[OE Link Helper] listening on http://${HOST}:${port}`);
        startMediaServer().catch(error => {
          console.error("[OE Link Helper] failed to start media service:", error);
        });
      });
    } catch (error) {
      console.error("[OE Link Helper] failed to start:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startServer, { once: true });
  } else {
    startServer();
  }
})();
