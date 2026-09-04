const { Modal } = require("obsidian");

class EagleBridgeProgressModal extends Modal {
  constructor(app, title, description) {
    super(app);
    this.title = title;
    this.description = description;
    this.completed = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("eaglebridge-progress-modal");
    contentEl.createEl("h2", { text: this.title });
    this.descriptionEl = contentEl.createEl("p", {
      cls: "eaglebridge-progress-description",
      text: this.description
    });
    this.progressEl = contentEl.createEl("progress", {
      cls: "eaglebridge-progress-bar"
    });
    this.progressEl.max = 1;
    this.progressEl.value = 0;
    this.statusEl = contentEl.createEl("p", {
      cls: "eaglebridge-progress-status",
      text: "准备开始..."
    });
  }

  update({ phase = "", completed = 0, total = 0, detail = "" } = {}) {
    if (!this.statusEl || !this.progressEl) return;
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
    this.progressEl.max = safeTotal;
    this.progressEl.value = safeCompleted;
    const progressText = total ? `${safeCompleted} / ${safeTotal}` : "";
    this.statusEl.setText([phase, progressText, detail].filter(Boolean).join("  "));
  }

  finish(message, failed = false) {
    if (!this.statusEl || !this.progressEl) return;
    this.completed = true;
    this.progressEl.value = this.progressEl.max;
    this.statusEl.setText(message);
    this.statusEl.toggleClass("is-error", failed);
    this.contentEl.createEl("button", {
      cls: "mod-cta eaglebridge-progress-close",
      text: "关闭"
    }).addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = { EagleBridgeProgressModal };
