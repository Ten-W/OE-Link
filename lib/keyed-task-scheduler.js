class KeyedTaskScheduler {
  constructor(clock = globalThis.window || globalThis) {
    this.clock = clock;
    this.tasks = new Map();
  }

  cancel(key) {
    const timers = this.tasks.get(key);
    if (!timers) return;
    for (const timer of timers) this.clock.clearTimeout(timer);
    this.tasks.delete(key);
  }

  schedule(key, delay, callback) {
    this.cancel(key);
    const timers = new Set();
    const timer = this.clock.setTimeout(async () => {
      this.tasks.delete(key);
      await callback();
    }, delay);
    timers.add(timer);
    this.tasks.set(key, timers);
  }

  scheduleSequence(key, delays, callback) {
    this.cancel(key);
    const timers = new Set();
    for (const delay of delays) {
      timers.add(this.clock.setTimeout(() => callback(delay), delay));
    }
    const cleanupDelay = Math.max(0, ...delays) + 100;
    timers.add(this.clock.setTimeout(() => {
      if (this.tasks.get(key) === timers) this.tasks.delete(key);
    }, cleanupDelay));
    this.tasks.set(key, timers);
  }

  clear() {
    for (const key of Array.from(this.tasks.keys())) this.cancel(key);
  }
}

module.exports = { KeyedTaskScheduler };
