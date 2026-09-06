import { Plugin, TFolder, TFile, WorkspaceLeaf } from 'obsidian';
import { VaultEngineClient } from './VaultEngineClient';
import { PowerToolsClient } from './PowerToolsClient';
import { NavigatorSettingTab } from './SettingsTab';
import { DEFAULT_NAVIGATOR_SETTINGS, normalizeNavigatorSettings, type NavigatorSettings } from './types';
import { NAVIGATOR_VIEW_TYPE, NavigatorView } from './NavigatorView';

const SETTINGS_VERSION = 2;

interface PersistedNavigatorData {
  version?: number;
  settings?: Partial<NavigatorSettings>;
  recentNotes?: string[];
  pinnedPaths?: string[];
}

export default class NavigatorPlugin extends Plugin {
  settings: NavigatorSettings = { ...DEFAULT_NAVIGATOR_SETTINGS };
  readonly engine = new VaultEngineClient(this.app);
  readonly powerTools = new PowerToolsClient(this.app);
  private recentNotes: string[] = [];
  private pinnedPaths: string[] = [];
  private initialized = false;
  private saveTimer: number | null = null;
  private saveInFlight = false;
  private saveQueued = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.engine.refresh();
    this.powerTools.refresh();

    this.registerView(NAVIGATOR_VIEW_TYPE, (leaf) => new NavigatorView(leaf, this));
    this.addRibbonIcon('folder-tree', 'Open Navigator', () => void this.activateView());
    this.addCommand({ id: 'open', name: 'Open Navigator', callback: () => void this.activateView() });
    this.addCommand({ id: 'refresh', name: 'Refresh Navigator', callback: () => this.refreshView() });
    this.addCommand({
      id: 'open-calendar',
      name: 'Open calendar (Power Tools)',
      checkCallback: (checking) => {
        if (!this.powerTools.available || !this.powerTools.capabilities?.calendar) return false;
        if (!checking) void this.powerTools.openCalendar().catch((error) => console.warn('Navigator: failed to open Power Tools calendar.', error));
        return true;
      },
    });
    this.addCommand({
      id: 'create-folder-note',
      name: 'Create folder note (Power Tools)',
      checkCallback: (checking) => {
        if (!this.powerTools.available || !this.powerTools.capabilities?.folderNotes) return false;
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder) return false;
        if (!checking) void this.powerTools.createFolderNote(folder.path).catch((error) => console.warn('Navigator: failed to create folder note.', error));
        return true;
      },
    });
    this.addSettingTab(new NavigatorSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file instanceof TFile) this.recordRecentNote(file.path);
    }));

    this.registerEvent(this.app.workspace.on('layout-ready', () => {
      if (!this.initialized) return;
      const shouldOpen = this.settings.dualPane && this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE).length === 0;
      if (shouldOpen) void this.activateView();
    }));

    this.initialized = true;
  }

  onunload(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.flushSettingsSave();
    this.app.workspace.detachLeavesOfType(NAVIGATOR_VIEW_TYPE);
  }

  refreshView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof NavigatorView) view.refresh();
    }
  }

  getRecentNotes(): readonly string[] {
    return this.recentNotes;
  }

  getPinnedPaths(): readonly string[] {
    return this.pinnedPaths;
  }

  isPinned(path: string): boolean {
    return this.pinnedPaths.includes(path);
  }

  async togglePinned(path: string): Promise<void> {
    this.pinnedPaths = this.isPinned(path)
      ? this.pinnedPaths.filter((item) => item !== path)
      : [path, ...this.pinnedPaths];
    await this.saveSettings();
    this.refreshView();
  }

  recordRecentNote(path: string): void {
    const next = [path, ...this.recentNotes.filter((item) => item !== path)];
    this.recentNotes = next.slice(0, Math.max(20, this.settings.recentNotesCount));
    void this.saveSettings();
  }

  collectTags(): readonly string[] {
    return this.engine.getAllTags();
  }

  async saveSettings(): Promise<void> {
    this.saveQueued = true;
    if (this.saveInFlight) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSettingsSave();
    }, 50);
  }

  private async flushSettingsSave(): Promise<void> {
    if (this.saveInFlight || !this.saveQueued) return;
    this.saveQueued = false;
    this.saveInFlight = true;
    try {
      const payload: PersistedNavigatorData = {
        version: SETTINGS_VERSION,
        settings: this.settings,
        recentNotes: this.recentNotes.slice(),
        pinnedPaths: this.pinnedPaths.slice(),
      };
      await this.saveData(payload);
    } catch (error) {
      console.warn('Navigator: failed to save settings.', error);
    } finally {
      this.saveInFlight = false;
      if (this.saveQueued) void this.flushSettingsSave();
    }
  }

  private async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as unknown;
    const data = this.normalizePersistedData(raw);
    this.settings = normalizeNavigatorSettings(data.settings);
    this.recentNotes = (data.recentNotes ?? []).filter((path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile);
    this.pinnedPaths = (data.pinnedPaths ?? []).filter((path) => {
      const abstract = this.app.vault.getAbstractFileByPath(path);
      return abstract instanceof TFile || abstract instanceof TFolder;
    });
  }

  private normalizePersistedData(raw: unknown): PersistedNavigatorData {
    if (!raw || typeof raw !== 'object') return { version: SETTINGS_VERSION, settings: {}, recentNotes: [], pinnedPaths: [] };
    const candidate = raw as Record<string, unknown>;
    const version = typeof candidate.version === 'number' ? candidate.version : 0;
    const settingsRaw = candidate.settings;
    const settings = settingsRaw && typeof settingsRaw === 'object' ? settingsRaw as Partial<NavigatorSettings> : {};
    const recentRaw = Array.isArray(candidate.recentNotes) ? candidate.recentNotes : [];
    const pinnedRaw = Array.isArray(candidate.pinnedPaths) ? candidate.pinnedPaths : [];
    const recentNotes = recentRaw.filter((value): value is string => typeof value === 'string');
    const pinnedPaths = pinnedRaw.filter((value): value is string => typeof value === 'string');
    return { version, settings, recentNotes, pinnedPaths };
  }

  private async activateView(): Promise<void> {
    let leaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(NAVIGATOR_VIEW_TYPE)[0];
    if (!leaf) {
      const active = this.app.workspace.getMostRecentLeaf();
      leaf = active ? this.app.workspace.getLeaf('split') : this.app.workspace.getLeaf(true);
    }

    await leaf.setViewState({ type: NAVIGATOR_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
