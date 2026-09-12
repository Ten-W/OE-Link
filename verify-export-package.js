const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseOeLinkReferences, safeFileName, assignExportNames, rewriteReference, applyReplacements,
  copyPackageFiles, listFiles, writeStoredZip
} = require("./lib/export-package");

(async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "oe-link-export-check-"));
  try {
    const first = path.join(root, "one", "same.jpg");
    const second = path.join(root, "two", "same.jpg");
    const audio = path.join(root, "audio.mp3");
    await fs.promises.mkdir(path.dirname(first), { recursive: true });
    await fs.promises.mkdir(path.dirname(second), { recursive: true });
    await fs.promises.writeFile(first, Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]));
    await fs.promises.writeFile(second, Buffer.from([0xff, 0xd8, 4, 5, 6, 0xff, 0xd9]));
    await fs.promises.writeFile(audio, Buffer.from("ID3\u0004\u0000\u0000test", "binary"));

    const oeText = "![one](http://localhost:6060/images/abc.info) and [again](http://localhost:6060/images/abc.info)";
    const oeRefs = parseOeLinkReferences(oeText);
    assert.equal(oeRefs.length, 2);
    assert.equal(applyReplacements(oeText, oeRefs.map(ref => ({ ...ref, replacement: "attachments/same.jpg" }))), "![one](attachments/same.jpg) and [again](attachments/same.jpg)");
    assert.equal(rewriteReference("![[old image.jpg|320]]", "attachments/new image.jpg"), "![[attachments/new image.jpg|320]]");
    assert.equal(rewriteReference("![x](old image.jpg)", "attachments/new image.jpg"), "![x](attachments/new%20image.jpg)");
    assert.equal(safeFileName("CON.txt"), "_CON.txt");

    const entries = [
      { sourcePath: first, desiredName: "same.jpg", suffix: "" },
      { sourcePath: second, desiredName: "same.jpg", suffix: "eagle123" },
      { sourcePath: audio, desiredName: "audio.mp3", suffix: "" }
    ];
    const renames = assignExportNames(entries);
    assert.deepEqual(entries.map(entry => entry.exportName), ["same.jpg", "same-eagle123.jpg", "audio.mp3"]);
    assert.deepEqual(renames, [{ source: "same.jpg", exported: "same-eagle123.jpg" }]);

    const packageRoot = path.join(root, "Share note");
    await copyPackageFiles(packageRoot, "Share note.md", "![[attachments/same.jpg]]", entries);
    const files = await listFiles(packageRoot);
    assert.equal(files.length, 4);
    const zipPath = path.join(root, "share.zip");
    await writeStoredZip(zipPath, files.map(file => ({ ...file, archivePath: `Share note/${file.archivePath}` })));
    const zip = await fs.promises.readFile(zipPath);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert(zip.includes(Buffer.from("Share note/attachments/audio.mp3")));
    assert.deepEqual(await fs.promises.readFile(path.join(packageRoot, "attachments", "audio.mp3")), await fs.promises.readFile(audio));
    console.log("export package checks passed");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
