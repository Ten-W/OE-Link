const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "main.source.js"), "utf8");
const start = source.indexOf("  async scrollAssetIntoView(");
const end = source.indexOf("\n  async revealAssetInSource", start);
const scroll = Function(`return ({${source.slice(start, end)}}).scrollAssetIntoView`)();

async function scenario({ initial = 0, target = 3500, missing = false, cancel = false, reflow = false } = {}) {
  let now = 0, flashes = 0, changed = false;
  const positions = [], listeners = new Map();
  const win = {
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      now += 16;
      if (reflow && !changed && scroller.scrollTop > 1000) { target += 400; changed = true; }
      if (cancel && now > 150) listeners.get("wheel")?.();
      queueMicrotask(callback);
    }
  };
  const scroller = {
    scrollTop: initial, scrollHeight: 6000, clientHeight: 600, isConnected: true,
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => ({ top: 0, bottom: 600, height: 600 }),
    scrollTo({ top }) { this.scrollTop = top; positions.push(top); },
    addEventListener: (key, callback) => listeners.set(key, callback),
    removeEventListener: key => listeners.delete(key)
  };
  const element = { getBoundingClientRect: () => ({ top: target - scroller.scrollTop, bottom: target - scroller.scrollTop + 100, height: 100 }) };
  const view = { currentMode: { getScroll: () => scroller.scrollTop / 50 }, file: {}, getMode: () => "preview", containerEl: { querySelector: () => scroller } };
  const plugin = {
    sourceRevealGeneration: 1,
    getRenderedAssetCandidates: () => !missing && Math.abs(target - scroller.scrollTop) < 900 ? [element] : [],
    chooseNearestRenderedAsset: elements => elements[0],
    flashRenderedAsset: () => flashes++
  };
  const result = await scroll.call(plugin, view, {}, target / 50, 1);
  assert.equal(listeners.size, 0, "Temporary cancellation listeners must be removed");
  if (missing || cancel) { assert.equal(result, null); assert.equal(flashes, 0); }
  else {
    assert.equal(result, element);
    assert.ok(Math.abs(element.getBoundingClientRect().top + 50 - 300) < 2, "A settled offscreen image is not a successful reveal");
    assert.equal(flashes, 1);
    assert.ok(positions.length > 10, "Navigation must progress across multiple frames");
    assert.ok(positions.every((top, i) => Math.abs(top - (i ? positions[i - 1] : initial)) <= scroller.clientHeight), "Navigation must not skip across virtualized content");
    assert.ok(now < 1000, "Long-distance navigation should normally settle within one second");
  }
}

(async () => {
  await scenario({ reflow: true });
  await scenario({ initial: 5000, target: 700 });
  await scenario({ missing: true });
  await scenario({ cancel: true });
  console.log("Asset navigation behavior checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
