const fs = require("fs");
const path = require("path");

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function parseOeLinkReferences(text) {
  const refs = [];
  const re = /https?:\/\/localhost:\d+\/images\/([^\s)"'<>]+)\.info/g;
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    refs.push({ id: decodeURIComponentSafe(match[1]), original: match[0], start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function safeFileName(name, fallback = "attachment") {
  const parsed = path.parse(path.basename(String(name || fallback)));
  let base = parsed.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim() || fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `_${base}`;
  const ext = parsed.ext.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
  return `${base}${ext}`;
}

function assignExportNames(entries) {
  const used = new Set();
  const renames = [];
  for (const entry of entries) {
    const requested = path.basename(String(entry.desiredName || "attachment"));
    const safe = safeFileName(requested);
    let candidate = safe;
    let number = 2;
    const parsed = path.parse(safe);
    const suffix = safeFileName(String(entry.suffix || "").replace(/^[-_. ]+/, ""), "").replace(/\.[^.]*$/, "");
    if (used.has(candidate.toLowerCase()) && suffix) candidate = `${parsed.name}-${suffix}${parsed.ext}`;
    while (used.has(candidate.toLowerCase())) candidate = `${parsed.name}-${number++}${parsed.ext}`;
    used.add(candidate.toLowerCase());
    entry.exportName = candidate;
    if (candidate !== requested) renames.push({ source: requested, exported: candidate });
  }
  return renames;
}

function rewriteReference(original, newTarget) {
  const source = String(original || "");
  const rawTarget = String(newTarget || "").replace(/\\/g, "/");
  if (/^https?:\/\//i.test(source)) return encodeURI(rawTarget).replace(/#/g, "%23").replace(/\?/g, "%3F");
  if (/^!?\[\[/.test(source)) {
    const prefixLength = source.startsWith("![[") ? 3 : 2;
    const end = source.lastIndexOf("]]");
    const body = source.slice(prefixLength, end);
    const pipe = body.indexOf("|");
    return `${source.slice(0, prefixLength)}${rawTarget}${pipe >= 0 ? body.slice(pipe) : ""}]]`;
  }
  const encoded = encodeURI(rawTarget).replace(/#/g, "%23").replace(/\?/g, "%3F");
  if (/^<[^>]+>$/s.test(source)) {
    return source.replace(/(\s(?:src|href|data)=["'])[^"']+(["'])/i, `$1${encoded}$2`);
  }
  const opener = source.indexOf("](");
  if (opener >= 0 && source.endsWith(")")) return `${source.slice(0, opener + 2)}${encoded})`;
  return encoded;
}

function applyReplacements(text, replacements) {
  let result = String(text || "");
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, item.start) + item.replacement + result.slice(item.end);
  }
  return result;
}

async function copyPackageFiles(root, noteName, noteText, entries) {
  const attachmentDir = path.join(root, "attachments");
  await fs.promises.mkdir(attachmentDir, { recursive: true });
  await fs.promises.writeFile(path.join(root, safeFileName(noteName, "note.md")), noteText, "utf8");
  for (const entry of entries) await fs.promises.copyFile(entry.sourcePath, path.join(attachmentDir, entry.exportName));
}

async function listFiles(root, relative = "") {
  const output = [];
  for (const dirent of await fs.promises.readdir(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, dirent.name);
    if (dirent.isDirectory()) output.push(...await listFiles(root, next));
    else if (dirent.isFile()) output.push({ filePath: path.join(root, next), archivePath: next.replace(/\\/g, "/") });
  }
  return output;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function buffer(size, writes) {
  const value = Buffer.alloc(size);
  for (const [method, offset, number] of writes) value[method](number >>> 0, offset);
  return value;
}

async function writeStoredZip(outputPath, files) {
  const output = await fs.promises.open(outputPath, "w");
  const central = [];
  let offset = 0;
  const write = async value => { await output.write(value); offset += value.length; };
  try {
    for (const file of files) {
      const stat = await fs.promises.stat(file.filePath);
      if (stat.size > 0xffffffff || offset > 0xffffffff) throw new Error("ZIP32 does not support packages over 4 GiB.");
      const name = Buffer.from(file.archivePath, "utf8");
      const stamp = dosDateTime(stat.mtime);
      const localOffset = offset;
      await write(Buffer.concat([
        buffer(30, [["writeUInt32LE", 0, 0x04034b50], ["writeUInt16LE", 4, 20], ["writeUInt16LE", 6, 0x0808], ["writeUInt16LE", 8, 0], ["writeUInt16LE", 10, stamp.time], ["writeUInt16LE", 12, stamp.date], ["writeUInt16LE", 26, name.length]]),
        name
      ]));
      let crc = 0xffffffff;
      let size = 0;
      for await (const chunk of fs.createReadStream(file.filePath)) {
        for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        size += chunk.length;
        await write(chunk);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      await write(buffer(16, [["writeUInt32LE", 0, 0x08074b50], ["writeUInt32LE", 4, crc], ["writeUInt32LE", 8, size], ["writeUInt32LE", 12, size]]));
      central.push({ name, stamp, crc, size, localOffset });
    }
    const centralOffset = offset;
    for (const entry of central) {
      await write(Buffer.concat([
        buffer(46, [["writeUInt32LE", 0, 0x02014b50], ["writeUInt16LE", 4, 20], ["writeUInt16LE", 6, 20], ["writeUInt16LE", 8, 0x0808], ["writeUInt16LE", 10, 0], ["writeUInt16LE", 12, entry.stamp.time], ["writeUInt16LE", 14, entry.stamp.date], ["writeUInt32LE", 16, entry.crc], ["writeUInt32LE", 20, entry.size], ["writeUInt32LE", 24, entry.size], ["writeUInt16LE", 28, entry.name.length], ["writeUInt32LE", 42, entry.localOffset]]),
        entry.name
      ]));
    }
    const centralSize = offset - centralOffset;
    // ponytail: ZIP32 keeps this dependency-free; add ZIP64 only if exports over 4 GiB become a real use case.
    if (central.length > 0xffff || centralSize > 0xffffffff) throw new Error("ZIP32 package is too large.");
    await write(buffer(22, [["writeUInt32LE", 0, 0x06054b50], ["writeUInt16LE", 8, central.length], ["writeUInt16LE", 10, central.length], ["writeUInt32LE", 12, centralSize], ["writeUInt32LE", 16, centralOffset]]));
  } finally {
    await output.close();
  }
}

function uniqueDestination(parent, baseName, extension = "") {
  let candidate = path.join(parent, `${baseName}${extension}`);
  let number = 2;
  while (fs.existsSync(candidate)) candidate = path.join(parent, `${baseName}-${number++}${extension}`);
  return candidate;
}

module.exports = { parseOeLinkReferences, safeFileName, assignExportNames, rewriteReference, applyReplacements, copyPackageFiles, listFiles, writeStoredZip, uniqueDestination };
