const assert = require("assert");
const fs = require("fs");
const { KeyedTaskScheduler } = require("./lib/keyed-task-scheduler");

const source = fs.readFileSync(require("path").join(__dirname, "main.source.js"), "utf8")
  + fs.readFileSync(require("path").join(__dirname, "lib", "eagle-assets-view.js"), "utf8");
const desktop = fs.readFileSync(require("path").join(__dirname, "desktop.js"), "utf8");

assert.doesNotMatch(source, /file\.path === this\.lastReferenceViewActiveFilePath\) return;/);
assert.match(source, /if \(file instanceof TFile && activePath !== file\.path\) return;/);
assert.match(source, /async onOpen\(\)[\s\S]{0,500}await this\.loadForCurrentNote\(false\);/);
assert.match(source, /this\.scheduleReferenceViewRefresh\(null, 0\);/);
assert.match(source, /const force = options\.force === true;/);
assert.match(desktop, /const force = options\.force === true;/);
assert.doesNotMatch(source, /skipReferenceViewRefresh/);
assert.doesNotMatch(source, /referenceViewRefreshTimer/);
assert.match(source, /if \(!this\.isCurrentLoad\(requestId\)\) return;/);
assert.match(source, /referenceViewRefreshScheduler\.schedule\("current-reference-view"/);
assert.match(source, /referenceViewRefreshScheduler && this\.referenceViewRefreshScheduler\.cancel\("current-reference-view"\)/);
assert.doesNotMatch(source, /if \(!this\.settings\.autoRefreshReferenceView\) return;/);
assert.doesNotMatch(source, /repairOpenedMarkdownTableLinks/);

class FakeClock {
  constructor() { this.nextId = 0; this.tasks = new Map(); }
  setTimeout(callback) { const id = ++this.nextId; this.tasks.set(id, callback); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  async runAll() {
    const tasks = Array.from(this.tasks.values());
    this.tasks.clear();
    for (const task of tasks) await task();
  }
}

(async () => {
  const clock = new FakeClock();
  const scheduler = new KeyedTaskScheduler(clock);
  const calls = [];
  scheduler.schedule("view", 250, async () => calls.push("old"));
  scheduler.schedule("view", 0, async () => calls.push("new"));
  await clock.runAll();
  assert.deepEqual(calls, ["new"]);
  scheduler.schedule("view", 0, async () => calls.push("cancelled"));
  scheduler.cancel("view");
  await clock.runAll();
  assert.deepEqual(calls, ["new"]);
  console.log("refresh scheduler checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
