const { Notice, PluginSettingTab, Setting } = require("obsidian");
const { getDefaultEaglePluginsDir, normalizeEagleFolderId } = require("./asset-utils");

function createEagleAssetsSettingTab({ DEFAULT_SETTINGS, VIEW_TYPE }) {
  return class EagleAssetsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: this.plugin.t("settingsTitle") });
    const showDetectionResult = (value, error) => new Notice(error
      ? this.plugin.t("noticeAutoDetectFailed", { error: error.message || error })
      : this.plugin.t("noticeAutoDetectSuccess", { value: Array.isArray(value) ? value.join("; ") : value }));
    const addTextSetting = ({ name, desc, placeholder, value, onChange, onDetect }) => {
      let input;
      const setting = new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(text => {
          input = text;
          return text.setPlaceholder(placeholder).setValue(value).onChange(onChange);
        });
      if (onDetect) setting.addButton(button => button
        .setButtonText(this.plugin.t("settingAutoDetect"))
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const detected = await onDetect();
            input.setValue(detected);
            showDetectionResult(detected);
          } catch (error) {
            showDetectionResult(null, error);
          } finally {
            button.setDisabled(false);
          }
        }));
      return setting;
    };

    const languageSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingLanguageName"))
      .setDesc(this.plugin.t("settingLanguageDesc"))
      .addDropdown(dropdown => dropdown
        .addOption("auto", this.plugin.t("languageAuto"))
        .addOption("zh", this.plugin.t("languageZh"))
        .addOption("en", this.plugin.t("languageEn"))
        .setValue(this.plugin.settings.language || DEFAULT_SETTINGS.language)
        .onChange(async value => {
          this.plugin.settings.language = value || DEFAULT_SETTINGS.language;
          await this.plugin.saveSettings();
          this.display();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            const view = leaf.view;
            if (view && typeof view.loadForCurrentNote === "function") {
              await view.loadForCurrentNote(false);
            }
          }
        }));

    const connectionModeSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingConnectionModeName"))
      .setDesc(this.plugin.t("settingLocalConnectionModeDesc"))
      .addButton(button => button
        .setButtonText(this.plugin.t("enterCloudConnectionMode"))
        .onClick(() => this.plugin.switchConnectionMode("cloud")));

    const targetFolderSetting = addTextSetting({
      name: this.plugin.t("settingFolderIdName"),
      desc: this.plugin.t("settingFolderIdDesc"),
      placeholder: this.plugin.t("settingFolderIdPlaceholder"),
      value: this.plugin.settings.eagleFolderId || DEFAULT_SETTINGS.eagleFolderId,
      onChange: async value => {
          this.plugin.settings.eagleFolderId = normalizeEagleFolderId(value);
          await this.plugin.saveSettings();
      }
    });

    const apiSetting = addTextSetting({
      name: this.plugin.t("settingApiName"),
      desc: this.plugin.t("settingApiDesc"),
      placeholder: "http://localhost:41595",
      value: this.plugin.settings.eagleApiBaseUrl,
      onChange: async value => {
          this.plugin.settings.eagleApiBaseUrl = value.trim() || DEFAULT_SETTINGS.eagleApiBaseUrl;
          await this.plugin.saveSettings();
      }
    });

    const bridgeSetting = addTextSetting({
      name: this.plugin.t("settingBridgeUrlName"),
      desc: this.plugin.t("settingBridgeUrlDesc"),
      placeholder: "http://localhost:6060",
      value: this.plugin.settings.eagleBridgeBaseUrl,
      onChange: async value => {
          this.plugin.settings.eagleBridgeBaseUrl = value.trim() || DEFAULT_SETTINGS.eagleBridgeBaseUrl;
          await this.plugin.saveSettings();
          this.plugin.syncCompanionMediaService().catch(error => {
            console.warn("OE Link media service is not ready:", error);
          });
      }
    });

    const externalLocalImportSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingImportExternalLocalName"))
      .setDesc(this.plugin.t("settingImportExternalLocalDesc"))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.importExternalLocalAttachments === true)
        .onChange(async value => {
          this.plugin.settings.importExternalLocalAttachments = value;
          await this.plugin.saveSettings();
        }));
    externalLocalImportSetting.settingEl.addClass("eaglebridge-settings-toggle-row");

    const helperPluginSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingInstallHelperName"))
      .setDesc(this.plugin.t("settingInstallHelperDesc"));
    helperPluginSetting.settingEl.addClass("eaglebridge-helper-plugin-setting");
    helperPluginSetting.controlEl.empty();

    const helperDirectory = helperPluginSetting.settingEl.createDiv({
      cls: "eaglebridge-helper-plugin-directory"
    });
    const helperDirectoryInput = helperDirectory.createEl("input", {
      type: "text",
      placeholder: this.plugin.t("settingHelperPluginsDirPlaceholder"),
      value: this.plugin.settings.eagleHelperPluginsDir || DEFAULT_SETTINGS.eagleHelperPluginsDir
    });
    const saveHelperDirectory = async () => {
      this.plugin.settings.eagleHelperPluginsDir = helperDirectoryInput.value.trim() || DEFAULT_SETTINGS.eagleHelperPluginsDir;
      await this.plugin.saveSettings();
    };
    helperDirectoryInput.addEventListener("change", saveHelperDirectory);
    helperDirectoryInput.addEventListener("blur", saveHelperDirectory);

    const detectHelperDirectoryButton = helperDirectory.createEl("button", {
      text: this.plugin.t("settingAutoDetect"),
      cls: "eaglebridge-inline-detect"
    });
    detectHelperDirectoryButton.addEventListener("click", async () => {
      detectHelperDirectoryButton.disabled = true;
      try {
        const value = await this.plugin.detectAndFillEagleHelperPluginsDir();
        helperDirectoryInput.value = value;
        showDetectionResult(value);
      } catch (error) {
        showDetectionResult(null, error);
      } finally {
        detectHelperDirectoryButton.disabled = false;
      }
    });

    const installButton = helperPluginSetting.controlEl.createEl("button", {
      text: this.plugin.t("installOrUpdateHelper"),
      cls: "mod-cta eaglebridge-helper-plugin-install"
    });
    installButton.addEventListener("click", async () => {
      await saveHelperDirectory();
      installButton.disabled = true;
      try {
        await this.plugin.installOrUpdateEagleHelperPlugin();
      } finally {
        installButton.disabled = false;
      }
    });

    const attachmentCard = containerEl.createDiv({
      cls: "eaglebridge-settings-rule-card eaglebridge-settings-attachment-card"
    });
    const attachmentHeader = attachmentCard.createDiv({ cls: "eaglebridge-settings-rule-header" });
    attachmentHeader.createEl("h4", { text: this.plugin.t("attachmentManagementTitle") });
    const attachmentDescription = attachmentCard.createEl("p", {
      text: `${this.plugin.t("attachmentManagementDesc")} `
    });
    attachmentDescription.createSpan({
      cls: "eaglebridge-settings-inline-warning",
      text: this.plugin.t("attachmentManagementWarning")
    });
    attachmentCard.appendChild(targetFolderSetting.settingEl);
    attachmentCard.appendChild(externalLocalImportSetting.settingEl);

    const rules = containerEl.createDiv({ cls: "eaglebridge-settings-rule-grid" });
    const createRuleHeader = (column, title, desc, enabled, onChange) => {
      const header = column.createDiv({ cls: "eaglebridge-settings-rule-header" });
      header.createEl("h4", { text: title });
      const toggleMount = header.createDiv({ cls: "eaglebridge-settings-rule-header-toggle" });
      const setting = new Setting(column)
        .addToggle(toggle => toggle
          .setValue(enabled)
          .onChange(onChange));
      toggleMount.appendChild(setting.controlEl);
      setting.settingEl.remove();
      column.createEl("p", { text: desc });
    };

    const tagColumn = rules.createDiv({ cls: "eaglebridge-settings-rule-card" });
    createRuleHeader(
      tagColumn,
      this.plugin.t("tagManagementTitle"),
      this.plugin.t("tagManagementDesc"),
      this.plugin.settings.tagManagementEnabled !== false,
      async value => {
        this.plugin.settings.tagManagementEnabled = value;
        await this.plugin.saveSettings();
        await this.plugin.refreshReferenceViewsForCurrentNote(null, { force: true });
        this.display();
      }
    );

    new Setting(tagColumn)
      .setName(this.plugin.t("settingNoteTagNameTemplateName"))
      .setDesc(this.plugin.t("settingNoteTagNameTemplateDesc"))
      .addText(text => text
        .setPlaceholder("Obsidian-{{title}}-{{created}}")
        .setValue(this.plugin.settings.noteTagNameTemplate || DEFAULT_SETTINGS.noteTagNameTemplate)
        .onChange(async value => {
          this.plugin.settings.noteTagNameTemplate = value.trim() || DEFAULT_SETTINGS.noteTagNameTemplate;
          await this.plugin.saveSettings();
        }));

    new Setting(tagColumn)
      .setName(this.plugin.t("settingCanvasTagNameTemplateName"))
      .setDesc(this.plugin.t("settingCanvasTagNameTemplateDesc"))
      .addText(text => text
        .setPlaceholder("Obsidian-cavs-{{title}}-{{created}}")
        .setValue(this.plugin.settings.canvasTagNameTemplate || DEFAULT_SETTINGS.canvasTagNameTemplate)
        .onChange(async value => {
          this.plugin.settings.canvasTagNameTemplate = value.trim() || DEFAULT_SETTINGS.canvasTagNameTemplate;
          await this.plugin.saveSettings();
        }));

    const rebuildTagsSetting = new Setting(tagColumn)
      .setName(this.plugin.t("settingRebuildAllTagsName"))
      .setDesc(this.plugin.t("settingRebuildAllTagsDesc"))
      .addButton(button => button
        .setButtonText(this.plugin.t("settingRebuildButton"))
        .setWarning()
        .onClick(async () => {
          await this.plugin.confirmAndRebuildAllTags();
        }));
    rebuildTagsSetting.settingEl.addClass("eaglebridge-settings-action-row");

    const folderColumn = rules.createDiv({ cls: "eaglebridge-settings-rule-card" });
    createRuleHeader(
      folderColumn,
      this.plugin.t("folderManagementTitle"),
      this.plugin.t("folderManagementDesc"),
      this.plugin.settings.folderManagementEnabled !== false,
      async value => {
        this.plugin.settings.folderManagementEnabled = value;
        await this.plugin.saveSettings();
        await this.plugin.refreshReferenceViewsForCurrentNote(null, { force: true });
        this.display();
      }
    );

    const folderTreeDescription = document.createDocumentFragment();
    folderTreeDescription.append(`${this.plugin.t("settingUseObsidianFolderTreeDesc")} `);
    const folderTreeWarning = document.createElement("span");
    folderTreeWarning.className = "eaglebridge-settings-inline-warning";
    folderTreeWarning.textContent = this.plugin.t("settingUseObsidianFolderTreeWarning");
    folderTreeDescription.appendChild(folderTreeWarning);

    const folderTreeSetting = new Setting(folderColumn)
      .setName(this.plugin.t("settingUseObsidianFolderTreeName"))
      .setDesc(folderTreeDescription)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useObsidianFolderTree === true)
        .onChange(async value => {
          this.plugin.settings.useObsidianFolderTree = value;
          await this.plugin.saveSettings();
        }));
    folderTreeSetting.settingEl.addClass("eaglebridge-settings-toggle-row");

    new Setting(folderColumn)
      .setName(this.plugin.t("settingFolderNameTemplateName"))
      .setDesc(this.plugin.t("settingFolderNameTemplateDesc"))
      .addText(text => text
        .setPlaceholder("{{title}}-{{created}}")
        .setValue(this.plugin.settings.eagleFolderNameTemplate || DEFAULT_SETTINGS.eagleFolderNameTemplate)
        .onChange(async value => {
          this.plugin.settings.eagleFolderNameTemplate = value.trim() || DEFAULT_SETTINGS.eagleFolderNameTemplate;
          await this.plugin.saveSettings();
        }));

    const rebuildFoldersSetting = new Setting(folderColumn)
      .setName(this.plugin.t("settingRebuildAllFoldersName"))
      .setDesc(this.plugin.t("settingRebuildAllFoldersDesc"))
      .addButton(button => button
        .setButtonText(this.plugin.t("settingRebuildButton"))
        .setWarning()
        .onClick(async () => {
          await this.plugin.confirmAndRebuildAllFolders();
        }));
    rebuildFoldersSetting.settingEl.addClass("eaglebridge-settings-action-row");

    const libraryPathsSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingLibraryPathsName"))
      .setDesc(this.plugin.t("settingLibraryPathsDesc"));
    libraryPathsSetting.settingEl.addClass("eaglebridge-library-paths-setting");
    libraryPathsSetting.controlEl.empty();

    const pathList = libraryPathsSetting.settingEl.createDiv({
      cls: "eaglebridge-library-path-list"
    });
    const saveLibraryPaths = async () => {
      const paths = Array.from(pathList.querySelectorAll("input"))
        .map(input => String(input.value || "").trim())
        .filter(Boolean);
      this.plugin.settings.eagleBridgeLibraryPaths = [...new Set(paths)];
      await this.plugin.saveSettings();
      this.plugin.syncCompanionMediaService().catch(error => {
        console.warn("OE Link media service is not ready:", error);
      });
    };
    const detectLibraryPath = async button => {
      button.disabled = true;
      try {
        const paths = await this.plugin.detectAndFillEagleLibraryPaths();
        renderPathRows();
        showDetectionResult(paths);
      } catch (error) {
        showDetectionResult(null, error);
      } finally {
        button.disabled = false;
      }
    };
    const createPathRow = (path = "") => {
      const row = pathList.createDiv({ cls: "eaglebridge-library-path-row" });
      const input = row.createEl("input", {
        type: "text",
        value: path,
        placeholder: this.plugin.t("settingLibraryPathsPlaceholder")
      });
      input.addEventListener("change", saveLibraryPaths);
      input.addEventListener("blur", saveLibraryPaths);
      const detect = row.createEl("button", {
        text: this.plugin.t("settingAutoDetect"),
        cls: "eaglebridge-inline-detect"
      });
      detect.addEventListener("click", () => detectLibraryPath(detect));
      const remove = row.createEl("button", {
        text: "×",
        cls: "eaglebridge-library-path-remove",
        attr: { "aria-label": this.plugin.t("settingLibraryPathsRemove") }
      });
      remove.addEventListener("click", async () => {
        row.remove();
        await saveLibraryPaths();
      });
      return input;
    };
    const renderPathRows = () => {
      pathList.empty();
      const paths = Array.isArray(this.plugin.settings.eagleBridgeLibraryPaths)
        ? this.plugin.settings.eagleBridgeLibraryPaths
        : [];
      for (const path of paths) createPathRow(path);
    };
    const addPathButton = libraryPathsSetting.controlEl.createEl("button", {
      text: this.plugin.t("settingLibraryPathsAdd"),
      cls: "eaglebridge-library-path-add"
    });
    addPathButton.addEventListener("click", () => {
      createPathRow().focus();
    });
    renderPathRows();
    languageSetting.settingEl.insertAdjacentElement("afterend", connectionModeSetting.settingEl);
    connectionModeSetting.settingEl.insertAdjacentElement("afterend", helperPluginSetting.settingEl);
    helperPluginSetting.settingEl.insertAdjacentElement("afterend", libraryPathsSetting.settingEl);
    libraryPathsSetting.settingEl.insertAdjacentElement("afterend", apiSetting.settingEl);
    apiSetting.settingEl.insertAdjacentElement("afterend", bridgeSetting.settingEl);
    bridgeSetting.settingEl.insertAdjacentElement("afterend", attachmentCard);
    attachmentCard.insertAdjacentElement("afterend", rules);

    const templateSetting = addTextSetting({
      name: this.plugin.t("settingTemplateName"),
      desc: this.plugin.t("settingTemplateDesc"),
      placeholder: DEFAULT_SETTINGS.replacementTemplate,
      value: this.plugin.settings.replacementTemplate,
      onChange: async value => {
          this.plugin.settings.replacementTemplate = value.trim() || DEFAULT_SETTINGS.replacementTemplate;
          await this.plugin.saveSettings();
      }
    });
    attachmentCard.appendChild(templateSetting.settingEl);

    const normalizeReferencesSetting = new Setting(attachmentCard)
      .setName(this.plugin.t("settingNormalizeAllReferencesName"))
      .setDesc(this.plugin.t("settingNormalizeAllReferencesDesc"))
      .addButton((button) => button
        .setButtonText(this.plugin.t("settingNormalizeAllReferencesButton"))
        .onClick(async () => {
          await this.plugin.confirmAndNormalizeAllEagleReferenceLabels();
        }));
    normalizeReferencesSetting.settingEl.addClass("eaglebridge-settings-action-row");

    new Setting(containerEl)
      .setName(this.plugin.t("settingBuildName"))
      .setDesc(this.plugin.t("settingBuildDesc", { version: this.plugin.manifest.version }));

    new Setting(containerEl)
      .setName(this.plugin.t("settingDesktopDiagnosticName"))
      .setDesc(this.plugin.t("settingDesktopDiagnosticDesc"))
      .addButton(button => button
        .setButtonText(this.plugin.t("settingDesktopDiagnosticButton"))
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.exportDesktopDiagnosticLog();
          } catch (error) {
            new Notice(this.plugin.t("noticeDesktopDiagnosticFailed", { error: error && error.message ? error.message : error }));
          } finally {
            button.setDisabled(false);
          }
        }));
  }
};
}

module.exports = { createEagleAssetsSettingTab };
