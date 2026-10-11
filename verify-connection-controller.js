const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const notices = [];
const events = [];
let mobile = false;
const storage = new Map();
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; this.children = []; this.loaded = false; }
  load() {
    if (this.loaded) return;
    this.loaded = true;
    const ready = [this.onload(), ...this.children.slice().map(child => child.load())].filter(Boolean);
    return Promise.all(ready);
  }
  unload() { if (!this.loaded) return; this.loaded = false; while (this.children.length) this.children.pop().unload(); this.onunload(); }
  addChild(child) { this.children.push(child); if (this.loaded) child.load(); return child; }
  removeChild(child) { this.children = this.children.filter(item => item !== child); child.unload(); }
}
const context = {
  module: { exports: {} }, console,
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  require: () => ({ Plugin, Notice: class { constructor(text) { notices.push(text); } }, Platform: { get isMobile() { return mobile; } } })
};
vm.runInNewContext(fs.readFileSync(require.resolve("./lib/connection-controller"), "utf8"), context);
let failCloud = false;
function makeMode(mode) {
  return class extends Plugin {
    async onload() { events.push(`start:${mode}`); if (mode === 'cloud' && failCloud) throw Error('test failure'); }
    onunload() { events.push(`stop:${mode}`); }
    async importFile(wait) { await wait; }
  };
}
const Controller = context.module.exports.createConnectionController(makeMode);
const app = { workspace: { getLeavesOfType: type => type === 'markdown' ? [{ view: { previewMode: { rerender: () => events.push('render') } } }] : [] }, setting: { openTabById: () => events.push('settings') } };
(async () => {
  const controller = new Controller(app, { id: 'oe-link' });
  await controller.load();
  let finish;
  const work = controller.runtime.importFile(new Promise(resolve => { finish = resolve; }));
  await controller.switchConnectionMode('cloud');
  assert.equal(controller.mode, 'local');
  assert.equal(notices.length, 1);
  finish(); await work;
  await controller.switchConnectionMode('cloud');
  assert.equal(controller.mode, 'cloud');
  assert.equal(controller.children.length, 1);
  assert.equal(storage.get('oe-link-connection-mode'), 'cloud');
  assert(events.indexOf('stop:local') < events.indexOf('start:cloud'));
  await controller.switchConnectionMode('local');
  failCloud = true;
  await controller.switchConnectionMode('cloud');
  assert.equal(controller.mode, 'local');
  assert.equal(controller.children.length, 1);
  assert.equal(storage.get('oe-link-connection-mode'), 'local');
  failCloud = false;
  const openSettings = app.setting.openTabById;
  app.setting.openTabById = () => { throw Error('test UI failure'); };
  await controller.switchConnectionMode('cloud');
  assert.equal(controller.mode, 'local');
  assert.equal(controller.children.length, 1);
  assert.equal(storage.get('oe-link-connection-mode'), 'local');
  app.setting.openTabById = openSettings;
  mobile = true;
  failCloud = false;
  const phone = new Controller(app, { id: 'oe-link' });
  await phone.load();
  await phone.switchConnectionMode('local');
  assert.equal(phone.mode, 'cloud');
  assert.doesNotMatch(fs.readFileSync(require.resolve('./main.js'), 'utf8'), /disablePlugin|enablePlugin/);
  console.log('Connection controller switch, busy guard, recovery and mobile checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
