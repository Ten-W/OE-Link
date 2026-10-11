class EagleItemRepository {
  constructor(options) {
    this.request = options.request;
    this.getBaseUrl = options.getBaseUrl;
    this.normalizeId = options.normalizeId;
    this.cacheTtlMs = options.cacheTtlMs || 1200;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  invalidate(itemId) {
    const id = this.normalizeId(itemId);
    if (id) {
      this.cache.delete(id);
      this.inFlight.delete(id);
    }
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  async get(itemId, options = {}) {
    const id = this.normalizeId(itemId);
    if (!id) return null;
    const base = String(this.getBaseUrl() || "").replace(/\/+$/, "");
    if (this.baseUrl !== base) {
      this.clear();
      this.baseUrl = base;
    }

    const force = Boolean(options.force);
    const cached = this.cache.get(id);
    if (!force && cached && Date.now() - cached.updatedAt < this.cacheTtlMs) {
      return cached.item;
    }
    if (!force && this.inFlight.has(id)) return this.inFlight.get(id);

    const pending = this.fetch(id, base).then(item => {
      if (item && this.inFlight.get(id) === pending && this.baseUrl === base) {
        this.cache.set(id, { item, updatedAt: Date.now() });
      }
      return item;
    });
    this.inFlight.set(id, pending);
    const clearPending = () => {
      if (this.inFlight.get(id) === pending) this.inFlight.delete(id);
    };
    pending.then(clearPending, clearPending);
    return pending;
  }

  async fetch(id, base) {
    const body = await this.request({
      url: `${base}/api/item/info?id=${encodeURIComponent(id)}`,
      method: "GET"
    });
    return body && body.data ? body.data : null;
  }
}

module.exports = { EagleItemRepository };
