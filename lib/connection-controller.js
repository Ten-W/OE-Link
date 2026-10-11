const { Plugin, Notice, Platform } = require("obsidian");

function createConnectionController(loadMode) {
  return class OEConnectionController extends Plugin {
    async onload() {
      this.stopped = false;
      this.switching = true;
      this.mode = Platform.isMobile || globalThis.localStorage?.getItem("oe-link-connection-mode") === "cloud" ? "cloud" : "local";
      try { await this.startMode(this.mode); }
      finally { this.switching = false; }
    }

    async startMode(mode) {
      const Runtime = loadMode(mode);
      const runtime = new Runtime(this.app, this.manifest);
      runtime.switchConnectionMode = next => this.switchConnectionMode(next);
      runtime.activeOperations = 0;
      // Track in-flight work so a mode change cannot interrupt an import or write.
      for (const name of Object.getOwnPropertyNames(Runtime.prototype)) {
        const method = Object.getOwnPropertyDescriptor(Runtime.prototype, name).value;
        if (name === "onload" || name === "switchConnectionMode" || method?.constructor?.name !== "AsyncFunction") continue;
        runtime[name] = async (...args) => {
          runtime.activeOperations += 1;
          try { return await method.apply(runtime, args); }
          finally { runtime.activeOperations -= 1; }
        };
      }
      runtime.onload = () => { runtime.ready = Runtime.prototype.onload.call(runtime); };
      this.runtime = runtime;
      this.addChild(runtime);
      try { await runtime.ready; }
      catch (error) { this.removeChild(runtime); this.runtime = null; throw error; }
      if (this.stopped) throw new Error("OE Link was unloaded during mode initialization.");
    }

    async switchConnectionMode(next) {
      if (this.stopped || this.switching || next === this.mode) return;
      if (!["local", "cloud"].includes(next) || (Platform.isMobile && next !== "cloud")) return;
      if (this.runtime?.activeOperations) {
        new Notice("OE Link 正在处理任务，请完成后再切换连接模式。");
        return;
      }
      this.switching = true;
      const previous = this.mode;
      if (previous === "local") this.restoreSidebar = this.app.workspace.getLeavesOfType("eaglebridge-note-assets-view").length > 0;
      try {
        this.removeChild(this.runtime);
        this.runtime = null;
        await this.startMode(next);
        globalThis.localStorage?.setItem("oe-link-connection-mode", next);
        this.mode = next;
        this.refreshRenderedNotes();
        if (next === "local" && this.restoreSidebar) await this.runtime.openReferenceView();
        this.app.setting?.openTabById(this.manifest.id);
      } catch (error) {
        if (!this.stopped) {
          try {
            if (this.runtime) this.removeChild(this.runtime);
            this.runtime = null;
            await this.startMode(previous);
            this.mode = previous;
            globalThis.localStorage?.setItem("oe-link-connection-mode", previous);
            this.refreshRenderedNotes();
            if (previous === "local" && this.restoreSidebar) await this.runtime.openReferenceView();
          }
          catch (restoreError) { console.error("OE Link mode recovery failed", restoreError); }
          new Notice(`连接模式切换失败：${error.message}`);
        }
      } finally { this.switching = false; }
    }

    refreshRenderedNotes() {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        leaf.view.previewMode?.rerender(true);
      }
    }

    onunload() { this.stopped = true; }
  };
}

module.exports = { createConnectionController };
