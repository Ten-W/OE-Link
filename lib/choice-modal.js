const { Modal } = require("obsidian");

function chooseInObsidianModal(app, title, message, options, cancelText) {
  return new Promise(resolve => {
    const modal = new ObsidianChoiceModal(app, title, message, options, cancelText, resolve);
    modal.open();
  });
}

class ObsidianChoiceModal extends Modal {
  constructor(app, title, message, options, cancelText, resolve) {
    super(app);
    this.title = title;
    this.message = message;
    this.options = Array.isArray(options) ? options : [];
    this.cancelText = cancelText;
    this.resolve = resolve;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("eaglebridge-confirm-modal");
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const buttons = contentEl.createDiv({ cls: "eaglebridge-confirm-actions" });
    for (const option of this.options) {
      const button = buttons.createEl("button", {
        text: option.label,
        cls: option.cta ? "mod-cta" : ""
      });
      button.addEventListener("click", () => this.finish(option.value));
    }
    const cancelButton = buttons.createEl("button", { text: this.cancelText });
    cancelButton.addEventListener("click", () => this.finish(null));
    const firstButton = buttons.querySelector("button");
    if (firstButton && typeof firstButton.focus === "function") firstButton.focus();
  }

  onClose() {
    if (!this.resolved) this.finish(null, false);
  }

  finish(value, shouldClose = true) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    if (shouldClose) this.close();
  }
}

module.exports = { chooseInObsidianModal };
