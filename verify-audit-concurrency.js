const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Module = require("node:module");
const { KeyedTaskScheduler } = require("./lib/keyed-task-scheduler");
const { EagleItemRepository } = require("./lib/eagle-item-repository");
const { parseOeLinkReferences } = require("./lib/oe-link-references");
class TFile {}
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  return request === "obsidian" ? { TFile } : originalLoad.call(this, request, parent, isMain);
};
const utils = require("./lib/asset-utils");
const { mergeAttachmentReplacements } = require("./lib/attachment-import");
Module._load = originalLoad;
const source = fs.readFileSync(require.resolve("./main.source.js"), "utf8");
const dependencies = { ...utils, parseOeLinkReferences, TFile, mergeAttachmentReplacements, Notice: class {}, console: { warn() {} } };
function method(name) {
  const start = source.indexOf(`  async ${name}(`) >= 0 ? source.indexOf(`  async ${name}(`) : source.indexOf(`  ${name}(`);
  const end = source.indexOf("\n  }", start) + 4;
  assert.ok(start >= 0 && end > start, name);
  return Function(...Object.keys(dependencies), `return ({${source.slice(start, end)}}).${name}`)(...Object.values(dependencies));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function markdownScenario(initial, edit, { normalizeEdit = false, cancel = false } = {}) {
  const file = Object.assign(new TFile(), { path: "image.png", name: "image.png" });
  const context = { file: { path: "test.md" } };
  let latest = initial, trashed = [], imports = 0;
  const plugin = {
    settings: {},
    t: key => key,
    app: {
      vault: {
        read: async () => latest,
        process: async (_file, callback) => { latest = callback(latest); },
        modify: async () => assert.fail("A stale whole-note write is forbidden")
      },
      metadataCache: { getFirstLinkpathDest: target => target === "image.png" ? file : null }
    },
    collectMarkdownAttachmentLinks: method("collectMarkdownAttachmentLinks"),
    findLocalAttachmentLinks: method("findLocalAttachmentLinks"),
    findExternalLocalAttachmentLinks: method("findExternalLocalAttachmentLinks"),
    findInternetAttachmentLinks: method("findInternetAttachmentLinks"),
    isEagleBridgeAssetUrl: url => /\/images\/.*\.info/.test(url),
    importOneAttachment: async () => {
      imports++;
      latest = edit(latest);
      return { sourceFile: file, item: { id: "TEST" }, replacement: "![image.png](http://localhost:6060/images/TEST.info)" };
    },
    ensureImportedEagleItemTags: async (_context, item) => item,
    ensureContextEagleFolder: async (_context, item) => item,
    trashImportedFiles: async items => { trashed = items; },
    normalizeEagleBridgeReferenceLabels: async (_context, text) => {
      if (normalizeEdit) { latest += "\nEDIT DURING METADATA LOOKUP"; return text.replace("image.png]", "renamed.png]"); }
      return text;
    }
  };
  const links = plugin.findLocalAttachmentLinks(initial, context.file);
  plugin.importOneInternetAttachment = plugin.importOneAttachment;
  const internetLinks = plugin.findInternetAttachmentLinks(initial);
  const result = await method("importAttachmentLinks").call(plugin, context, links, internetLinks, {
    sourceText: initial, silent: true, shouldContinue: () => !cancel || imports === 0
  });
  return { latest, result, trashed };
}

async function checkMarkdown() {
  const original = "Before\n![[image.png]]\nAfter";
  const edited = await markdownScenario(original, text => `NEW INTRO\n${text}\nNEW END`);
  assert.equal(edited.result.success, 1);
  assert.match(edited.latest, /^NEW INTRO/);
  assert.match(edited.latest, /NEW END$/);
  assert.match(edited.latest, /TEST\.info/);
  const moved = await markdownScenario(original, () => "| image |\n| --- |\n| ![[image.png|120]] |" );
  assert.equal(moved.result.success, 0, "Changed reference syntax must be retained rather than overwritten");
  assert.match(moved.latest, /image\.png\|120/);
  const table = await markdownScenario("![[image.png|120]]", text => `| image |\n| --- |\n| ${text} |`);
  assert.equal(table.result.success, 1);
  assert.match(table.latest, /image\.png\\\|120/);
  const removed = await markdownScenario(original, text => text.replace("![[image.png]]", "USER REPLACEMENT"));
  assert.equal(removed.result.success, 0);
  assert.equal(removed.result.failed, 1);
  assert.equal(removed.trashed.length, 0);
  assert.match(removed.latest, /USER REPLACEMENT/);
  const duplicate = await markdownScenario(original, text => text + "\n![[image.png]]");
  assert.equal(duplicate.result.success, 0);
  assert.equal(duplicate.trashed.length, 0);
  const metadata = await markdownScenario(original, text => text, { normalizeEdit: true });
  assert.match(metadata.latest, /EDIT DURING METADATA LOOKUP$/);
  const cancelled = await markdownScenario(original, text => text + "\nUSER EDIT", { cancel: true });
  assert.match(cancelled.latest, /TEST\.info/, "Refresh cancellation must still commit an already verified import");
  assert.match(cancelled.latest, /USER EDIT/);
  assert.equal(cancelled.trashed.length, 0);
  const internet = await markdownScenario("![web](https://example.test/photo.jpg)", text => `INTRO\n${text}\nOUTRO`);
  assert.equal(internet.result.success, 1);
  assert.match(internet.latest, /^INTRO\n/);
  assert.match(internet.latest, /OUTRO$/);
  assert.match(internet.latest, /TEST\.info/);
}

async function checkCleanup() {
  const file = Object.assign(new TFile(), { path: "shared.png", name: "shared.png" });
  let scans = 0, deletes = 0;
  const plugin = {
    settings: { trashAfterImport: true },
    isVerifiedLocalCopyOfEagleItem: async () => true,
    getVaultReferencedLocalAttachmentPaths: async () => { scans++; return new Set([file.path]); },
    trashLocalFile: async () => deletes++, t: key => key
  };
  const cleanup = method("trashImportedFiles");
  await cleanup.call(plugin, [{ sourceFile: file, item: { id: "TEST" } }]);
  assert.equal(scans, 1);
  assert.equal(deletes, 0, "An attachment used by another note/Canvas must be retained");
  plugin.getVaultReferencedLocalAttachmentPaths = async () => { throw new Error("unreadable Canvas"); };
  await cleanup.call(plugin, [{ sourceFile: file, item: {} }]);
  assert.equal(deletes, 0);
  plugin.getVaultReferencedLocalAttachmentPaths = async () => new Set();
  plugin.isVerifiedLocalCopyOfEagleItem = async () => false;
  await cleanup.call(plugin, [{ sourceFile: file, item: {} }]);
  assert.equal(deletes, 0, "Changed local content must not be discarded");
  plugin.isVerifiedLocalCopyOfEagleItem = async () => true;
  await cleanup.call(plugin, [{ sourceFile: file, item: {} }, { sourceFile: file, item: {} }]);
  assert.equal(deletes, 1);
  const scan = method("getVaultReferencedLocalAttachmentPaths");
  await assert.rejects(scan.call({ app: { vault: { read: async () => "invalid" } } }, [{ extension: "canvas" }]), SyntaxError);
  const scanPlugin = {
    app: {
      vault: { read: async () => JSON.stringify({ nodes: [{ type: "text", text: "![[shared.png]]" }] }) },
      workspace: { getLeavesOfType: () => [{ view: { file: { path: "note.md" }, editor: { getValue: () => "![[shared.png]]" } } }] }
    },
    findCanvasAttachmentLinks: () => [],
    findLocalAttachmentLinks: text => text.includes("shared.png") ? [{ file }] : []
  };
  assert.ok((await scan.call(scanPlugin, [{ path: "test.canvas", extension: "canvas" }])).has(file.path));
  scanPlugin.app.vault.read = async () => "Saved text without an attachment";
  assert.ok((await scan.call(scanPlugin, [{ path: "note.md", extension: "md" }])).has(file.path));
}

async function checkLibraryImport() {
  const attachment = Object.assign(new TFile(), { path: "image.png", name: "image.png" });
  const notes = ["first.md", "second.md", "board.canvas"].map(path => Object.assign(new TFile(), {
    path, extension: path.endsWith("canvas") ? "canvas" : "md"
  }));
  const texts = new Map(notes.map(note => [note.path, note.extension === "canvas"
    ? JSON.stringify({ nodes: [{ id: "n", type: "file", file: attachment.path }] }) : "![[image.png]]"]));
  let imports = 0, cleanups = 0;
  const reusedFolders = [];
  const plugin = Object.fromEntries(["importAttachmentItemFromLibraryReferences", "importLocalAttachmentItemFromPanel",
    "importAttachmentLinks", "collectMarkdownAttachmentLinks", "findLocalAttachmentLinks", "findExternalLocalAttachmentLinks",
    "findInternetAttachmentLinks"].map(name => [name, method(name)]));
  Object.assign(plugin, {
    app: {
      vault: {
        getAbstractFileByPath: path => notes.find(note => note.path === path),
        read: async file => texts.get(file.path),
        process: async (file, callback) => texts.set(file.path, callback(texts.get(file.path)))
      },
      metadataCache: { getFirstLinkpathDest: target => target === attachment.path ? attachment : null }
    },
    settings: {},
    getAssetContext: async file => ({ file, kind: file.extension === "canvas" ? "canvas" : "markdown" }),
    runWithReferenceViewRefreshPaused: callback => callback(),
    isEagleBridgeAssetUrl: url => url.includes("/images/"),
    importOneAttachment: async () => {
      imports++;
      return { sourceFile: attachment, item: { id: "TEST" }, replacement: "![image](http://localhost:6060/images/TEST.info)" };
    },
    ensureImportedEagleItemTags: async (_context, item) => item,
    ensureContextEagleFolder: async (context, item) => { reusedFolders.push(context.file.path); return item; },
    normalizeEagleBridgeReferenceLabels: async (_context, text) => text,
    importCanvasAttachments: async (context, _target, options) => {
      assert.equal(options.trashImported, false);
      assert.ok(texts.get("first.md").includes("TEST.info"));
      assert.ok(texts.get("second.md").includes("TEST.info"));
      texts.set(context.file.path, "converted Canvas");
      return { success: 1, failed: 0, reused: 1 };
    },
    trashImportedFiles: async () => {
      cleanups++;
      assert.ok(texts.get("first.md").includes("TEST.info"));
      assert.ok(texts.get("second.md").includes("TEST.info"));
      assert.equal(texts.get("board.canvas"), "converted Canvas", "Cleanup must wait for every source");
    }
  });
  const result = await plugin.importAttachmentItemFromLibraryReferences({ __localFile: attachment }, notes, { silent: true },
    (path, item, options) => plugin.importLocalAttachmentItemFromPanel(path, item, options));
  assert.equal(result.success, 3);
  assert.equal(imports, 1);
  assert.deepEqual(reusedFolders, ["second.md"], "A reused attachment must also join the second note's managed folder");
  assert.equal(cleanups, 1);
}

async function checkScheduler() {
  const tasks = new Map();
  let next = 0;
  const scheduler = new KeyedTaskScheduler({
    setTimeout: callback => { tasks.set(++next, callback); return next; },
    clearTimeout: id => tasks.delete(id)
  });
  const start = () => { const [id, callback] = tasks.entries().next().value; tasks.delete(id); return callback(); };
  const gate = deferred();
  let active = 0, maxActive = 0, secondRan = false, oldCurrent;
  scheduler.schedule("same", 0, async isCurrent => {
    active++; maxActive = Math.max(maxActive, active);
    await gate.promise;
    oldCurrent = isCurrent();
    active--;
  });
  const first = start();
  await Promise.resolve();
  scheduler.schedule("same", 0, async () => { secondRan = true; maxActive = Math.max(maxActive, ++active); active--; });
  const second = start();
  await Promise.resolve();
  assert.equal(secondRan, false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
  assert.equal(oldCurrent, false);
  assert.equal(secondRan, true);
  const gate2 = deferred();
  scheduler.schedule("same", 0, () => gate2.promise);
  const running = start();
  await Promise.resolve();
  scheduler.schedule("same", 0, () => assert.fail("Cleared queued work must not execute"));
  const waiting = start();
  scheduler.clear();
  gate2.resolve();
  await Promise.all([running, waiting]);
  scheduler.schedule("error", 0, async () => { throw new Error("expected"); });
  await assert.rejects(start(), /expected/);
  scheduler.schedule("error", 0, async () => {});
  await start();
}

async function checkRepository() {
  const requests = [];
  let base = "http://localhost:41595";
  const repository = new EagleItemRepository({
    getBaseUrl: () => base, normalizeId: id => id,
    request: () => { const task = deferred(); requests.push(task); return task.promise; }
  });
  const old = repository.get("TEST");
  const fresh = repository.get("TEST", { force: true });
  requests[1].resolve({ data: { id: "TEST", folders: ["NEW"] } });
  await fresh;
  requests[0].resolve({ data: { id: "TEST", folders: ["OLD"] } });
  await old;
  assert.deepEqual((await repository.get("TEST")).folders, ["NEW"]);
  const stale = repository.get("TEST", { force: true });
  repository.invalidate("TEST");
  requests[2].resolve({ data: { id: "TEST", folders: ["STALE"] } });
  await stale;
  assert.equal(repository.cache.has("TEST"), false);
  const previous = repository.get("TEST");
  base = "http://127.0.0.1:41595";
  const current = repository.get("TEST");
  requests[4].resolve({ data: { id: "TEST", folders: ["CURRENT"] } });
  await current;
  requests[3].resolve({ data: { id: "TEST", folders: ["PREVIOUS"] } });
  await previous;
  assert.deepEqual((await repository.get("TEST")).folders, ["CURRENT"]);
}

async function checkCloudCache() {
  const revoked = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("./mobile.js"), "utf8"), {
    module, URL: { revokeObjectURL: url => revoked.push(url) },
    require: name => {
      if (name === "obsidian") return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {} };
      if (name === "@codemirror/view") return { WidgetType: class {} };
      if (name === "@codemirror/state") return {};
      throw new Error(name);
    }
  });
  const plugin = new module.exports();
  Object.assign(plugin, { mobile: { sourceType: "webdav", webdavLibraryPath: "A" }, cache: new Map(), pending: new Map(), cacheGeneration: 0 });
  plugin.fetchImage = async () => ({ url: plugin.mobile.webdavLibraryPath });
  assert.equal((await plugin.getImage("TEST", false)).url, "A");
  plugin.mobile.webdavLibraryPath = "B";
  assert.equal((await plugin.getImage("TEST", false)).url, "B");
  assert.deepEqual(revoked, ["A"]);
  const tasks = [];
  plugin.fetchImage = () => { const task = deferred(); tasks.push(task); return task.promise; };
  const old = plugin.getImage("OTHER", false);
  const rejectedOld = assert.rejects(old, /changed/);
  const fresh = plugin.getImage("OTHER", false, true);
  tasks[0].resolve({ url: "OLD" });
  await rejectedOld;
  assert.equal(plugin.pending.size, 1, "An older completion must not remove a newer pending request");
  tasks[1].resolve({ url: "NEW" });
  await fresh;
  assert.equal((await plugin.getImage("OTHER", false)).url, "NEW");
  const unload = plugin.getImage("UNLOAD", false);
  const rejectedUnload = assert.rejects(unload, /changed/);
  plugin.unloaded = true;
  plugin.clearCache();
  tasks[2].resolve({ url: "AFTER UNLOAD" });
  await rejectedUnload;
  assert.equal(plugin.cache.size, 0);
  assert.ok(revoked.includes("AFTER UNLOAD"));
}

(async () => {
  const ipUrl = "http://127.0.0.1:6060/images/ABC.info";
  assert.equal(parseOeLinkReferences(`![image](${ipUrl})`)[0].id, "ABC");
  assert.equal(utils.extractEagleBridgeItemIdFromText(ipUrl), "ABC");
  const customUrl = "https://media.example.test/images/CUSTOM.info";
  assert.equal(parseOeLinkReferences(customUrl).length, 0);
  assert.equal(parseOeLinkReferences(ipUrl + "x").length, 0);
  assert.equal(parseOeLinkReferences(customUrl, url => url.startsWith("https://media.example.test/"))[0].id, "CUSTOM");
  const parser = { isEagleBridgeAssetUrl: url => url === ipUrl || url === customUrl };
  assert.deepEqual(method("extractEagleBridgeItemReferences").call(parser, `![a](${ipUrl}) ![b](${customUrl})`).map(ref => ref.id), ["ABC", "CUSTOM"]);
  await checkMarkdown();
  await checkCleanup();
  await checkLibraryImport();
  await checkScheduler();
  await checkRepository();
  await checkCloudCache();
  console.log("Audit concurrency, shared-attachment safety and cache lifecycle checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
