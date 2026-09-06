export interface NavigatorSettings {
  showTags: boolean;
  showRecentNotes: boolean;
  showShortcuts: boolean;
  recentNotesCount: number;
  dualPane: boolean;
  sortMode: 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc';
  confirmBeforeDelete: boolean;
}

export const DEFAULT_NAVIGATOR_SETTINGS: NavigatorSettings = {
  showTags: true,
  showRecentNotes: true,
  showShortcuts: true,
  recentNotesCount: 8,
  dualPane: true,
  sortMode: 'name-asc',
  confirmBeforeDelete: true,
};

export function normalizeNavigatorSettings(value: unknown): NavigatorSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_NAVIGATOR_SETTINGS };
  const raw = value as Record<string, unknown>;
  const sortMode = raw.sortMode === 'name-desc' || raw.sortMode === 'modified-desc' || raw.sortMode === 'modified-asc'
    ? raw.sortMode
    : 'name-asc';
  const recentNotesCount = typeof raw.recentNotesCount === 'number' && Number.isFinite(raw.recentNotesCount)
    ? Math.max(1, Math.min(20, Math.floor(raw.recentNotesCount)))
    : DEFAULT_NAVIGATOR_SETTINGS.recentNotesCount;
  return {
    showTags: typeof raw.showTags === 'boolean' ? raw.showTags : DEFAULT_NAVIGATOR_SETTINGS.showTags,
    showRecentNotes: typeof raw.showRecentNotes === 'boolean' ? raw.showRecentNotes : DEFAULT_NAVIGATOR_SETTINGS.showRecentNotes,
    showShortcuts: typeof raw.showShortcuts === 'boolean' ? raw.showShortcuts : DEFAULT_NAVIGATOR_SETTINGS.showShortcuts,
    recentNotesCount,
    dualPane: typeof raw.dualPane === 'boolean' ? raw.dualPane : DEFAULT_NAVIGATOR_SETTINGS.dualPane,
    sortMode,
    confirmBeforeDelete: typeof raw.confirmBeforeDelete === 'boolean' ? raw.confirmBeforeDelete : DEFAULT_NAVIGATOR_SETTINGS.confirmBeforeDelete,
  };
}
