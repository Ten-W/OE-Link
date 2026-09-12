const { ItemView, Menu, Notice, setTooltip, TFile } = require("obsidian");
const nodeFs = require("fs");
const { KeyedTaskScheduler } = require("./keyed-task-scheduler");
const { chooseInObsidianModal } = require("./choice-modal");
const {
  getAssetSummary, normalizeAssetViewMode, clampNumber, buildEagleFolderUrl, findEagleFolderById,
  isSupportedSourceFile, isPreviewableImage, createFilePlaceholder, createNotePlaceholder,
  getAssetDisplayName, getEagleItemMatchSignature, getAssetExtension, normalizeExtension,
  cleanExternalAttachmentUrl, getEagleItemId, extractEagleBridgeItemIdFromText, isEagleItemTrashed,
  getEagleItemFolderIds, stripInfoSuffix, normalizeFileUrl
} = require("./asset-utils");

function createEagleAssetsView({ VIEW_TYPE, DEFAULT_SETTINGS }) {
const LIBRARY_VIEW_ICONS = {
  waterfall: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="33" y="33" width="69" height="48" rx="12"/><rect x="126" y="33" width="69" height="103" rx="12"/><rect x="33" y="102" width="69" height="93" rx="12"/><rect x="126" y="158" width="69" height="37" rx="12"/></svg>`,
  list: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="36" y="33" width="69" height="69" rx="12"/><rect x="36" y="126" width="69" height="69" rx="12"/><path d="M124 49H191"/><path d="M124 141H191"/><path d="M124 88H191"/><path d="M124 180H191"/></svg>`,
  normal: `<svg viewBox="0 0 227 227" aria-hidden="true"><rect x="33" y="33" width="69" height="69" rx="12"/><rect x="126" y="33" width="69" height="69" rx="12"/><rect x="33" y="126" width="69" height="69" rx="12"/><rect x="126" y="126" width="69" height="69" rx="12"/></svg>`
};

class EagleAssetsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFilePath = "";
    this.currentContext = null;
    this.sourceLeaf = null;
    this.parentContext = null;
    this.repairChoice = null;
    this.isLibraryMode = false;
    this.libraryModePinned = false;
    this.loadRequestId = 0;
    // Source and reference status are independent. A local attachment can be
    // referenced or unreferenced too, so source must not be a status category.
    this.librarySourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
    this.libraryReferenceFilters = new Set(["referenced", "unreferenced", "trash"]);
    this.contextSourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
    this.libraryReferenceSummary = null;
    this.libraryReferenceSummaryGeneration = 0;
    this.libraryReferenceSummaryTask = null;
    this.libraryControls = null;
    this.libraryStatsEl = null;
    this.assetViewportStates = new Map();
    this.pendingAssetViewportState = null;
    this.backgroundSyncScheduler = new KeyedTaskScheduler();
    this.assetRenderGeneration = 0;
    this.pendingAssetCardClick = 0;
    this.selectedAssetItems = new Map();
    this.assetSelectionAnchorKey = "";
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "OE Link";
  }

  getIcon() {
    return "eagle-outline";
  }

  async onOpen() {
    this.registerDomEvent(document, "pointerdown", event => {
      if (event.button !== 0 || !this.selectedAssetItems.size) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".eaglebridge-note-assets-grid, .menu, .modal-container, .suggestion-container")) return;
      this.clearAssetSelection();
    }, true);
    await this.loadForCurrentNote(false);
  }

  async onClose() {
    this.loadRequestId += 1;
    this.backgroundSyncScheduler.clear();
    this.disposeAssetRendering();
  }

  beginLoad(requestId) {
    if (typeof requestId === "number") {
      this.loadRequestId = Math.max(this.loadRequestId, requestId);
      return requestId;
    }
    this.loadRequestId += 1;
    return this.loadRequestId;
  }

  isCurrentLoad(requestId) {
    return requestId === this.loadRequestId;
  }

  invalidateLibraryReferenceSummary() {
    this.libraryReferenceSummary = null;
    this.libraryReferenceSummaryGeneration += 1;
  }

  async getLibraryReferenceSummary() {
    while (!this.libraryReferenceSummary) {
      if (this.libraryReferenceSummaryTask) {
        await this.libraryReferenceSummaryTask.promise;
        continue;
      }

      const generation = this.libraryReferenceSummaryGeneration;
      const task = { generation, promise: null };
      task.promise = this.plugin.getObsidianLibraryReferenceSummary()
        .then(summary => {
          if (this.libraryReferenceSummaryGeneration === generation) {
            this.libraryReferenceSummary = summary;
          }
          return summary;
        })
        .finally(() => {
          if (this.libraryReferenceSummaryTask === task) {
            this.libraryReferenceSummaryTask = null;
          }
        });
      this.libraryReferenceSummaryTask = task;
      await task.promise;
    }
    return this.libraryReferenceSummary;
  }

  getAssetViewportKey() {
    if (this.isLibraryMode) return "library";
    return this.currentFilePath ? `context:${this.currentFilePath}` : "";
  }

  getAssetScrollArea() {
    return this.containerEl.children[1]?.querySelector(".eaglebridge-note-assets-scroll-area") || null;
  }

  captureAssetViewportState(key = this.getAssetViewportKey()) {
    const scrollArea = this.getAssetScrollArea();
    if (!key || !scrollArea) return null;
    const state = {
      scrollTop: scrollArea.scrollTop,
      renderedCount: scrollArea.querySelectorAll(".eaglebridge-note-assets-card").length
    };
    this.assetViewportStates.set(key, state);
    return state;
  }

  prepareAssetViewportRestore(targetKey) {
    const currentKey = this.getAssetViewportKey();
    const currentState = currentKey === targetKey ? this.captureAssetViewportState(currentKey) : null;
    this.pendingAssetViewportState = currentState || this.assetViewportStates.get(targetKey) || null;
  }

  enterContextMode(context, parentContext = null) {
    this.isLibraryMode = false;
    this.libraryControls = null;
    this.libraryStatsEl = null;
    this.currentFilePath = context.file.path;
    this.currentContext = context;
    this.parentContext = parentContext;
    this.sourceLeaf = this.plugin.findPreferredMarkdownLeaf(context.file.path, this.sourceLeaf);
  }

  enterLibraryMode() {
    this.currentFilePath = "";
    this.currentContext = null;
    this.sourceLeaf = null;
    this.parentContext = null;
    this.repairChoice = null;
    this.isLibraryMode = true;
  }

  async toggleLibraryMode() {
    if (this.isLibraryMode) {
      this.libraryModePinned = false;
      await this.loadForCurrentNote(false);
      return;
    }
    this.libraryModePinned = true;
    await this.loadObsidianLibrary();
  }

  async loadForContext(context, options = {}) {
    const requestId = this.beginLoad(options.requestId);
    const sameContext = this.currentFilePath === context.file.path
      && this.currentContext
      && this.currentContext.kind === context.kind;
    this.prepareAssetViewportRestore(`context:${context.file.path}`);
    this.enterContextMode(context, options.parentContext || null);
    if (sameContext) {
      this.setLoadingState(true);
    } else {
      this.renderLoading(context);
    }

    try {
      const items = await this.plugin.queryEagleItemsForNoteContext(context);
      if (!this.isCurrentLoad(requestId) || this.isLibraryMode || this.currentFilePath !== context.file.path) return;
      this.renderItems(context, items, { preserveToolbar: sameContext });
      await this.plugin.rememberCurrentFileEagleBridgeIds(context.file);
      if (!this.isCurrentLoad(requestId) || this.isLibraryMode || this.currentFilePath !== context.file.path) return;
      this.syncContextInBackground(context, requestId);
    } catch (error) {
      if (!this.isCurrentLoad(requestId)) return;
      this.renderEmpty(`Failed to read Eagle: ${error.message || error}`);
    } finally {
      if (this.isCurrentLoad(requestId)) this.setLoadingState(false);
    }
  }

  syncContextInBackground(context, requestId) {
    this.backgroundSyncScheduler.schedule("context", 0, async () => {
      try {
        if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
        if (this.plugin.settings.autoImportAttachments !== false) {
          await this.plugin.importAttachmentsForContext(context, { silent: true, organize: false, refresh: false });
        }
        if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
        if (this.plugin.settings.autoTagOnRefresh !== false) {
          await this.plugin.reconcileCurrentContextEagleBridgeTags(context, null, false);
        }
        if (!this.isCurrentLoad(requestId) || this.currentFilePath !== context.file.path) return;
        if (this.plugin.settings.autoFolderOnImport !== false) {
          await this.plugin.organizeCurrentContextEagleItemsIntoFolder(context, null, { createMissing: true });
        }
      } catch (error) {
        console.warn("Failed to run background Eagle sync:", error);
      }
    }, 0);
  }

  async loadForCurrentNote(showNotice = true) {
    if (this.libraryModePinned && this.isLibraryMode) return;
    const requestId = this.beginLoad();
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) {
      await this.loadObsidianLibrary({ requestId });
      return;
    }
    if (!isSupportedSourceFile(file)) {
      if (showNotice) new Notice(this.plugin.t("noticeOpenNoteOrCanvas"));
      return;
    }
    const context = await this.plugin.getAssetContext(file, showNotice);
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!this.isCurrentLoad(requestId) || !activeFile || activeFile.path !== file.path) return;
    this.repairChoice = null;
    await this.loadForContext(context, { requestId });
    if (!this.isCurrentLoad(requestId)) return;
    this.plugin.scheduleTrashStatusScan(document);
  }

  async loadObsidianLibrary(options = {}) {
    const requestId = this.beginLoad(options.requestId);
    if (options.resetReferenceSummary) this.invalidateLibraryReferenceSummary();
    this.prepareAssetViewportRestore("library");
    const preserveToolbar = this.isLibraryMode;
    this.enterLibraryMode();
    const root = preserveToolbar ? this.containerEl.children[1] : this.getRoot();
    if (!preserveToolbar) this.renderToolbar(root, null, null, { libraryMode: true });
    const content = this.getContentRoot(root);
    this.renderLibraryHeader(content);
    const progress = content.createEl("div", { cls: "eaglebridge-note-assets-stats" });
    this.libraryStatsEl = progress;
    this.renderLibraryStats(this.libraryReferenceSummary, progress);
    try {
      let summary = this.libraryReferenceSummary;
      if (!summary) {
        progress.setText(this.plugin.t("obsidianLibraryLoading"));
        const summaryTask = this.getLibraryReferenceSummary();
        void (async () => {
          try {
            if (!this.librarySourceFilters.has("eagle")) return;
            const previewPager = await this.plugin.createObsidianLibraryPager();
            const normalizePreviewPage = async limit => {
              const page = await previewPager.nextPage(limit);
              return {
                items: page.items.map(item => Object.assign({}, item, {
                  __assetSource: "eagle",
                  __libraryKey: `eagle:${stripInfoSuffix(getEagleItemId(item))}`
                })),
                hasMore: page.hasMore
              };
            };
            const preview = await normalizePreviewPage(24);
            if (!preview.items.length || this.libraryReferenceSummary || !this.isCurrentLoad(requestId) || !this.isLibraryMode) return;
            this.renderAssetGrid(content, preview.items, {
              loadMore: () => normalizePreviewPage(24),
              onRendered: count => progress.setText(`${this.plugin.t("obsidianLibraryLoading")} ${count}`)
            });
          } catch (error) {
            console.warn("Failed to render the initial Eagle library preview:", error);
          }
        })();
        summary = await summaryTask;
      }
      if (!this.isCurrentLoad(requestId) || !this.isLibraryMode) return;
      this.disposeAssetRendering();
      content.querySelector(".eaglebridge-note-assets-scroll-area")?.remove();
      const visibleItems = this.getFilteredLibraryItems(summary);
      const pager = this.plugin.createArrayPager(visibleItems);
      const initialCount = Math.max(24, Number(this.pendingAssetViewportState?.renderedCount) || 0);
      const initial = await pager.nextPage(initialCount);
      this.renderLibraryStats(summary, progress);
      if (!initial.items.length) {
        content.createDiv({
          cls: "eaglebridge-library-filter-empty",
          text: summary.items.length
            ? this.plugin.t("obsidianLibraryFilterEmpty")
            : this.plugin.t("obsidianLibraryEmpty")
        });
        return;
      }
      this.renderAssetGrid(content, initial.items, {
        loadMore: () => pager.nextPage(24),
        onRendered: () => {}
      });
    } catch (error) {
      progress.setText(`Failed to read Eagle: ${error.message || error}`);
    }
  }

  renderLibraryStats(summary, target = this.libraryStatsEl) {
    if (!target) return;
    target.empty();
    if (!summary) {
      target.setText(this.plugin.t("obsidianLibraryLoading"));
      return;
    }
    target.addClass("eaglebridge-library-filter-stats");
    const sourceItems = [
      ["eagle", "Eagle 库内", "is-eagle"],
      ["local", "Obsidian 库内", "is-local"],
      ["external-local", "Obsidian 库外", "is-external-local"],
      ["internet", "网络", "is-internet"]
    ];
    const referenceItems = [
      ["referenced", this.plugin.t("libraryReferenced"), "is-referenced"],
      ["unreferenced", this.plugin.t("libraryUnreferenced"), "is-unreferenced"]
    ];
    const activeSources = this.getEffectiveLibraryFilterSet(this.librarySourceFilters, sourceItems.map(([key]) => key));
    const activeReferences = this.getEffectiveLibraryFilterSet(this.libraryReferenceFilters, referenceItems.map(([key]) => key));
    const includeTrash = this.libraryReferenceFilters.has("trash");
    const itemMatches = (item, sources, references) => {
      return sources.has(this.getLibraryItemSource(item))
        && references.has(this.getLibraryItemReferenceState(item))
        && (includeTrash || !this.isLibraryItemTrashed(item));
    };
    const visibleCount = summary.items.filter(item => itemMatches(item, activeSources, activeReferences)).length;
    const stats = target.createDiv({ cls: "eaglebridge-library-filter-summary" });
    stats.createEl("span", {
      cls: "eaglebridge-note-assets-stat eaglebridge-note-assets-stat-total",
      text: this.plugin.t("totalAssets", { count: summary.total })
    });
    stats.createEl("span", {
      cls: "eaglebridge-note-assets-stat eaglebridge-note-assets-stat-visible",
      text: this.plugin.t("visibleAssetsStat", { count: visibleCount })
    });
    stats.createEl("span", {
      cls: `eaglebridge-note-assets-stat eaglebridge-note-assets-stat-selected${this.selectedAssetItems.size ? "" : " is-hidden"}`,
      text: this.plugin.t("selectedAssetsStat", { count: this.selectedAssetItems.size })
    });
    this.renderInlineViewSwitcher(stats, async () => {
      await this.loadObsidianLibrary();
    });

    const renderBar = (kind, entries, selected, selectedValues, counts) => {
      const section = target.createDiv({ cls: `eaglebridge-library-filter-bar-section is-${kind}` });
      const bar = section.createDiv({
        cls: "eaglebridge-library-filter-bar",
        attr: { role: "group" }
      });
      const total = entries.reduce((sum, [key]) => sum + (counts[key] || 0), 0);
      for (const [key, label, colorClass] of entries) {
        const count = counts[key] || 0;
        const isSelected = selectedValues.has(key);
        const button = bar.createEl("button", {
          cls: `eaglebridge-library-filter-segment ${colorClass}${isSelected ? " is-enabled" : ""}`,
          text: String(count),
          attr: {
            type: "button",
            "aria-label": label,
            "aria-pressed": isSelected ? "true" : "false"
          }
        });
        button.style.flex = total && count / total >= 0.03 ? `${count} 1 0px` : "0 0 22px";
        button.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          if (selected.has(key)) selected.delete(key);
          else selected.add(key);
          await this.loadObsidianLibrary();
        });
      }
      return section;
    };

    const sourceCounts = Object.fromEntries(sourceItems.map(([key]) => [key, 0]));
    for (const item of summary.items) {
      sourceCounts[this.getLibraryItemSource(item)] += 1;
    }
    renderBar("source", sourceItems, this.librarySourceFilters, activeSources, sourceCounts);

    const referenceCounts = Object.fromEntries(referenceItems.map(([key]) => [key, 0]));
    for (const item of summary.items) {
      if (activeSources.size && activeSources.has(this.getLibraryItemSource(item))) {
        referenceCounts[this.getLibraryItemReferenceState(item)] += 1;
      }
    }
    const referenceSection = renderBar("reference", referenceItems, this.libraryReferenceFilters, activeReferences, referenceCounts);
    const trashCount = summary.items.filter(item => activeSources.has(this.getLibraryItemSource(item))
      && activeReferences.has(this.getLibraryItemReferenceState(item))
      && this.isLibraryItemTrashed(item)).length;
    const sourceCount = summary.items.filter(item => activeSources.has(this.getLibraryItemSource(item))).length;
    const trashButton = referenceSection.createEl("button", {
      cls: `eaglebridge-library-trash-filter${includeTrash ? " is-enabled" : ""}`,
      text: String(trashCount),
      attr: { type: "button", "aria-label": this.plugin.t("trashLabel"), "aria-pressed": String(includeTrash) }
    });
    trashButton.style.flexBasis = `clamp(28px, ${sourceCount ? Math.round(trashCount / sourceCount * 100) : 0}%, 40%)`;
    setTooltip(trashButton, this.plugin.t("trashLabel"));
    trashButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      if (includeTrash) this.libraryReferenceFilters.delete("trash");
      else this.libraryReferenceFilters.add("trash");
      await this.loadObsidianLibrary();
    });
  }

  getLibraryAssetKey(item) {
    return this.plugin.getLibraryAssetKey(item);
  }

  getAssetSelectionKey(item) {
    if (!item) return "";
    const base = this.getLibraryAssetKey(item) || String(item.id || "");
    if (!base) return "";
    if (!this.isLibraryMode && typeof item.__sourceStart === "number") {
      return `${this.currentFilePath}:${item.__sourceStart}:${item.__sourceEnd}:${base}`;
    }
    return base;
  }
  isAssetImportable(item) {
    const source = String(item && item.__assetSource || "eagle");
    if (source === "external-local" && this.plugin.settings.importExternalLocalAttachments !== true) return false;
    if (source !== "local" && source !== "external-local" && source !== "internet") return false;
    return !this.isLibraryMode || this.getReferencedFilesForLibraryItem(item).length > 0;
  }
  updateAssetSelectionUi() {
    for (const card of this.containerEl.querySelectorAll(".eaglebridge-note-assets-card[data-asset-selection-key]")) {
      const checked = this.selectedAssetItems.has(card.dataset.assetSelectionKey || "");
      card.toggleClass("is-selected", checked);
      card.setAttr("aria-selected", String(checked));
    }
    const count = this.selectedAssetItems.size;
    for (const stat of this.containerEl.querySelectorAll(".eaglebridge-note-assets-stat-selected")) {
      stat.setText(this.plugin.t("selectedAssetsStat", { count }));
      stat.toggleClass("is-hidden", count === 0);
    }
  }
  clearAssetSelection() {
    if (!this.selectedAssetItems.size) return;
    this.selectedAssetItems.clear();
    this.assetSelectionAnchorKey = "";
    this.updateAssetSelectionUi();
  }
  selectAssetFromClick(item, event, items) {
    const key = this.getAssetSelectionKey(item);
    if (!key) return false;
    if (event.shiftKey && this.assetSelectionAnchorKey) {
      const anchorIndex = items.findIndex(candidate => this.getAssetSelectionKey(candidate) === this.assetSelectionAnchorKey);
      const itemIndex = items.findIndex(candidate => this.getAssetSelectionKey(candidate) === key);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        if (!event.ctrlKey && !event.metaKey) this.selectedAssetItems.clear();
        const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
        for (const candidate of items.slice(start, end + 1)) {
          const candidateKey = this.getAssetSelectionKey(candidate);
          if (candidateKey) this.selectedAssetItems.set(candidateKey, candidate);
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selectedAssetItems.has(key)) this.selectedAssetItems.delete(key);
      else this.selectedAssetItems.set(key, item);
      this.assetSelectionAnchorKey = key;
    } else {
      this.selectedAssetItems.clear();
      this.selectedAssetItems.set(key, item);
      this.assetSelectionAnchorKey = key;
    }
    this.updateAssetSelectionUi();
    return event.shiftKey || event.ctrlKey || event.metaKey;
  }
  selectAssetForContextMenu(item) {
    const key = this.getAssetSelectionKey(item);
    if (!key || this.selectedAssetItems.has(key)) return;
    this.selectedAssetItems.clear();
    this.selectedAssetItems.set(key, item);
    this.assetSelectionAnchorKey = key;
    this.updateAssetSelectionUi();
  }
  async importSelectedAssets() {
    const items = Array.from(this.selectedAssetItems.values())
      .filter(item => this.isAssetImportable(item))
      .sort((a, b) => Number(b.__sourceStart || 0) - Number(a.__sourceStart || 0));
    if (!items.length) {
      new Notice(this.plugin.t("noImportableSelectedAssets"));
      return;
    }
    const total = { success: 0, reused: 0, failed: 0 };
    const addResult = result => {
      if (!result) {
        total.failed += 1;
        return;
      }
      total.success += Number(result.success) || 0;
      total.reused += Number(result.reused) || 0;
      total.failed += Number(result.failed) || 0;
    };
    const importOne = async item => {
      const source = String(item && item.__assetSource || "eagle");
      if (this.isLibraryMode) {
        const files = this.getReferencedFilesForLibraryItem(item);
        if (source === "local") return this.plugin.importLocalAttachmentItemFromLibrary(item, files, { silent: true });
        if (source === "external-local") return this.plugin.importExternalLocalAttachmentItemFromLibrary(item, files, { silent: true });
        return this.plugin.importInternetAttachmentItemFromLibrary(item, files, { silent: true });
      }
      if (source === "local") return this.plugin.importLocalAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
      if (source === "external-local") return this.plugin.importExternalLocalAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
      return this.plugin.importInternetAttachmentItemFromPanel(this.currentFilePath, item, { silent: true });
    };
    await this.plugin.runWithReferenceViewRefreshPaused(async () => {
      for (const item of items) {
        try {
          addResult(await importOne(item));
        } catch (error) {
          console.warn("Failed to import selected attachment:", item, error);
          total.failed += 1;
        }
      }
    }, this.currentContext && this.currentContext.file);
    new Notice(this.plugin.t("noticeProcessedAttachments", total));
    this.clearAssetSelection();
    await this.reloadDisplayedContext(false);
  }
  isLibraryAssetReferenced(item) {
    const summary = this.libraryReferenceSummary;
    const refs = summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.get(this.getLibraryAssetKey(item));
    return !!(refs && refs.size);
  }

  getLibraryItemSource(item) {
    const source = String(item && item.__assetSource || "eagle");
    return source === "local" || source === "external-local" || source === "internet" ? source : "eagle";
  }

  getLibraryItemReferenceState(item) {
    return this.isLibraryAssetReferenced(item) ? "referenced" : "unreferenced";
  }

  isLibraryItemTrashed(item) {
    return !!(item && item.__inObsidianTrash)
      || String(item && item.__assetSource || "eagle") === "trash"
      || isEagleItemTrashed(item);
  }
  getEffectiveLibraryFilterSet(filters, allValues) {
    return filters instanceof Set ? filters : new Set(allValues);
  }

  getFilteredLibraryItems(summary) {
    if (!summary || !Array.isArray(summary.items)) return [];
    const sources = this.getEffectiveLibraryFilterSet(this.librarySourceFilters, ["eagle", "local", "external-local", "internet"]);
    const references = this.getEffectiveLibraryFilterSet(this.libraryReferenceFilters, ["referenced", "unreferenced"]);
    const includeTrash = this.libraryReferenceFilters.has("trash");
    return summary.items.filter(item => {
      return sources.has(this.getLibraryItemSource(item))
        && references.has(this.getLibraryItemReferenceState(item))
        && (includeTrash || !this.isLibraryItemTrashed(item));
    });
  }

  getAssetStatusMarkerEntries(item, isTrashed) {
    const source = this.getLibraryItemSource(item);
    const sourceLabels = {
      eagle: this.plugin.t("inEagle"),
      local: this.plugin.t("obsidianLocal"),
      "external-local": this.plugin.t("obsidianExternalLocal"),
      internet: this.plugin.t("internetAsset")
    };
    const sourceLabel = sourceLabels[source] || source;
    const entries = [{ className: `is-${source}`, label: sourceLabel }];
    if (this.isLibraryMode && this.libraryReferenceSummary) {
      const isReferenced = this.isLibraryAssetReferenced(item);
      entries.push({
        className: isReferenced ? "is-referenced" : "is-unreferenced",
        label: this.plugin.t(isReferenced ? "libraryReferenced" : "libraryUnreferenced")
      });
      if (isTrashed) entries.push({ className: "is-trash", label: this.plugin.t("trashLabel") });
    }
    return entries;
  }
  renderAssetStatusMarkers(card, entries) {
    const statusGroup = card.createDiv({ cls: "eaglebridge-asset-status-markers" });
    for (const entry of entries) {
      const marker = statusGroup.createSpan({
        cls: `eaglebridge-asset-status-marker ${entry.className}`,
        attr: { role: "img", "aria-label": entry.label }
      });
      setTooltip(marker, entry.label);
    }
  }

  async trashLibraryAssets(itemIds, successMessageKey, logMessage) {
    const ids = Array.from(new Set((itemIds || []).map(id => stripInfoSuffix(id)).filter(Boolean)));
    if (!ids.length) return 0;
    try {
      const moved = await this.plugin.moveEagleItemsToTrashViaHelper(ids);
      new Notice(this.plugin.t(successMessageKey, { count: moved }));
      this.invalidateLibraryReferenceSummary();
      this.librarySourceFilters = new Set(["eagle", "local", "external-local", "internet"]);
      this.libraryReferenceFilters = new Set(["referenced", "unreferenced", "trash"]);
      await this.loadObsidianLibrary();
      return moved;
    } catch (error) {
      console.warn(logMessage, error);
      new Notice(`移入 Eagle 回收站失败：${error && error.message ? error.message : error}`);
      return 0;
    }
  }

  getReferencedFilesForLibraryItem(itemOrId) {
    const summary = this.libraryReferenceSummary;
    const key = typeof itemOrId === "string"
      ? (summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.has(itemOrId)
        ? itemOrId
        : `eagle:${stripInfoSuffix(itemOrId)}`)
      : this.getLibraryAssetKey(itemOrId);
    const paths = summary && summary.assetReferenceFilesByKey && summary.assetReferenceFilesByKey.get(key);
    return Array.from(paths || [])
      .map(path => this.plugin.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile);
  }

  async getReferencedFilesForPreview(item) {
    const known = this.getReferencedFilesForLibraryItem(item);
    if (known.length || this.libraryReferenceSummary) return known;

    const collected = await this.plugin.collectObsidianLibrarySourceAssets();
    const key = this.getLibraryAssetKey(item);
    const source = String(item && item.__assetSource || "eagle");
    let paths = collected.sourceReferences.get(key);

    if ((!paths || !paths.size) && source !== "local" && source !== "external-local" && source !== "internet") {
      const itemId = stripInfoSuffix(getEagleItemId(item));
      paths = itemId ? collected.eagleReferenceFilesById.get(itemId) : null;
    }

    return Array.from(paths || [])
      .map(path => this.plugin.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile);
  }

  async openSourceFileInNewTab(file) {
    if (!(file instanceof TFile)) return;
    const leaf = this.plugin.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
  }
  async getAssetOriginalPath(item) {
    const localFile = item && item.__localFile;
    if (localFile instanceof TFile) return this.plugin.getFullPath(localFile);
    if (item && item.__assetSource === "external-local") return String(item.__externalLocalPath || "");
    if (item && item.__assetSource !== "internet") return await this.plugin.getOriginalPathForEagleItem(item) || "";
    return "";
  }
  async openLibraryAssetWithDefaultApp(item) {
    const fullPath = await this.getAssetOriginalPath(item);
    if (!fullPath) throw new Error("无法找到该附件的原始文件。");
    const electron = require("electron");
    const result = await electron.shell.openPath(fullPath);
    if (result) throw new Error(result);
  }

  async copyAssetImageToClipboard(item) {
    const { clipboard, nativeImage } = require("electron");
    const paths = [];
    if (item && item.__localFile instanceof TFile) {
      paths.push(this.plugin.getFullPath(item.__localFile));
    }
    if (item && item.__assetSource === "external-local" && item.__externalLocalPath) {
      paths.push(item.__externalLocalPath);
    }
    if (item && item.__assetSource !== "internet") {
      paths.push(await this.plugin.getOriginalPathForEagleItem(item));
    }
    for (const filePath of paths.filter(Boolean)) {
      const image = nativeImage.createFromPath(filePath);
      if (!image.isEmpty()) {
        clipboard.writeImage(image);
        return;
      }
      clipboard.writeBuffer("application/x-eaglebridge-attachment", nodeFs.readFileSync(filePath));
      clipboard.writeText(`file:///${filePath.replace(/\\/g, "/")}`);
      return;
    }
    const url = item && (item.resourceURL || item.fileURL || item.url);
    if (url) {
      const response = await requestUrl({ url, method: "GET" });
      const image = nativeImage.createFromBuffer(Buffer.from(response.arrayBuffer));
      if (!image.isEmpty()) {
        clipboard.writeImage(image);
        return;
      }
      clipboard.writeBuffer("application/x-eaglebridge-attachment", Buffer.from(response.arrayBuffer));
      clipboard.writeText(url);
      return;
    }
    throw new Error("\u65e0\u6cd5\u8bfb\u53d6\u6b64\u56fe\u7247\u7684\u539f\u59cb\u6570\u636e\u3002");
  }
  async copyAssetsToClipboard(items) {
    const selected = Array.from(items || []).filter(Boolean);
    if (selected.length === 1) return this.copyAssetImageToClipboard(selected[0]);
    const paths = await Promise.all(selected.map(item => this.getAssetOriginalPath(item)));
    if (!paths.length || paths.some(filePath => !filePath)) throw new Error(this.plugin.t("bulkCopyLocalFilesOnly"));
    if (process.platform !== "win32") throw new Error(this.plugin.t("bulkCopyWindowsOnly"));
    const payload = Buffer.from(JSON.stringify(paths), "utf8").toString("base64");
    const script = `$paths=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json; Add-Type -AssemblyName System.Windows.Forms; $files=New-Object Collections.Specialized.StringCollection; foreach($path in $paths){[void]$files.Add($path)}; [Windows.Forms.Clipboard]::SetFileDropList($files)`;
    await new Promise((resolve, reject) => require("child_process").execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      { windowsHide: true },
      error => error ? reject(error) : resolve()
    ));
  }

  isPreviewableAssetItem(item) {
    if (item && item.__isImage) return true;
    const extension = normalizeExtension(getAssetExtension(item));
    const candidates = [
      getAssetDisplayName(item),
      item && item.resourceURL,
      item && item.fileURL,
      item && item.url,
      extension ? `attachment${extension}` : ""
    ];
    return candidates.some(candidate => isPreviewableImage(candidate));
  }

  async openAssetPreview(item) {
    if (!this.isPreviewableAssetItem(item)) return;
    const itemSource = String(item && item.__assetSource || "eagle");
    const eagleItemId = itemSource === "eagle" || itemSource === "trash"
      ? stripInfoSuffix(getEagleItemId(item))
      : "";
    const bridgeUrl = eagleItemId ? this.plugin.getEagleBridgeUrl(item) : "";
    const source = bridgeUrl
      || (item && item.__assetSource === "internet" && (item.url || item.fileURL))
      || (item && item.resourceURL)
      || (item && (item.fileURL || item.url));
    if (!source) {
      new Notice("\u65e0\u6cd5\u8bfb\u53d6\u6b64\u9644\u4ef6\u7684\u9884\u89c8\u3002");
      return;
    }

    // Prefer the actual action attached to the currently rendered editor
    // image. Off-screen embeds do not receive Obsidian's native lightbox.
    try {
      const normalizeSource = (value) => {
        try {
          return new URL(String(value || ""), window.location.href).href;
        } catch (_) {
          return String(value || "");
        }
      };
      const expectedSource = normalizeSource(source);
      const matchingImages = Array.from(document.querySelectorAll("img[src]")).filter((image) => {
        const imageSource = String(image.getAttribute("src") || "");
        const imageItemId = stripInfoSuffix(extractEagleBridgeItemIdFromText(imageSource));
        if (eagleItemId && imageItemId === eagleItemId) return true;
        return normalizeSource(imageSource) === expectedSource;
      });
      // Prefer the active editor image over the same image rendered in this sidebar.
      const matchingImage = matchingImages.find(image => image.closest(".image-embed, .table-cell-wrapper"))
        || matchingImages[0];
      const imageContainer = matchingImage?.closest(".image-embed")
        || matchingImage?.parentElement?.parentElement
        || matchingImage?.parentElement;
      const findNativeZoomAction = () => imageContainer?.querySelector('.embed-action[aria-label="放大"]')
        || imageContainer?.querySelector('.embed-action .lucide-zoom-in')?.closest(".embed-action")
        || imageContainer?.querySelector('.embed-action[aria-label="Zoom"]')
        || imageContainer?.querySelector('.embed-action:not(.edit-block-button)');
      const tableCell = matchingImage?.closest(".table-cell-wrapper")?.closest("td");
      const findFloatingTableZoomAction = (imageRect) => {
        if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) return null;
        const actions = Array.from(document.querySelectorAll(".embed-action"))
          .filter(action => !action.classList.contains("edit-block-button"))
          .filter(action => action.querySelector(".lucide-zoom-in"))
          .map(action => ({ action, rect: action.getBoundingClientRect() }))
          .filter(({ rect }) => {
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            return rect.width > 0
              && rect.height > 0
              && centerX >= imageRect.left - 16
              && centerX <= imageRect.right + 16
              && centerY >= imageRect.top - 16
              && centerY <= imageRect.bottom + 16;
          });
        if (actions.length !== 1) return null;
        return actions[0].action;
      };

      if (tableCell && matchingImage) {
        // Table cells use their own editor. A complete pointer sequence activates
        // that editor, after which Obsidian creates the native image-preview action.
        const imageRect = matchingImage.getBoundingClientRect();
        const view = matchingImage.ownerDocument?.defaultView || window;
        const point = {
          clientX: imageRect.left + imageRect.width / 2,
          clientY: imageRect.top + imageRect.height / 2
        };
        const pointerOptions = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
          ...point
        };
        tableCell.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
        tableCell.dispatchEvent(new PointerEvent("pointerup", { ...pointerOptions, buttons: 0 }));
        tableCell.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view,
          button: 0,
          buttons: 0,
          ...point
        }));
        await new Promise(resolve => window.setTimeout(resolve, 180));
        const tableZoomAction = findFloatingTableZoomAction(imageRect);
        if (tableZoomAction) {
          tableZoomAction.click();
          return;
        }
      }

      let nativeZoomAction = findNativeZoomAction();
      if (nativeZoomAction) {
        nativeZoomAction.click();
        return;
      }
    } catch (error) {
      console.warn("Failed to access the active editor image zoom action.", error);
    }

    new Notice("Obsidian 当前无法为这个附件调用原生放大预览。");
  }

  async getAssetReferenceLink(item) {
    let link = "";
    if (item && item.__localFile instanceof TFile) {
      link = `![[${item.__localFile.path}]]`;
    } else if (item && item.__assetSource === "external-local" && item.__externalLocalPath) {
      link = `![${getAssetDisplayName(item) || "attachment"}](<${normalizeFileUrl(item.__externalLocalPath)}>)`;
    } else if (item && item.__assetSource === "internet") {
      const url = cleanExternalAttachmentUrl(item.resourceURL || item.fileURL || item.url);
      const itemId = extractEagleBridgeItemIdFromText(url);
      if (itemId && this.plugin.isEagleBridgeAssetUrl(url)) {
        const eagleItem = await this.plugin.queryEagleItemInfo(itemId) || item;
        const displayName = this.plugin.getCanonicalEagleFileName(eagleItem, getAssetDisplayName(eagleItem));
        link = this.plugin.buildReplacement({ name: displayName }, { displayName, itemId, bridgeUrl: url, url });
      } else if (url) {
        link = `![${getAssetDisplayName(item) || "image"}](${url})`;
      }
    } else {
      const itemId = stripInfoSuffix(getEagleItemId(item));
      if (itemId) {
        const displayName = this.plugin.getCanonicalEagleFileName(item, getAssetDisplayName(item));
        const bridgeUrl = this.plugin.getEagleBridgeUrl(item) || `${this.plugin.settings.eagleBridgeBaseUrl}/images/${itemId}.info`;
        link = this.plugin.buildReplacement({ name: displayName }, { displayName, itemId, bridgeUrl, url: bridgeUrl });
      }
    }
    if (!link) throw new Error("\u65e0\u6cd5\u751f\u6210\u6b64\u9644\u4ef6\u7684\u5f15\u7528\u94fe\u63a5\u3002");
    return link;
  }
  async copyAssetReferenceLinks(items) {
    const links = await Promise.all(Array.from(items || []).map(item => this.getAssetReferenceLink(item)));
    const text = links.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      require("electron").clipboard.writeText(text);
    }
    return text;
  }
  async copyAssetReferenceLink(item) {
    return this.copyAssetReferenceLinks([item]);
  }

  async trashSingleUnreferencedLibraryAsset(itemId) {
    const cleanId = stripInfoSuffix(itemId);
    if (!cleanId) return;
    if (this.isLibraryAssetReferenced({ id: cleanId, __assetSource: "eagle", __libraryKey: `eagle:${cleanId}` })) {
      new Notice("该素材仍被笔记或白板引用，不能移入 Eagle 回收站。");
      return;
    }
    await this.trashLibraryAssets([cleanId], "trashedSingleUnreferencedAsset", "Failed to move Eagle asset to trash");
  }

  async reloadDisplayedContext(showNotice = false) {
    if (this.isLibraryMode) {
      await this.loadObsidianLibrary({ resetReferenceSummary: true });
      return;
    }
    if (this.currentContext && this.currentContext.file instanceof TFile) {
      await this.loadForContext(this.currentContext, { parentContext: this.parentContext });
      return;
    }
    await this.loadForCurrentNote(showNotice);
  }

  async drillIntoCanvasNote(item) {
    const noteFile = item && item.__noteFile;
    const parentContext = this.currentContext && this.currentContext.kind === "canvas"
      ? this.currentContext
      : this.parentContext;
    if (!(noteFile instanceof TFile) || !parentContext) return;
    const context = await this.plugin.getNoteContext(noteFile, false);
    this.repairChoice = null;
    await this.loadForContext(context, { parentContext });
  }

  async returnToParentContext() {
    if (!this.parentContext) return;
    const context = this.parentContext;
    this.repairChoice = null;
    await this.loadForContext(context);
  }

  getRoot() {
    this.disposeAssetRendering();
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("eaglebridge-note-assets-view");
    return root;
  }

  getContentRoot(root = this.containerEl.children[1]) {
    this.disposeAssetRendering();
    this.selectedAssetItems.clear();
    this.assetSelectionAnchorKey = "";
    let content = root.querySelector(".eaglebridge-note-assets-content");
    if (!content) content = root.createDiv({ cls: "eaglebridge-note-assets-content" });
    content.empty();
    return content;
  }

  disposeAssetRendering() {
    this.assetRenderGeneration += 1;
    if (typeof this.assetInfiniteScrollCleanup === "function") {
      this.assetInfiniteScrollCleanup();
    }
    this.assetInfiniteScrollCleanup = null;
    this.assetRenderNextBatch = null;
  }

  renderLoading(context) {
    const root = this.getRoot();
    this.renderToolbar(root, context, context.file);
    root.createEl("div", {
      cls: "eaglebridge-note-assets-meta",
      text: this.plugin.t("readingLinks", { name: context.file.basename })
    });
  }

  setLoadingState(loading) {
    const root = this.containerEl.children[1];
    if (root && root.classList) root.toggleClass("is-loading", !!loading);
  }

  renderEmpty(message, file = null) {
    const root = this.getRoot();
    this.renderToolbar(root, null, file);
    root.createEl("div", { cls: "eaglebridge-note-assets-empty", text: message });
  }

  renderLibraryHeader(root) {
    const header = root.createDiv({ cls: "eaglebridge-library-header" });
    header.createEl("div", {
      cls: "eaglebridge-note-assets-meta eaglebridge-library-title",
      text: this.plugin.t("obsidianLibrary")
    });
    return header;
  }

  renderInlineViewSwitcher(parent, onChange) {
    const switcher = parent.createDiv({ cls: "eaglebridge-library-view-switcher" });
    const currentMode = normalizeAssetViewMode(this.plugin.settings.assetViewMode);
    const modes = [
      ["waterfall", "viewModeWaterfall"],
      ["list", "viewModeList"],
      ["normal", "viewModeNormal"]
    ];
    modes.forEach(([mode, labelKey], index) => {
      if (index) switcher.createSpan({ cls: "eaglebridge-library-view-separator" });
      const label = this.plugin.t(labelKey);
      const button = switcher.createEl("button", {
        cls: currentMode === mode
          ? "eaglebridge-library-view-icon is-enabled"
          : "eaglebridge-library-view-icon"
      });
      button.setAttr("aria-label", label);
      button.setAttr("aria-pressed", String(currentMode === mode));
      button.innerHTML = LIBRARY_VIEW_ICONS[mode];
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.plugin.settings.assetViewMode === mode) return;
        this.plugin.settings.assetViewMode = mode;
        await this.plugin.saveSettings();
        await onChange(mode);
      });
    });
    return switcher;
  }

  renderToolbar(root, context = null, file = null, options = {}) {
    const toolbar = root.createDiv({ cls: "eaglebridge-note-assets-toolbar" });
    const getActiveContext = () => this.currentContext || context;
    const createLibraryModeToggle = () => {
      const libraryToggle = toolbar.createEl("button", { cls: "eaglebridge-library-mode-toggle" });
      const label = options.libraryMode ? "\u8fd4\u56de\u5f53\u524d\u7b14\u8bb0" : "\u6253\u5f00 Obsidian \u7d20\u6750\u5e93";
      libraryToggle.setAttr("aria-label", label);
      libraryToggle.innerHTML = "<svg viewBox='0 0 1024 1024' aria-hidden='true'><path d='M453.344 846.256c-0.16 0-0.28 0.088-0.432 0.088-125.264-19.192-234.808-95.264-294.4-210.36-4.992-12.656-17.2-21.744-31.56-21.744h-3.504c-15.2 0-27.68 10.272-32.04 24.08-0.912 2.432-1.16 4.96-1.536 7.536-0.064 0.856-0.504 1.6-0.504 2.48v1.76c-0.04 1.712-0.2 3.32 0 5.048v164.184a34.192 34.192 0 0 0 34.08 34.104h3.504a34.192 34.192 0 0 0 34.08-34.104v-52.92c71.728 80.936 169.368 133.144 276.936 150.6 4.72 2.168 10.768 2.152 16.288 2.152 0.144 0 0.264-0.08 0.408-0.08 0.08 0 0.136 0.032 0.208 0.04v-0.088c20.208-0.352 35.592-15.328 35.592-35.624a37.136 37.136 0 0 0-37.12-37.152zM908.528 191.12h-3.504a34.192 34.192 0 0 0-34.08 34.104v53.352c-69.12-79.888-163.096-132.6-267.296-152.536a36.32 36.32 0 0 0-13.12-3.232c-0.984-0.16-1.896-0.56-2.88-0.72v0.296a36.88 36.88 0 0 0-36.504 36.848 36.872 36.872 0 0 0 36.504 36.848v0.336c122.152 22.44 227.752 99.136 284.864 213.336 3.144 6.28 8.128 10.656 13.68 14.08 5.472 3.76 11.728 6.48 18.832 6.48h3.504a34.184 34.184 0 0 0 34.08-34.096V225.224a34.192 34.192 0 0 0-34.08-34.104z'></path><path d='M172 172v216a16 16 0 0 0 16 16h216a16 16 0 0 0 16-16v-216a16 16 0 0 0-16-16h-216a16 16 0 0 0-16 16z m-4-88h256a68 68 0 0 1 68 68v256a68 68 0 0 1-68 68H168a68 68 0 0 1-68-68V152a68 68 0 0 1 68-68zM620 636v216a16 16 0 0 0 16 16h216a16 16 0 0 0 16-16v-216a16 16 0 0 0-16-16h-216a16 16 0 0 0-16 16z m-4-88h256a68 68 0 0 1 68 68v256a68 68 0 0 1-68 68H616a68 68 0 0 1-68-68V616a68 68 0 0 1 68-68z'></path></svg>";
      libraryToggle.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        libraryToggle.disabled = true;
        try {
          await this.toggleLibraryMode();
        } finally {
          libraryToggle.disabled = false;
        }
      });
      return libraryToggle;
    };
    const createCompoundAutoControl = (parent, options) => {
      const controlClasses = [options.controlClass, "eaglebridge-compound-auto-control"];
      if (options.enabled) controlClasses.push("is-enabled");
      if (options.disabled) controlClasses.push("is-management-disabled");
      const control = parent.createDiv({ cls: controlClasses.join(" ") });
      const primaryButton = control.createEl("button", {
        text: options.primaryText,
        cls: `${options.primaryClass} eaglebridge-compound-primary-button`
      });
      primaryButton.disabled = !!options.primaryDisabled || !!options.disabled;
      primaryButton.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await options.onPrimary();
      });
      const autoButton = control.createEl("button", {
        cls: `${options.autoClass} eaglebridge-compound-auto-toggle`
      });
      autoButton.disabled = !!options.disabled;
      const track = autoButton.createSpan({ cls: "eaglebridge-auto-toggle-track" });
      track.createSpan({ text: "AUTO", cls: "eaglebridge-auto-toggle-label" });
      track.createSpan({ cls: "eaglebridge-auto-toggle-knob" });
      autoButton.setAttr("aria-pressed", options.enabled ? "true" : "false");
      autoButton.setAttr("aria-label", "AUTO");
      const update = enabled => {
        control.toggleClass("is-enabled", !!enabled);
        autoButton.setAttr("aria-pressed", enabled ? "true" : "false");
      };
      autoButton.addEventListener("mousedown", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      autoButton.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (options.disabled) return;
        await options.onToggle(update);
      });
      return { control, primaryButton, autoButton, update };
    };

    if (options.libraryMode) {
      toolbar.addClass("is-library-mode");
      createLibraryModeToggle();
      this.libraryControls = null;
      return toolbar;
    }

    const tagRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
    const tagGroup = tagRow.createDiv({ cls: "eaglebridge-tag-group eaglebridge-segmented-group" });
    const tagManagementDisabled = this.plugin.settings.tagManagementEnabled === false;
    if (tagManagementDisabled) tagRow.style.display = "none";
    createCompoundAutoControl(tagGroup, {
      controlClass: "eaglebridge-tag-auto-control",
      primaryClass: "eaglebridge-add-tags-button",
      autoClass: "eaglebridge-tag-auto-button",
      primaryText: this.plugin.t("addTags"),
      primaryDisabled: !context,
      disabled: tagManagementDisabled,
      enabled: this.plugin.settings.autoTagOnRefresh !== false,
      onPrimary: async () => {
        const activeContext = getActiveContext();
        if (!activeContext) return;
        await this.plugin.reconcileCurrentContextEagleBridgeTags(activeContext, null, true);
        await this.reloadDisplayedContext();
      },
      onToggle: async update => {
        this.plugin.settings.autoTagOnRefresh = this.plugin.settings.autoTagOnRefresh === false;
        update(this.plugin.settings.autoTagOnRefresh);
        await this.plugin.saveSettings();
      }
    });
    const clearTagsButton = tagGroup.createEl("button", {
      text: this.plugin.t("clearObsidianTags"),
      cls: "eaglebridge-clear-ob-tags-button eaglebridge-segmented-button"
    });
    clearTagsButton.disabled = !context || tagManagementDisabled;
    clearTagsButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const activeContext = getActiveContext();
      if (!activeContext) return;
      const scope = await chooseInObsidianModal(
        this.plugin.app,
        this.plugin.t("clearObsidianTagsTitle"),
        this.plugin.t("noticeConfirmClearObsidianTags"),
        [
          { value: "current", label: this.plugin.t("clearCurrentFileTagsOption"), cta: true },
          { value: "all", label: this.plugin.t("clearAllAttachmentTagsOption") }
        ],
        this.plugin.t("cancel")
      );
      if (!scope) return;
      const updated = await this.plugin.clearObsidianTagsForCurrentContext(activeContext, scope);
      new Notice(this.plugin.t("noticeClearedObsidianTags", { count: updated }));
    });
    const copyButton = tagGroup.createEl("button", {
      text: this.plugin.t("copyFirstTag"),
      cls: "eaglebridge-segmented-button"
    });
    copyButton.disabled = !context || !(context.tags && context.tags.length) || tagManagementDisabled;
    copyButton.addEventListener("click", async () => {
      const activeContext = getActiveContext();
      if (!activeContext || !(activeContext.tags && activeContext.tags.length)) return;
      await navigator.clipboard.writeText(activeContext.tags[0]);
      new Notice(this.plugin.t("noticeCopied", { value: activeContext.tags[0] }));
    });
    createLibraryModeToggle();

    const folderRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
    const folderGroup = folderRow.createDiv({ cls: "eaglebridge-folder-group eaglebridge-segmented-group" });
    const folderManagementDisabled = this.plugin.settings.folderManagementEnabled === false;
    if (folderManagementDisabled) folderRow.style.display = "none";
    createCompoundAutoControl(folderGroup, {
      controlClass: "eaglebridge-folder-auto-control",
      primaryClass: "eaglebridge-add-folder-button",
      autoClass: "eaglebridge-folder-auto-button",
      primaryText: this.plugin.t("addToFolder"),
      primaryDisabled: !context,
      disabled: folderManagementDisabled,
      enabled: this.plugin.settings.autoFolderOnImport !== false,
      onPrimary: async () => {
        const activeContext = getActiveContext();
        if (!activeContext) return;
        const moved = await this.plugin.organizeCurrentContextEagleItemsIntoFolder(activeContext, null, { createMissing: true });
        new Notice(this.plugin.t("noticeJoinedFolder", { count: moved }));
        await this.reloadDisplayedContext();
      },
      onToggle: async update => {
        this.plugin.settings.autoFolderOnImport = this.plugin.settings.autoFolderOnImport === false;
        update(this.plugin.settings.autoFolderOnImport);
        await this.plugin.saveSettings();
      }
    });
    const clearFoldersButton = folderGroup.createEl("button", {
      text: this.plugin.t("clearObsidianFolders"),
      cls: "eaglebridge-clear-ob-folders-button eaglebridge-segmented-button"
    });
    clearFoldersButton.disabled = !context || folderManagementDisabled;
    clearFoldersButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const activeContext = getActiveContext();
      if (!activeContext) return;
      const scope = await chooseInObsidianModal(
        this.plugin.app,
        this.plugin.t("clearObsidianFoldersTitle"),
        this.plugin.t("noticeConfirmClearObsidianFolders"),
        [
          { value: "current", label: this.plugin.t("clearCurrentFileFoldersOption"), cta: true },
          { value: "all", label: this.plugin.t("clearAllAttachmentFoldersOption") }
        ],
        this.plugin.t("cancel")
      );
      if (!scope) return;
      try {
        const result = await this.plugin.clearObsidianFoldersForCurrentContext(activeContext, scope);
        new Notice(this.plugin.t("noticeClearedObsidianFolders", { count: result.updated }));
      } catch (error) {
        console.warn("Failed to clear Obsidian-managed Eagle folders:", error);
        new Notice(this.plugin.t("noticeClearObsidianFoldersNeedsHelper"));
      }
    });
    const importRow = toolbar.createDiv({ cls: "eaglebridge-toolbar-row" });
    const importGroup = importRow.createDiv({ cls: "eaglebridge-import-group eaglebridge-segmented-group" });
    createCompoundAutoControl(importGroup, {
      controlClass: "eaglebridge-import-auto-control",
      primaryClass: "eaglebridge-import-button",
      autoClass: "eaglebridge-import-auto-button",
      primaryText: this.plugin.t("importNoteAttachments"),
      primaryDisabled: !context,
      enabled: this.plugin.settings.autoImportAttachments !== false,
      onPrimary: async () => {
        const activeContext = getActiveContext();
        if (!activeContext) return;
        await this.plugin.importAttachmentsForContext(activeContext);
        await this.reloadDisplayedContext();
      },
      onToggle: async update => {
        this.plugin.settings.autoImportAttachments = this.plugin.settings.autoImportAttachments === false;
        update(this.plugin.settings.autoImportAttachments);
        await this.plugin.saveSettings();
      }
    });
    createCompoundAutoControl(importGroup, {
      controlClass: "eaglebridge-cleanup-auto-control",
      primaryClass: "eaglebridge-cleanup-button",
      autoClass: "eaglebridge-delete-local-button",
      primaryText: this.plugin.t("cleanupLocalCopies"),
      primaryDisabled: !context,
      enabled: this.plugin.settings.trashAfterImport,
      onPrimary: async () => {
        const activeContext = getActiveContext();
        if (!activeContext) return;
        await this.plugin.cleanupLocalCopiesForContext(activeContext);
        await this.reloadDisplayedContext();
      },
      onToggle: async update => {
        this.plugin.settings.trashAfterImport = !this.plugin.settings.trashAfterImport;
        update(this.plugin.settings.trashAfterImport);
        await this.plugin.saveSettings();
      }
    });
    return toolbar;
  }

  renderItems(context, items, options = {}) {
    const root = options.preserveToolbar ? this.containerEl.children[1] : this.getRoot();
    if (!options.preserveToolbar) this.renderToolbar(root, context, context.file);
    const content = this.getContentRoot(root);

    const visibleItems = this.getFilteredContextItems(items);
    this.renderAssetSummary(content, items, context, visibleItems);
    this.renderDrilldownHeader(content);
    this.renderRepairChoice(content);
    this.renderAssetGrid(content, visibleItems);
  }

  renderDrilldownHeader(root) {
    if (!this.parentContext || !this.currentContext) return;
    const header = root.createDiv({ cls: "eaglebridge-drilldown-header" });
    const button = header.createEl("button", {
      cls: "eaglebridge-drilldown-back",
      text: this.plugin.t("backToCanvas")
    });
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await this.returnToParentContext();
    });
    header.createEl("div", {
      cls: "eaglebridge-drilldown-title",
      text: this.plugin.t("viewingEmbeddedNote", { name: this.currentContext.file.name })
    });
  }

  renderRepairChoice(root) {
    const choice = this.repairChoice;
    if (!choice || !Array.isArray(choice.candidates) || !choice.candidates.length) return;

    const panel = root.createDiv({ cls: "eaglebridge-repair-choice-panel" });
    panel.createEl("div", {
      cls: "eaglebridge-repair-choice-title",
      text: "请选择要替换成哪个 Eagle 素材："
    });

    const list = panel.createDiv({ cls: "eaglebridge-repair-choice-list" });
    for (const candidate of choice.candidates) {
      const itemId = getEagleItemId(candidate);
      const candidateName = getAssetDisplayName(candidate) || itemId;
      const candidateExt = getAssetExtension(candidate);
      const candidateLabel = candidateExt && !candidateName.toLowerCase().endsWith(`.${candidateExt}`)
        ? `${candidateName}.${candidateExt}`
        : candidateName;
      const button = list.createEl("button", { cls: "eaglebridge-repair-choice-card" });
      const preview = button.createDiv({ cls: "eaglebridge-repair-choice-preview" });
      const img = preview.createEl("img");
      img.alt = candidateLabel;
      img.src = this.plugin.getEagleBridgeUrl(candidate);
      img.addEventListener("error", async () => {
        const thumbnailUrl = await this.plugin.getEagleItemThumbnailUrl(candidate);
        if (thumbnailUrl && img.src !== thumbnailUrl) {
          img.src = thumbnailUrl;
          return;
        }
        img.remove();
        createFilePlaceholder(preview, candidateExt, this.plugin.t("filePlaceholder"));
      }, { once: true });
      const info = button.createDiv({ cls: "eaglebridge-repair-choice-info" });
      info.createDiv({ cls: "eaglebridge-repair-choice-name", text: candidateLabel });
      info.createDiv({ cls: "eaglebridge-repair-choice-id", text: `${itemId}.info` });
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const ok = await this.plugin.applyEagleBridgeLinkReplacement(choice.ref, itemId);
        if (ok) {
          this.repairChoice = null;
          new Notice("已替换为选中的 Eagle 素材。");
          await this.reloadDisplayedContext(false);
        } else {
          new Notice("替换失败：没有找到可替换的 OE Link 链接。");
        }
      });
    }

    const cancelButton = panel.createEl("button", {
      cls: "eaglebridge-repair-choice-cancel",
      text: "取消"
    });
    cancelButton.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      this.repairChoice = null;
      await this.reloadDisplayedContext(false);
    });
  }

  async handleMissingItemRepair(item, displayName) {
    if (item.__missingReason !== "eagle") {
      new Notice("这个缺失素材不是 OE Link 链接，暂时无法自动修复。");
      return;
    }
    const sourceRef = {
      id: item.id,
      label: item.__noteLinkName || displayName,
      start: item.__sourceStart,
      end: item.__sourceEnd
    };
    const result = await this.plugin.prepareEagleBridgeRepairCandidates(sourceRef);
    if (!result) {
      new Notice("没有在当前笔记中找到这条 OE Link 链接。");
      return;
    }
    if (!result.candidates.length) {
      new Notice("没有找到名称和扩展名匹配的可用 Eagle 素材。");
      return;
    }
    if (result.candidates.length === 1) {
      const replacementId = getEagleItemId(result.candidates[0]);
      const ok = await this.plugin.applyEagleBridgeLinkReplacement(result.ref, replacementId);
      if (ok) {
        new Notice("已自动修复这个 Eagle 图片链接。");
        await this.reloadDisplayedContext(false);
      } else {
        new Notice("替换失败：没有找到可替换的 OE Link 链接。");
      }
      return;
    }
    this.repairChoice = result;
    await this.reloadDisplayedContext(false);
  }

  async trashLocalUnreferencedLibraryAttachment(item) {
    const localFile = item && item.__localFile;
    if (!(localFile instanceof TFile)) {
      new Notice(this.plugin.t("noticeNoAttachmentAtCursor"));
      return;
    }

    if (this.isLibraryAssetReferenced(item)) {
      new Notice(this.plugin.t("localAttachmentStillReferenced"));
      return;
    }

    const choice = await chooseInObsidianModal(
      this.plugin.app,
      this.plugin.t("trashLocalAttachmentTitle"),
      this.plugin.t("trashLocalAttachmentConfirm", { name: localFile.name }),
      [{ value: "trash", label: this.plugin.t("moveToObsidianTrash"), cta: true }],
      this.plugin.t("cancel")
    );
    if (choice !== "trash") return;

    const currentFile = this.plugin.app.vault.getAbstractFileByPath(localFile.path);
    if (!(currentFile instanceof TFile)) {
      new Notice(this.plugin.t("localAttachmentNoLongerExists"));
      await this.reloadDisplayedContext(false);
      return;
    }

    try {
      await this.plugin.trashLocalFile(currentFile);
      new Notice(this.plugin.t("trashedLocalUnreferencedAttachment", { name: currentFile.name }));
      await this.reloadDisplayedContext(false);
    } catch (error) {
      console.warn("Failed to move local attachment to Obsidian trash:", error);
      if (error && error.code === "ENOENT") {
        new Notice(this.plugin.t("localAttachmentNoLongerExists"));
        await this.reloadDisplayedContext(false);
        return;
      }
      new Notice(this.plugin.t("trashLocalAttachmentFailed", {
        name: localFile.name,
        message: error && error.message ? error.message : error
      }));
    }
  }

  async trashSelectedLocalAttachments(items) {
    const files = items.map(item => item.__localFile).filter(file => file instanceof TFile);
    const choice = await chooseInObsidianModal(
      this.plugin.app,
      this.plugin.t("trashLocalAttachmentTitle"),
      this.plugin.t("trashSelectedLocalAttachmentsConfirm", { count: files.length }),
      [{ value: "trash", label: this.plugin.t("moveToObsidianTrash"), cta: true }],
      this.plugin.t("cancel")
    );
    if (choice !== "trash") return;
    let moved = 0;
    for (const file of files) {
      const currentFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
      if (!(currentFile instanceof TFile)) continue;
      try {
        await this.plugin.trashLocalFile(currentFile);
        moved += 1;
      } catch (error) {
        console.warn("Failed to move selected local attachment to Obsidian trash:", error);
      }
    }
    new Notice(this.plugin.t("trashedSelectedLocalAttachments", { count: moved }));
    this.clearAssetSelection();
    await this.reloadDisplayedContext(false);
  }
  async showAssetCardContextMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    this.selectAssetForContextMenu(item);

    const menu = new Menu();
    const source = String(item && item.__assetSource || "eagle");
    const isLocalItem = source === "local" && item.__localFile instanceof TFile;
    const isExternalLocalItem = source === "external-local" && !!item.__externalLocalPath;
    const isInternetItem = source === "internet";
    const isMissingItem = source === "missing" || !!(item && item.__missingAttachment);
    const itemId = stripInfoSuffix(getEagleItemId(item));
    const isEagleItem = !!itemId && !isLocalItem && !isExternalLocalItem && !isInternetItem && !isMissingItem;
    const isTrashed = isEagleItem && isEagleItemTrashed(item);
    const displayName = getAssetDisplayName(item) || itemId || this.plugin.t("untitledAsset");
    const run = (label, task, icon = "") => {
      menu.addItem(menuItem => {
        menuItem.setTitle(label);
        if (icon) menuItem.setIcon(icon);
        menuItem.onClick(() => {
          Promise.resolve(task()).catch(error => {
            console.warn(`Failed to ${label}:`, error);
            new Notice(`${label}失败：${error && error.message ? error.message : error}`);
          });
        });
      });
    };
    const addEagleFolderMenu = async folderIds => {
      if (!folderIds.length) return;
      const folders = await this.plugin.queryEagleFolders().catch(() => []);
      menu.addItem(menuItem => {
        menuItem.setTitle("打开 Eagle 文件夹").setIcon("folder-open");
        const submenu = menuItem.setSubmenu();
        for (const folderId of folderIds) {
          const folder = findEagleFolderById(folders, folderId);
          submenu.addItem(folderItem => folderItem
            .setTitle(String(folder && folder.name || folderId))
            .setIcon("folder")
            .onClick(() => this.plugin.openExternalUrl(buildEagleFolderUrl(this.plugin.settings.eagleProtocolUrl, folderId))));
        }
      });
    };
    const addReferenceMenu = (references, targetItem) => {
      if (!references.length) return;
      menu.addItem(menuItem => {
        menuItem.setTitle("\u5b9a\u4f4d\u5230\u5f15\u7528\u4f4d\u7f6e").setIcon("map-pin");
        const submenu = menuItem.setSubmenu();
        for (const file of references) {
          submenu.addItem(referenceItem => referenceItem
            .setTitle(file.basename || file.path)
            .setIcon(file.extension === "canvas" ? "layout-dashboard" : "file-text")
            .onClick(() => file.path === this.currentFilePath && typeof targetItem.__sourceStart === "number"
              ? this.plugin.revealAssetInSource(file.path, targetItem, this.sourceLeaf)
              : this.openSourceFileInNewTab(file)));
        }
      });
    };

    const selectedItems = Array.from(this.selectedAssetItems.values());
    if (selectedItems.length > 1) {
      run(this.plugin.t("copyAttachment"), () => this.copyAssetsToClipboard(selectedItems), "copy");
      run(this.plugin.t("copyAttachmentReference"), async () => {
        await this.copyAssetReferenceLinks(selectedItems);
        new Notice(this.plugin.t("copiedAttachmentReferences", { count: selectedItems.length }));
      }, "copy");
      if (selectedItems.every(selected => this.isAssetImportable(selected))) {
        run(this.plugin.t("importSelectedToEagle"), () => this.importSelectedAssets(), "eagle-outline");
      }
      const allLocalTrashable = this.isLibraryMode && selectedItems.every(selected =>
        String(selected && selected.__assetSource || "eagle") === "local"
        && selected.__localFile instanceof TFile
        && !this.isLibraryAssetReferenced(selected));
      if (allLocalTrashable) {
        run(this.plugin.t("moveToObsidianTrash"), () => this.trashSelectedLocalAttachments(selectedItems), "trash-2");
      }
      const allEagleTrashable = this.isLibraryMode && selectedItems.every(selected => {
        const selectedSource = String(selected && selected.__assetSource || "eagle");
        return selectedSource === "eagle"
          && !!stripInfoSuffix(getEagleItemId(selected))
          && !isEagleItemTrashed(selected)
          && !this.isLibraryAssetReferenced(selected);
      });
      if (allEagleTrashable) {
        run(this.plugin.t("moveToEagleTrash"), () => this.trashLibraryAssets(
          selectedItems.map(selected => getEagleItemId(selected)),
          "trashedSelectedEagleAssets",
          "Failed to move selected Eagle assets to trash"
        ), "trash-2");
      }
      const folderGroups = selectedItems.map(selected => getEagleItemFolderIds(selected).map(String));
      const commonFolderIds = folderGroups[0].filter(folderId => folderGroups.slice(1).every(ids => ids.includes(folderId)));
      await addEagleFolderMenu(Array.from(new Set(commonFolderIds)));
      const currentFile = !this.isLibraryMode && this.currentFilePath
        ? this.plugin.app.vault.getAbstractFileByPath(this.currentFilePath)
        : null;
      const referenceGroups = await Promise.all(selectedItems.map(selected =>
        currentFile instanceof TFile && typeof selected.__sourceStart === "number"
          ? [currentFile]
          : this.getReferencedFilesForPreview(selected)));
      const commonReferences = referenceGroups[0].filter(file =>
        referenceGroups.slice(1).every(files => files.some(candidate => candidate.path === file.path)));
      addReferenceMenu(commonReferences, item);
      menu.showAtMouseEvent(event);
      return;
    }
    run(this.plugin.t("copyAttachment"), () => this.copyAssetImageToClipboard(item), "copy");
    run(this.plugin.t("copyAttachmentReference"), async () => {
      await this.copyAssetReferenceLink(item);
      new Notice(this.plugin.t("copiedAttachmentReferences", { count: 1 }));
    }, "copy");

    if (isMissingItem) {
      run("尝试修复", () => this.handleMissingItemRepair(item, displayName), "wrench");
    }

    if (isLocalItem) {
      if (this.isLibraryMode && !this.isLibraryAssetReferenced(item)) {
        run(this.plugin.t("moveToObsidianTrash"), () => this.trashLocalUnreferencedLibraryAttachment(item), "trash-2");
      } else {
        run(this.plugin.t("importSelectedToEagle"), async () => {
          if (this.isLibraryMode) {
            await this.plugin.importLocalAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
          } else {
            await this.plugin.importLocalAttachmentItemFromPanel(this.currentFilePath, item);
          }
          if (this.isLibraryMode) await this.reloadDisplayedContext(false);
        }, "eagle-outline");
      }
    } else if (isExternalLocalItem && this.plugin.settings.importExternalLocalAttachments === true) {
      run(this.plugin.t("importSelectedToEagle"), async () => {
        if (this.isLibraryMode) {
          await this.plugin.importExternalLocalAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
        } else {
          await this.plugin.importExternalLocalAttachmentItemFromPanel(this.currentFilePath, item);
        }
        if (this.isLibraryMode) await this.reloadDisplayedContext(false);
      }, "eagle-outline");
    } else if (isInternetItem) {
      run(this.plugin.t("importSelectedToEagle"), async () => {
        if (this.isLibraryMode) {
          await this.plugin.importInternetAttachmentItemFromLibrary(item, this.getReferencedFilesForLibraryItem(item));
        } else {
          await this.plugin.importInternetAttachmentItemFromPanel(this.currentFilePath, item);
        }
        if (this.isLibraryMode) await this.reloadDisplayedContext(false);
      }, "eagle-outline");
    } else if (isEagleItem && this.isLibraryMode && !isTrashed && !this.isLibraryAssetReferenced(item)) {
      run(this.plugin.t("moveToEagleTrash"), () => this.trashSingleUnreferencedLibraryAsset(itemId), "trash-2");
    }

    if ((isLocalItem || isExternalLocalItem || isEagleItem) && !isPreviewableImage(displayName)) {
      run("用默认应用打开", () => this.openLibraryAssetWithDefaultApp(item), "external-link");
    }

    if (isLocalItem) {
      run("打开文件所在位置", () => {
        const fullPath = this.plugin.getFullPath(item.__localFile);
        if (!fullPath) throw new Error("无法找到本地附件。");
        require("electron").shell.showItemInFolder(fullPath);
      }, "folder-open");
    } else if (isExternalLocalItem) {
      run("打开文件所在位置", () => require("electron").shell.showItemInFolder(item.__externalLocalPath), "folder-open");
    } else if (isInternetItem) {
      const url = item.resourceURL || item.fileURL || item.url;
      if (url) {
        run("在浏览器中打开原始链接", () => this.plugin.openExternalUrl(url), "external-link");
        run(this.plugin.t("copyOriginalLink"), async () => {
          try {
            await navigator.clipboard.writeText(url);
          } catch (_) {
            require("electron").clipboard.writeText(url);
          }
          new Notice(this.plugin.t("noticeCopied", { value: url }));
        }, "copy");
      }
    } else if (isEagleItem) {
      run("在 Eagle 中打开", () => this.plugin.openEagleItem(itemId), "eagle-outline");
      await addEagleFolderMenu(getEagleItemFolderIds(item));
    }

    const currentFile = !this.isLibraryMode && this.currentFilePath
      ? this.plugin.app.vault.getAbstractFileByPath(this.currentFilePath)
      : null;
    const references = currentFile instanceof TFile && typeof item.__sourceStart === "number"
      ? [currentFile]
      : await this.getReferencedFilesForPreview(item);
    addReferenceMenu(references, item);

    if (menu.items.length) {
      menu.showAtMouseEvent(event);
    }
  }

  renderWaterfallOverlay(card, item, displayName, statusText, statusClass) {
    const overlay = card.createDiv({ cls: "eaglebridge-waterfall-overlay" });
    overlay.createDiv({
      cls: "eaglebridge-waterfall-overlay-name",
      text: displayName || item.id || this.plugin.t("untitledAsset")
    });
    overlay.createDiv({
      cls: `eaglebridge-waterfall-overlay-status ${statusClass || ""}`,
      text: statusText
    });
    const itemId = getEagleItemId(item);
    if (itemId) {
      overlay.createDiv({
        cls: "eaglebridge-waterfall-overlay-id",
        text: `${itemId}.info`
      });
    }
  }

  applyAssetCardSize(grid, viewMode) {
    if (!grid) return;
    if (viewMode === "list") {
      const rowHeight = clampNumber(this.plugin.settings.assetListRowHeight, 40, 120, DEFAULT_SETTINGS.assetListRowHeight);
      grid.style.setProperty("--eaglebridge-asset-list-row-height", `${rowHeight}px`);
      grid.style.setProperty("--eaglebridge-asset-list-column-width", `${rowHeight * 5}px`);
      return;
    }
    const size = clampNumber(this.plugin.settings.assetCardSize, 64, 260, DEFAULT_SETTINGS.assetCardSize);
    grid.style.setProperty("--eaglebridge-asset-card-size", `${size}px`);
  }

  registerAssetZoomHandler(grid, viewMode) {
    if (!grid) return;
    grid.addEventListener("wheel", event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const isList = viewMode === "list";
      const settingKey = isList ? "assetListRowHeight" : "assetCardSize";
      const minimum = isList ? 40 : 64;
      const maximum = isList ? 120 : 260;
      const fallback = isList ? DEFAULT_SETTINGS.assetListRowHeight : DEFAULT_SETTINGS.assetCardSize;
      const cssProperty = isList ? "--eaglebridge-asset-list-row-height" : "--eaglebridge-asset-card-size";
      const current = clampNumber(this.plugin.settings[settingKey], minimum, maximum, fallback);
      const next = clampNumber(current + (event.deltaY < 0 ? 8 : -8), minimum, maximum, fallback);
      if (next === current) return;
      this.plugin.settings[settingKey] = next;
      grid.style.setProperty(cssProperty, `${next}px`);
      if (isList) grid.style.setProperty("--eaglebridge-asset-list-column-width", `${next * 5}px`);
      if (this.assetZoomSaveTimer) window.clearTimeout(this.assetZoomSaveTimer);
      this.assetZoomSaveTimer = window.setTimeout(() => {
        this.plugin.saveSettings().catch(error => console.warn("Failed to save asset view zoom:", error));
      }, 250);
    }, { passive: false });
  }

  getContextItemSource(item) {
    const source = String(item && item.__assetSource || "eagle");
    if (source === "note") return "note";
    if (source === "missing") return String(item && item.__missingReason || "eagle") === "local" ? "local" : "eagle";
    if (source === "local" || source === "external-local" || source === "internet") return source;
    return "eagle";
  }

  getFilteredContextItems(items) {
    const filters = this.getEffectiveLibraryFilterSet(this.contextSourceFilters, ["eagle", "local", "external-local", "internet"]);
    return (items || []).filter(item => {
      const source = this.getContextItemSource(item);
      return source === "note" || filters.has(source);
    });
  }

  renderAssetSummary(root, items, context = null, visibleItems = items) {
    const summary = getAssetSummary(items);
    const visibleSummary = getAssetSummary(visibleItems);
    const stats = root.createDiv({ cls: "eaglebridge-note-assets-stats eaglebridge-context-asset-stats" });
    const addStat = (text, cls = "") => stats.createEl("div", { cls: `eaglebridge-note-assets-stat ${cls}`.trim(), text });
    addStat(this.plugin.t("totalAssets", { count: summary.total }), "eaglebridge-note-assets-stat-total");
    addStat(this.plugin.t("visibleAssetsStat", { count: visibleSummary.total }), "eaglebridge-note-assets-stat-visible");
    addStat(
      this.plugin.t("selectedAssetsStat", { count: this.selectedAssetItems.size }),
      `eaglebridge-note-assets-stat-selected${this.selectedAssetItems.size ? "" : " is-hidden"}`
    );
    this.renderInlineViewSwitcher(stats, async () => {
      if (context) await this.loadForContext(context, { parentContext: this.parentContext });
    });
    this.renderContextSourceBar(root, summary, context, items);
  }

  renderContextSourceBar(root, summary, context, items) {
    const entries = [
      ["eagle", "Eagle 库内", "is-eagle", summary.inEagle + summary.trash],
      ["local", "Obsidian 库内", "is-local", summary.local],
      ["external-local", "Obsidian 库外", "is-external-local", summary.externalLocal],
      ["internet", "网络", "is-internet", summary.internet]
    ];
    const total = entries.reduce((sum, [, , , count]) => sum + count, 0);
    const bar = root.createDiv({
      cls: "eaglebridge-library-filter-bar eaglebridge-context-source-bar",
      attr: { "aria-label": "素材来源", role: "group" }
    });
    for (const [key, label, colorClass, count] of entries) {
      const enabled = this.contextSourceFilters.has(key);
      const segment = bar.createEl("button", {
        cls: `eaglebridge-library-filter-segment ${colorClass}${enabled ? " is-enabled" : ""}`,
        attr: {
          type: "button",
          "aria-label": key === "eagle" ? `Eagle 库内: ${summary.inEagle}，Eagle 回收站: ${summary.trash}` : `${label}: ${count}`,
          "aria-pressed": String(enabled)
        }
      });
      segment.createSpan({ text: String(key === "eagle" ? summary.inEagle : count) });
      if (key === "eagle" && summary.trash > 0) {
        segment.createSpan({ cls: "eaglebridge-context-trash-count", text: `+${summary.trash}` });
      }
      segment.style.flex = total && count / total >= 0.03 ? `${count} 1 0px` : "0 0 22px";
      segment.addEventListener("click", () => {
        if (enabled) this.contextSourceFilters.delete(key);
        else this.contextSourceFilters.add(key);
        this.renderItems(context, items, { preserveToolbar: true });
      });
    }
  }

  renderAssetGrid(root, items, options = {}) {
    const renderGeneration = ++this.assetRenderGeneration;
    const isCurrentRender = () => renderGeneration === this.assetRenderGeneration;
    if (!items.length) {
      root.createDiv({ cls: "eaglebridge-note-assets-scroll-area" }).createEl("div", {
        cls: "eaglebridge-note-assets-empty",
        text: this.plugin.t("noSupportedAssets")
      });
      return;
    }

    const restoreState = this.pendingAssetViewportState;
    this.pendingAssetViewportState = null;
    const scrollArea = root.createDiv({ cls: "eaglebridge-note-assets-scroll-area" });
    const viewMode = normalizeAssetViewMode(this.plugin.settings.assetViewMode);
    const usesHoverOverlay = viewMode === "waterfall" || viewMode === "normal";
    const grid = scrollArea.createDiv({ cls: `eaglebridge-note-assets-grid eaglebridge-note-assets-grid-${viewMode}` });
    scrollArea.addEventListener("click", event => {
      if (event.target === scrollArea || event.target === grid) this.clearAssetSelection();
    });
    this.applyAssetCardSize(grid, viewMode);
    this.registerAssetZoomHandler(grid, viewMode);
    const batchSize = 24;
    let renderedCount = 0;
    let loadMoreHint = null;
    const loadMore = typeof options.loadMore === "function" ? options.loadMore : null;
    let hasRemoteMore = !!loadMore;
    let loadingRemotePage = false;
    const updateLoadMoreHint = () => {
      if (!loadMoreHint) return;
      loadMoreHint.toggleClass("is-hidden", renderedCount >= items.length && !hasRemoteMore);
      loadMoreHint.toggleClass("is-loading", loadingRemotePage);
    };
    const renderNextBatch = () => {
      const batch = items.slice(renderedCount, renderedCount + batchSize);
      if (!batch.length) return false;
      for (const [batchIndex, item] of batch.entries()) {
      const card = grid.createDiv({ cls: `eaglebridge-note-assets-card eaglebridge-note-assets-card-${viewMode}` });
      card.style.setProperty("--eaglebridge-card-reveal-delay", `${Math.min(batchIndex, 12) * 16}ms`);
      const itemSource = String(item && item.__assetSource || "eagle");
      const eagleItemId = itemSource === "eagle" || itemSource === "trash"
        ? stripInfoSuffix(getEagleItemId(item))
        : "";
      if (eagleItemId) card.dataset.eagleItemId = eagleItemId;
      card.dataset.assetKey = String(item.id || "");
      const isNoteItem = item.__assetSource === "note";
      if (!isNoteItem) {
        const selectionKey = this.getAssetSelectionKey(item);
        if (selectionKey) {
          card.dataset.assetSelectionKey = selectionKey;
          const selected = this.selectedAssetItems.has(selectionKey);
          card.setAttr("aria-selected", String(selected));
          card.toggleClass("is-selected", selected);
        }
      }
      const cancelPendingCardClick = () => {
        if (!this.pendingAssetCardClick) return;
        window.clearTimeout(this.pendingAssetCardClick);
        this.pendingAssetCardClick = 0;
      };
      const deferCardClick = callback => {
        cancelPendingCardClick();
        this.pendingAssetCardClick = window.setTimeout(async () => {
          this.pendingAssetCardClick = 0;
          if (!isCurrentRender()) return;
          await callback();
        }, 220);
      };
      if (isNoteItem) {
        card.addClass("eaglebridge-note-assets-card-clickable");
        card.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          await this.drillIntoCanvasNote(item);
        });
      } else {
        if (!this.isLibraryMode && typeof item.__sourceStart === "number") {
          card.dataset.sourceStart = String(item.__sourceStart);
          card.dataset.sourceEnd = String(typeof item.__sourceEnd === "number" ? item.__sourceEnd : item.__sourceStart);
        }
        card.addClass("eaglebridge-note-assets-card-clickable");
        card.addEventListener("click", event => {
          if (event.detail > 1 || event.target.closest("button")) return;
          const modifiedSelection = this.selectAssetFromClick(item, event, items);
          if (modifiedSelection || this.isLibraryMode || typeof item.__sourceStart !== "number") return;
          deferCardClick(async () => {
            const scrollRoot = this.containerEl.children[1]?.querySelector(".eaglebridge-note-assets-scroll-area");
            const scrollTop = scrollRoot ? scrollRoot.scrollTop : 0;
            await this.plugin.revealAssetInSource(this.currentFilePath, item, this.sourceLeaf);
            if (scrollRoot) {
              window.requestAnimationFrame(() => {
                scrollRoot.scrollTop = scrollTop;
              });
            }
          });
        });
      }
      const isLocalItem = item.__assetSource === "local";
      const isExternalLocalItem = item.__assetSource === "external-local";
      const isObsidianTrashedLocal = isLocalItem && !!item.__inObsidianTrash;
      const isInternetItem = item.__assetSource === "internet";
      const isMissingItem = item.__assetSource === "missing" || item.__missingAttachment;
      const isTrashedItem = isObsidianTrashedLocal || (!isLocalItem && isEagleItemTrashed(item));
      const displayName = getAssetDisplayName(item);
      const statusText = isNoteItem
        ? this.plugin.t("embeddedNote")
        : isObsidianTrashedLocal
        ? this.plugin.t("inEagleTrash")
        : isLocalItem
        ? this.plugin.t("obsidianLocal")
        : isExternalLocalItem
          ? this.plugin.t("obsidianExternalLocal")
        : isInternetItem
          ? this.plugin.t("internetAsset")
          : isMissingItem
            ? "加载失败"
            : isTrashedItem
              ? this.plugin.t("inEagleTrash")
              : this.plugin.t("inEagle");
      const statusClass = isNoteItem
        ? "eaglebridge-note-text"
        : isObsidianTrashedLocal
        ? "eaglebridge-trash-text"
        : isLocalItem
        ? "eaglebridge-local-text"
        : isExternalLocalItem
          ? "eaglebridge-external-local-text"
        : isInternetItem
          ? "eaglebridge-internet-text"
          : isMissingItem
            ? "eaglebridge-missing-text"
            : isTrashedItem
              ? "eaglebridge-trash-text"
              : "eaglebridge-eagle-text";
      const statusMarkerEntries = !isNoteItem && !isMissingItem
        ? this.getAssetStatusMarkerEntries(item, isTrashedItem)
        : [];
      const tooltipStatus = statusMarkerEntries.map(entry => entry.label).join(" | ") || statusText;
      setTooltip(card, [displayName || item.id || this.plugin.t("untitledAsset"), tooltipStatus, getEagleItemId(item)].filter(Boolean).join("\n"));
      if (isNoteItem) {
        card.addClass("eaglebridge-card-note");
      } else if (isObsidianTrashedLocal) {
        card.addClass("eaglebridge-card-in-trash");
      } else if (isLocalItem) {
        card.addClass("eaglebridge-card-local");
      } else if (isExternalLocalItem) {
        card.addClass("eaglebridge-card-external-local");
      } else if (isInternetItem) {
        card.addClass("eaglebridge-card-internet");
      } else if (isMissingItem) {
        card.addClass("eaglebridge-card-missing");
      } else if (isTrashedItem) {
        card.addClass("eaglebridge-card-in-trash");
      } else {
        card.addClass("eaglebridge-card-in-eagle");
      }
      const isLibraryAssetCard = !!(this.isLibraryMode && !isMissingItem && !isNoteItem);
      if (isLibraryAssetCard) {
        const libraryKey = this.getLibraryAssetKey(item);
        if (libraryKey) card.dataset.libraryAssetKey = libraryKey;
        card.addClass("eaglebridge-note-assets-card-clickable");
      }
      if (statusMarkerEntries.length) this.renderAssetStatusMarkers(card, statusMarkerEntries);
      if (!isNoteItem && this.isPreviewableAssetItem(item)) {
        card.addEventListener("dblclick", event => {
          if (event.target.closest("button")) return;
          event.preventDefault();
          event.stopPropagation();
          cancelPendingCardClick();
          void this.openAssetPreview(item);
        });
      }
      if (!isNoteItem) {
        card.addEventListener("contextmenu", event => {
          void this.showAssetCardContextMenu(event, item);
        });
      }
      const createPreviewPlaceholder = () => {
        const placeholder = createFilePlaceholder(card, getAssetExtension(item), this.plugin.t("filePlaceholder"));
        const firstTitle = card.querySelector(".eaglebridge-note-assets-title");
        if (firstTitle) card.insertBefore(placeholder, firstTitle);
        return placeholder;
      };
      if (isNoteItem) {
        createNotePlaceholder(card, displayName || this.plugin.t("untitledAsset"), this.plugin.t("notePlaceholder"));
      } else if (isMissingItem) {
        createPreviewPlaceholder();
      } else if (isLocalItem || isExternalLocalItem || isInternetItem) {
        const previewSource = item.resourceURL || item.fileURL || item.url || displayName || "";
        if (this.isPreviewableAssetItem(item)) {
          const img = card.createEl("img");
          img.alt = displayName || item.id || this.plugin.t(isInternetItem ? "internetAsset" : isExternalLocalItem ? "obsidianExternalLocal" : "localAttachmentAlt");
          img.loading = "lazy";
          img.decoding = "async";
          if (isInternetItem) img.referrerPolicy = "no-referrer";
          let previewFallbackShown = false;
          const showPreviewFallback = () => {
            if (previewFallbackShown) return;
            previewFallbackShown = true;
            img.remove();
            createPreviewPlaceholder();
          };
          if (isExternalLocalItem) {
            Promise.resolve(require("electron").nativeImage.createThumbnailFromPath(item.__externalLocalPath, { width: 512, height: 512 }))
              .then(thumbnail => {
                if (!isCurrentRender() || !img.isConnected || !thumbnail || thumbnail.isEmpty()) return showPreviewFallback();
                img.src = thumbnail.toDataURL();
              })
              .catch(showPreviewFallback);
          } else {
            img.src = previewSource;
          }
          if (!isInternetItem && !isExternalLocalItem && item.resourceURL && item.fileURL) {
            img.addEventListener("error", () => {
              if (img.src !== item.fileURL) {
                img.src = item.fileURL;
                return;
              }
              showPreviewFallback();
            });
          } else {
            img.addEventListener("error", showPreviewFallback);
          }
        } else {
          createPreviewPlaceholder();
        }
      } else {
        const img = card.createEl("img");
        img.alt = displayName || item.id || this.plugin.t("eagleAssetAlt");
        img.loading = "lazy";
        img.decoding = "async";
        let fallbackStage = 0;
        const showFallback = async () => {
          fallbackStage += 1;
          if (fallbackStage === 1) {
            const thumbnailUrl = await this.plugin.getEagleItemThumbnailUrl(item);
            if (thumbnailUrl && img.src !== thumbnailUrl) {
              img.src = thumbnailUrl;
              return;
            }
          }
          const fileUrl = item.fileURL || item.url;
          if (fallbackStage === 2 && fileUrl && img.src !== fileUrl) {
            img.src = fileUrl;
            return;
          }
          if (fallbackShown) return;
          fallbackShown = true;
          img.remove();
          createPreviewPlaceholder();
        };
        let fallbackShown = false;
        img.addEventListener("error", showFallback);
        const bridgeUrl = this.plugin.getEagleBridgeUrl(item);
        if (bridgeUrl) {
          img.src = bridgeUrl;
        } else {
          img.src = "";
          this.plugin.getEagleItemThumbnailUrl(item).then(url => {
            if (url) {
              img.src = url;
            } else {
              showFallback();
            }
          });
        }
      }
      const imagePreview = card.querySelector("img");
      if (viewMode === "waterfall" && imagePreview) {
        const signature = getEagleItemMatchSignature(item);
        if (signature && signature.width && signature.height) {
          imagePreview.addClass("eaglebridge-preview-reserved");
          imagePreview.style.aspectRatio = `${signature.width} / ${signature.height}`;
        }
      }
      const preview = card.querySelector(".eaglebridge-file-placeholder");
      card.createEl("div", {
        cls: "eaglebridge-note-assets-title",
        text: displayName || item.id || this.plugin.t("untitledAsset")
      });
      if (isNoteItem) {
        card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-note-text",
          text: this.plugin.t("embeddedNote")
        });
      } else if (isObsidianTrashedLocal) {
        card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-trash-text",
          text: this.plugin.t("inEagleTrash")
        });
      } else if (isLocalItem) {
        const localRow = card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-local-row"
        });
        localRow.createEl("span", {
          cls: "eaglebridge-local-text",
          text: this.plugin.t("obsidianLocal")
        });
      } else if (isExternalLocalItem) {
        const localRow = card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-local-row"
        });
        localRow.createEl("span", {
          cls: "eaglebridge-external-local-text",
          text: this.plugin.t("obsidianExternalLocal")
        });
      } else if (isInternetItem) {
        const internetRow = card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-local-row"
        });
        internetRow.createEl("span", {
          cls: "eaglebridge-internet-text",
          text: this.plugin.t("internetAsset")
        });
      } else if (isMissingItem) {
        const missingRow = card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-missing-row"
        });
        missingRow.createEl("span", {
          cls: "eaglebridge-missing-text",
          text: "加载失败"
        });
      } else if (isTrashedItem) {
        card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-trash-text",
          text: this.plugin.t("inEagleTrash")
        });
      } else {
        card.createEl("div", {
          cls: "eaglebridge-note-assets-title eaglebridge-eagle-text",
          text: this.plugin.t("inEagle")
        });
      }
      if (usesHoverOverlay) {
        this.renderWaterfallOverlay(card, item, displayName, statusText, statusClass);
      }
      }
      renderedCount += batch.length;
      updateLoadMoreHint();
      if (typeof options.onRendered === "function") options.onRendered(renderedCount);
      return true;
    };
    loadMoreHint = scrollArea.createDiv({
      cls: "eaglebridge-asset-load-more-hint",
      text: this.plugin.t("loadMoreAssets")
    });
    renderNextBatch();
    const restoreRenderedCount = Math.max(batchSize, Number(restoreState?.renderedCount) || 0);
    while (renderedCount < restoreRenderedCount && renderNextBatch()) {}
    updateLoadMoreHint();

    const scrollRoot = scrollArea;
    const loadMoreWhenNeeded = async () => {
      if (!isCurrentRender()) return;
      if (!scrollRoot) return;
      if (scrollRoot.scrollTop + scrollRoot.clientHeight < scrollRoot.scrollHeight - 180) return;
      if (renderNextBatch()) return;
      if (!loadMore || !hasRemoteMore || loadingRemotePage) return;
      loadingRemotePage = true;
      updateLoadMoreHint();
      try {
        const page = await loadMore();
        if (!isCurrentRender()) return;
        const nextItems = Array.isArray(page) ? page : (page && Array.isArray(page.items) ? page.items : []);
        if (page && typeof page.hasMore === "boolean") hasRemoteMore = page.hasMore;
        if (nextItems.length) {
          items.push(...nextItems);
          renderNextBatch();
        } else {
          hasRemoteMore = false;
        }
      } catch (error) {
        console.warn("Failed to load more Eagle assets:", error);
        hasRemoteMore = false;
      } finally {
        loadingRemotePage = false;
        updateLoadMoreHint();
      }
    };
    if (scrollRoot) {
      const handleScroll = () => {
        if (!isCurrentRender()) return;
        const key = this.getAssetViewportKey();
        if (key) this.assetViewportStates.set(key, { scrollTop: scrollRoot.scrollTop, renderedCount });
        void loadMoreWhenNeeded();
      };
      scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
      this.assetInfiniteScrollCleanup = () => scrollRoot.removeEventListener("scroll", handleScroll);
      window.requestAnimationFrame(() => {
        if (!isCurrentRender()) return;
        if (restoreState) {
          scrollRoot.scrollTop = Math.min(Number(restoreState.scrollTop) || 0, Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight));
        }
        window.requestAnimationFrame(() => {
          if (isCurrentRender()) void loadMoreWhenNeeded();
        });
      });
    }
    this.assetRenderNextBatch = renderNextBatch;
  }

  async scrollToAssetRange(filePath, range) {
    if (!filePath || !range) return false;
    if (filePath !== this.currentFilePath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return false;
      const context = await this.plugin.getAssetContext(file, true);
      if (!context) return false;
      await this.loadForContext(context);
    }
    const root = this.containerEl.children[1];
    if (!root) return false;
    const start = String(range.start);
    const end = String(typeof range.end === "number" ? range.end : range.start);
    const itemId = stripInfoSuffix(range.itemId || "");
    const assetKey = String(range.assetKey || "");
    const findCard = () => {
      const cards = Array.from(root.querySelectorAll(".eaglebridge-note-assets-card[data-source-start]"));
      return (assetKey ? cards.find(el => el.dataset.assetKey === assetKey) : null)
        || cards.find(el => el.dataset.sourceStart === start && el.dataset.sourceEnd === end)
        || cards.find(el => el.dataset.sourceStart === start)
        || (itemId ? cards.find(el => el.dataset.eagleItemId === itemId) : null);
    };
    let card = findCard();
    while (!card && typeof this.assetRenderNextBatch === "function" && this.assetRenderNextBatch()) {
      card = findCard();
    }
    if (!card) return false;

    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.addClass("eaglebridge-card-source-highlight");
    window.setTimeout(() => {
      card.removeClass("eaglebridge-card-source-highlight");
    }, 1600);
    return true;
  }
}

  return EagleAssetsView;
}

module.exports = { createEagleAssetsView };
