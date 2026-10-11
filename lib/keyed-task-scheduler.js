class KeyedTaskScheduler {
  constructor(clock = globalThis.window || globalThis) {
    this.clock = clock;
    this.tasks = new Map();
    this.running = new Map();
    this.tokens = new Map();
  }

  cancel(key) {
    this.tokens.delete(key);
    const timers = this.tasks.get(key);
    if (!timers) return;
    for (const timer of timers) this.clock.clearTimeout(timer);
    this.tasks.delete(key);
  }

  schedule(key, delay, callback) {
    this.cancel(key);
    const timers = new Set();
    const timer = this.clock.setTimeout(async () => {
      const previous = this.running.get(key);
      if (previous) await previous.catch(() => {});
      if (this.tokens.get(key) !== timers) return;
      this.tasks.delete(key);
      const isCurrent = () => this.tokens.get(key) === timers;
      const pending = Promise.resolve().then(() => callback(isCurrent));
      this.running.set(key, pending);
      try {
        await pending;
      } finally {
        if (this.running.get(key) === pending) this.running.delete(key);
        if (isCurrent()) this.tokens.delete(key);
      }
    }, delay);
    timers.add(timer);
    this.tasks.set(key, timers);
    this.tokens.set(key, timers);
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
    this.tokens.clear();
  }
}

module.exports = { KeyedTaskScheduler };
