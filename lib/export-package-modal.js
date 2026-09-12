const { Modal } = require("obsidian");

function chooseExportFormat(app, plan, text, preferredFormat = "") {
  if (preferredFormat && !plan.missing.length && !plan.renames.length) return Promise.resolve(preferredFormat);
  return new Promise(resolve => new ExportPackageModal(app, plan, text, resolve, preferredFormat).open());
}

class ExportPackageModal extends Modal {
  constructor(app, plan, text, resolve, preferredFormat) {
    super(app);
    this.plan = plan;
    this.text = text;
    this.resolve = resolve;
    this.preferredFormat = preferredFormat;
    this.done = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("oe-link-export-modal");
    contentEl.createEl("h3", { text: this.text.title });
    contentEl.createEl("p", { text: this.text.summary.replace("{files}", this.plan.entries.length).replace("{links}", this.plan.referenceCount) });
    this.addIssues(this.text.missingTitle, this.plan.missing.map(item => `${item.label}: ${item.reason}`), "is-error");
    this.addIssues(this.text.renameTitle, this.plan.renames.map(item => `${item.source} -> ${item.exported}`));
    const actions = contentEl.createDiv({ cls: "eaglebridge-confirm-actions" });
    const prefix = this.plan.missing.length ? this.text.ignorePrefix : "";
    if (this.preferredFormat) {
      this.addButton(actions, `${prefix}${this.text[this.preferredFormat]}`, this.preferredFormat, true);
    } else {
      this.addButton(actions, `${prefix}${this.text.folder}`, "folder", true);
      this.addButton(actions, `${prefix}${this.text.zip}`, "zip", false);
    }
    this.addButton(actions, this.text.cancel, null, false);
  }

  addIssues(title, items, className = "") {
    if (!items.length) return;
    const section = this.contentEl.createDiv({ cls: `oe-link-export-issues ${className}` });
    section.createEl("h4", { text: `${title} (${items.length})` });
    const list = section.createEl("ul");
    for (const item of items) list.createEl("li", { text: item });
  }

  addButton(parent, label, value, cta) {
    const button = parent.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
    button.addEventListener("click", () => this.finish(value));
  }

  onClose() { if (!this.done) this.finish(null, false); }

  finish(value, close = true) {
    if (this.done) return;
    this.done = true;
    this.resolve(value);
    if (close) this.close();
  }
}

module.exports = { chooseExportFormat };
