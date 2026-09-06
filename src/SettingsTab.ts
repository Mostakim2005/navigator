import { App, PluginSettingTab, Setting } from 'obsidian';
import type NavigatorPlugin from './main';

export class NavigatorSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: NavigatorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Navigator' });

    new Setting(containerEl)
      .setName('Show shortcuts')
      .setDesc('Show pinned files and folders at the top of the navigation pane.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showShortcuts)
        .onChange(async (value) => {
          this.plugin.settings.showShortcuts = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName('Show tags')
      .setDesc('Show the tag navigation section.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showTags)
        .onChange(async (value) => {
          this.plugin.settings.showTags = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName('Show recent notes')
      .setDesc('Show recently opened notes in the navigation pane.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showRecentNotes)
        .onChange(async (value) => {
          this.plugin.settings.showRecentNotes = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName('Recent notes count')
      .setDesc('Maximum number of recent notes to keep and show.')
      .addSlider((slider) => slider
        .setLimits(1, 20, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.recentNotesCount)
        .onChange(async (value) => {
          this.plugin.settings.recentNotesCount = value;
          await this.plugin.saveSettings();
          this.plugin.refreshView();
        }));

    new Setting(containerEl)
      .setName('Dual pane')
      .setDesc('Show the navigation pane and file list side by side when there is enough room.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.dualPane)
        .onChange(async (value) => {
          this.plugin.settings.dualPane = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Confirm before deleting')
      .setDesc('Ask before deleting selected files from the vault.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.confirmBeforeDelete)
        .onChange(async (value) => {
          this.plugin.settings.confirmBeforeDelete = value;
          await this.plugin.saveSettings();
        }));
  }
}
