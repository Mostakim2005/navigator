import { ItemView, Menu, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from 'obsidian';
import { normalizePath } from '@navigation-suite/shared';
import type NavigatorPlugin from './main';
import type { FileRecord } from '@navigation-suite/contracts';
import { ConfirmModal, TextPromptModal } from './ui-modals';

export const NAVIGATOR_VIEW_TYPE = 'navigation-suite-navigator';

type Source = { type: 'folder'; id: string } | { type: 'tag'; id: string };

type FileListItem = {
	path: string;
	name: string;
	modified: number | null;
};

const ROW_HEIGHT = 56;
const OVERSCAN_ROWS = 8;
const SEARCH_DEBOUNCE_MS = 80;
const REFRESH_DEBOUNCE_MS = 40;

export class NavigatorView extends ItemView {
	private readonly rootEl = this.contentEl.createDiv({ cls: 'ns-navigator' });
	private navigationEl!: HTMLElement;
	private listEl!: HTMLElement;
	private fileScroller!: HTMLElement;
	private fileContent!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private currentSource: Source = { type: 'folder', id: '' };
	private searchQuery = '';
	private refreshTimer: number | null = null;
	private searchTimer: number | null = null;
	private renderController = new AbortController();
	private shellController = new AbortController();
	private disposers: Array<() => void> = [];
	private readonly expandedFolders = new Set<string>(['']);
	private readonly selectedPaths = new Set<string>();
	private selectionAnchor: string | null = null;
	private visibleFilePaths: string[] = [];
	private sortedFiles: FileListItem[] = [];

	constructor(leaf: WorkspaceLeaf, private readonly plugin: NavigatorPlugin) {
		super(leaf);
	}

	getViewType(): string { return NAVIGATOR_VIEW_TYPE; }
	getDisplayText(): string { return 'Navigator'; }
	getIcon(): string { return 'folder-tree'; }

	async onOpen(): Promise<void> {
		this.buildShell();
		this.subscribeToEngine();
		this.render();
	}

	async onClose(): Promise<void> {
		this.cancelRefresh();
		this.cancelSearch();
		this.renderController.abort();
		this.shellController.abort();
		for (const dispose of this.disposers.splice(0)) dispose();
		this.contentEl.empty();
	}

	refresh(): void {
		if (this.refreshTimer !== null) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.render();
		}, REFRESH_DEBOUNCE_MS);
	}

	private buildShell(): void {
		this.contentEl.empty();
		const app = this.rootEl;
		app.empty();

		const header = app.createDiv({ cls: 'ns-navigator-header' });
		header.createEl('div', { cls: 'ns-navigator-title', text: 'Navigator' });
		const actions = header.createDiv({ cls: 'ns-navigator-actions' });

		const searchButton = actions.createEl('button', {
			cls: 'ns-icon-button',
			attr: { 'aria-label': 'Search files', type: 'button' },
		});
		setIcon(searchButton, 'search');
		searchButton.addEventListener('click', () => {
			this.searchInput.focus();
			this.searchInput.select();
		}, { signal: this.shellController.signal });

		const refreshButton = actions.createEl('button', {
			cls: 'ns-icon-button',
			attr: { 'aria-label': 'Refresh navigator', type: 'button' },
		});
		setIcon(refreshButton, 'refresh-cw');
		refreshButton.addEventListener('click', () => this.refresh(), { signal: this.shellController.signal });

		const searchWrap = app.createDiv({ cls: 'ns-search-wrap' });
		this.searchInput = searchWrap.createEl('input', {
			type: 'search',
			cls: 'ns-search-input',
			attr: { placeholder: 'Search files…', 'aria-label': 'Search files' },
		}) as HTMLInputElement;
		this.searchInput.addEventListener('input', () => {
			this.searchQuery = this.searchInput.value;
			this.clearSelection();
			this.scheduleSearchRender();
		}, { signal: this.shellController.signal });
		this.searchInput.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.searchInput.value = '';
			this.searchQuery = '';
			this.clearSelection();
			this.cancelSearch();
			this.prepareFileList();
			this.fileScroller.scrollTop = 0;
			this.renderFileWindow();
			this.searchInput.blur();
		}, { signal: this.shellController.signal });

		const body = app.createDiv({ cls: 'ns-navigator-body' });
		this.navigationEl = body.createDiv({ cls: 'ns-navigation-pane', attr: { 'aria-label': 'Navigation', role: 'tree' } });
		this.listEl = body.createDiv({ cls: 'ns-list-pane', attr: { 'aria-label': 'Files' } });
		this.listEl.tabIndex = 0;
		this.listEl.addEventListener('keydown', (event) => this.handleListKeydown(event), { signal: this.shellController.signal });

		this.fileScroller = this.listEl.createDiv({ cls: 'ns-file-scroller', attr: { role: 'listbox', 'aria-multiselectable': 'true' } });
		this.fileContent = this.fileScroller.createDiv({ cls: 'ns-file-content' });
		this.fileScroller.addEventListener('scroll', () => this.renderFileWindow(), { passive: true, signal: this.shellController.signal });
	}

	private subscribeToEngine(): void {
		const fullRefreshEvents = ['index-ready', 'folder-changed'] as const;
		for (const event of fullRefreshEvents) {
			const dispose = this.plugin.engine.subscribe(event, () => this.refresh());
			if (dispose) this.disposers.push(dispose);
		}
		for (const event of ['file-updated', 'file-removed', 'tag-changed', 'property-changed'] as const) {
			const dispose = this.plugin.engine.subscribe(event, () => this.refreshListAndNavigationIfNeeded(event));
			if (dispose) this.disposers.push(dispose);
		}
	}

	private refreshListAndNavigationIfNeeded(event: 'file-updated' | 'file-removed' | 'tag-changed' | 'property-changed'): void {
		if (event === 'tag-changed' || event === 'property-changed') {
			this.refresh();
			return;
		}
		this.refresh();
	}

	private render(): void {
		this.renderController.abort();
		this.renderController = new AbortController();
		this.renderNavigation();
		this.prepareFileList();
		this.renderFileWindow();
	}

	private renderNavigation(): void {
		this.navigationEl.empty();
		this.renderShortcuts();
		this.renderRecentNotes();
		this.renderFolderTree();
		if (this.plugin.settings.showTags) this.renderTags();
	}

	private renderShortcuts(): void {
		if (!this.plugin.settings.showShortcuts) return;
		const pinned = this.plugin.getPinnedPaths().filter((path) => {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile || file instanceof TFolder;
		});
		if (pinned.length === 0) return;

		const section = this.createSection('Shortcuts');
		for (const path of pinned) {
			const abstract = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(abstract instanceof TFile || abstract instanceof TFolder)) continue;
			const item = section.createDiv({ cls: 'ns-navigation-item ns-shortcut-item' });
			setIcon(item.createSpan({ cls: 'ns-navigation-leading-icon' }), abstract instanceof TFolder ? 'folder' : 'file-text');
			item.createSpan({ text: abstract instanceof TFolder ? (abstract.path.split('/').pop() || 'Vault') : abstract.basename });
			item.setAttribute('title', abstract.path || 'Vault');
			item.addEventListener('click', () => {
				if (abstract instanceof TFolder) this.selectSource({ type: 'folder', id: abstract.path });
				else void this.openFile(abstract);
			}, { signal: this.renderController.signal });
			this.addPinContextMenu(item, path);
		}
	}

	private renderRecentNotes(): void {
		if (!this.plugin.settings.showRecentNotes) return;
		const recent = this.plugin.getRecentNotes().slice(0, this.plugin.settings.recentNotesCount);
		if (recent.length === 0) return;

		const section = this.createSection('Recent');
		for (const path of recent) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const item = section.createDiv({ cls: 'ns-navigation-item' });
			item.createSpan({ cls: 'ns-navigation-leading-icon', text: '•', attr: { 'aria-hidden': 'true' } });
			item.createSpan({ text: file.basename });
			item.setAttribute('title', file.path);
			item.addEventListener('click', () => void this.openFile(file), { signal: this.renderController.signal });
			this.addPinContextMenu(item, file.path);
		}
	}

	private renderFolderTree(): void {
		const section = this.createSection('Folders');
		this.renderFolderNode(section, '', 0, 'Vault');
	}

	private renderFolderNode(container: HTMLElement, path: string, depth: number, label: string): void {
		const children = this.plugin.engine.getFolderChildren(path);
		const hasChildren = children.folders.length > 0;
		const item = container.createDiv({ cls: 'ns-navigation-item ns-folder-item', attr: { role: 'treeitem', tabindex: '0' } });
		item.style.paddingInlineStart = `${8 + depth * 14}px`;
		item.setAttribute('aria-expanded', String(this.expandedFolders.has(path)));
		item.classList.toggle('is-active', this.currentSource.type === 'folder' && this.currentSource.id === path);

		const chevron = item.createEl('button', {
			cls: 'ns-folder-chevron',
			text: hasChildren ? (this.expandedFolders.has(path) ? '▾' : '›') : ' ',
			attr: { 'aria-label': hasChildren ? (this.expandedFolders.has(path) ? 'Collapse folder' : 'Expand folder') : 'No subfolders', type: 'button' },
		});
		chevron.disabled = !hasChildren;
		chevron.addEventListener('click', (event) => {
			event.stopPropagation();
			if (!hasChildren) return;
			if (this.expandedFolders.has(path)) this.expandedFolders.delete(path);
			else this.expandedFolders.add(path);
			this.render();
		}, { signal: this.renderController.signal });

		const iconWrap = item.createSpan({ cls: 'ns-folder-icon' });
		const icon = this.plugin.powerTools.getFolderIcon(path);
		if (icon) iconWrap.setText(icon);
		else setIcon(iconWrap, 'folder');
		item.createSpan({ cls: 'ns-folder-label', text: label });

		item.addEventListener('click', (event) => {
			if ((event.target as HTMLElement).closest('button')) return;
			this.selectSource({ type: 'folder', id: normalizePath(path) });
		}, { signal: this.renderController.signal });
		item.addEventListener('dblclick', (event) => {
			event.preventDefault();
			if (!hasChildren) return;
			if (this.expandedFolders.has(path)) this.expandedFolders.delete(path);
			else this.expandedFolders.add(path);
			this.render();
		}, { signal: this.renderController.signal });
		item.addEventListener('contextmenu', (event) => this.showFolderMenu(event, path), { signal: this.renderController.signal });
		item.addEventListener('dragover', (event) => {
			event.preventDefault();
			item.addClass('is-drag-target');
		}, { signal: this.renderController.signal });
		item.addEventListener('dragleave', () => item.removeClass('is-drag-target'), { signal: this.renderController.signal });
		item.addEventListener('drop', (event) => {
			event.preventDefault();
			item.removeClass('is-drag-target');
			const raw = event.dataTransfer?.getData('text/plain');
			const dropped = raw ? raw.split('\n').map((value) => value.trim()).filter(Boolean) : [];
			const paths = dropped.length > 0 ? dropped : [...this.selectedPaths];
			void this.moveFilesToFolder(paths, path);
		}, { signal: this.renderController.signal });

		if (!this.expandedFolders.has(path)) return;
		for (const folderPath of children.folders) {
			const folderName = folderPath.split('/').pop() ?? folderPath;
			this.renderFolderNode(container, folderPath, depth + 1, folderName);
		}
	}

	private renderTags(): void {
		const tags = this.plugin.collectTags();
		if (tags.length === 0) return;
		const section = this.createSection('Tags');
		for (const tag of tags) {
			const item = section.createDiv({ cls: 'ns-navigation-item', attr: { role: 'treeitem', tabindex: '0' } });
			setIcon(item.createSpan({ cls: 'ns-navigation-leading-icon' }), 'tags');
			item.createSpan({ text: `#${tag}` });
			item.classList.toggle('is-active', this.currentSource.type === 'tag' && this.currentSource.id === tag);
			item.addEventListener('click', () => this.selectSource({ type: 'tag', id: tag }), { signal: this.renderController.signal });
		}
	}

	private createSection(title: string): HTMLElement {
		const section = this.navigationEl.createDiv({ cls: 'ns-navigation-section' });
		section.createEl('div', { cls: 'ns-section-title', text: title });
		return section.createDiv({ cls: 'ns-section-body' });
	}

	private prepareFileList(): void {
		const files = this.getCurrentFiles();
		const candidates = this.searchQuery.trim()
			? new Set(this.plugin.engine.search({ query: this.searchQuery, sourceType: this.currentSource.type, sourceId: this.currentSource.id, limit: 500 }).map((result) => result.path))
			: null;
		this.sortedFiles = this.sortFiles(candidates ? files.filter((file) => candidates.has(file.path)) : files);
		this.visibleFilePaths = this.sortedFiles.map((file) => file.path);

		const validSelection = new Set(this.visibleFilePaths);
		for (const path of [...this.selectedPaths]) if (!validSelection.has(path)) this.selectedPaths.delete(path);
	}

	private renderFileWindow(): void {
		if (!this.fileScroller || !this.fileContent) return;
		this.renderController.signal.aborted && (this.renderController = new AbortController());
		this.fileContent.empty();

		const header = this.listEl.querySelector('.ns-list-header') ?? this.listEl.createDiv({ cls: 'ns-list-header' });
		header.empty();
		const title = this.currentSource.type === 'tag' ? `#${this.currentSource.id}` : this.currentSource.id || 'Vault';
		header.createEl('div', { cls: 'ns-list-title', text: title });
		header.createSpan({ cls: 'ns-list-count', text: this.selectedPaths.size > 0 ? `${this.selectedPaths.size} selected` : `${this.sortedFiles.length}` });

		if (this.sortedFiles.length === 0) {
			this.fileContent.style.height = '0px';
			this.listEl.querySelector('.ns-empty-state')?.remove();
			this.listEl.createDiv({ cls: 'ns-empty-state', text: this.searchQuery ? 'No matching files.' : 'No files here.' });
			return;
		}
		this.listEl.querySelector('.ns-empty-state')?.remove();

		const totalHeight = this.sortedFiles.length * ROW_HEIGHT;
		this.fileContent.style.height = `${totalHeight}px`;
		const scrollTop = this.fileScroller.scrollTop;
		const viewportHeight = this.fileScroller.clientHeight || ROW_HEIGHT * 12;
		const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
		const end = Math.min(this.sortedFiles.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);

		for (let index = start; index < end; index++) {
			const file = this.sortedFiles[index];
			if (!file) continue;
			const row = this.renderFileRow(this.fileContent, file);
			row.style.position = 'absolute';
			row.style.top = `${index * ROW_HEIGHT}px`;
			row.style.left = '0';
			row.style.right = '0';
		}
	}

	private renderFileRow(container: HTMLElement, file: FileListItem): HTMLElement {
		const selected = this.selectedPaths.has(file.path);
		const row = container.createDiv({ cls: 'ns-file-row', attr: { role: 'option', tabindex: '0', 'aria-selected': String(selected), draggable: 'true', 'data-path': file.path } });
		row.classList.toggle('is-selected', selected);

		const main = row.createDiv({ cls: 'ns-file-main' });
		main.createDiv({ cls: 'ns-file-name', text: file.name });
		main.createDiv({ cls: 'ns-file-path', text: file.path });
		if (file.modified !== null) main.createDiv({ cls: 'ns-file-date', text: new Date(file.modified).toLocaleString() });

		row.addEventListener('dragstart', (event) => {
			const selectedPaths = this.selectedPaths.has(file.path) ? [...this.selectedPaths] : [file.path];
			event.dataTransfer?.setData('text/plain', selectedPaths.join('\n'));
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		}, { signal: this.renderController.signal });
		row.addEventListener('click', (event) => this.handleFileSelection(file.path, event), { signal: this.renderController.signal });
		row.addEventListener('dblclick', (event) => {
			event.preventDefault();
			const vaultFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
			if (vaultFile instanceof TFile) void this.openFile(vaultFile);
		}, { signal: this.renderController.signal });
		row.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			const vaultFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
			if (!(vaultFile instanceof TFile)) return;
			if (!this.selectedPaths.has(file.path)) this.setSelection([file.path], file.path);
			this.showFileMenu(event, vaultFile);
		}, { signal: this.renderController.signal });
		row.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				const vaultFile = this.plugin.app.vault.getAbstractFileByPath(file.path);
				if (vaultFile instanceof TFile) void this.openFile(vaultFile);
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				void this.deleteSelectedFiles();
			}
		}, { signal: this.renderController.signal });
		return row;
	}

	private getCurrentFiles(): FileListItem[] {
		if (this.currentSource.type === 'folder') {
			return this.plugin.engine.getFolderChildren(this.currentSource.id).files
				.map((path) => this.plugin.engine.getFile(path))
				.filter((file): file is FileRecord => file !== null)
				.map((file) => ({ path: file.path, name: file.name, modified: file.modified }));
		}
		return this.plugin.engine.getFilesForTag(this.currentSource.id)
			.map((path) => this.plugin.engine.getFile(path))
			.filter((file): file is FileRecord => file !== null)
			.map((file) => ({ path: file.path, name: file.name, modified: file.modified }));
	}

	private sortFiles(files: readonly FileListItem[]): FileListItem[] {
		return [...files].sort((left, right) => {
			switch (this.plugin.settings.sortMode) {
				case 'name-desc': return right.name.localeCompare(left.name, undefined, { numeric: true, sensitivity: 'base' });
				case 'modified-desc': return (right.modified ?? 0) - (left.modified ?? 0) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
				case 'modified-asc': return (left.modified ?? 0) - (right.modified ?? 0) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
				case 'name-asc':
				default: return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
			}
		});
	}

	private selectSource(source: Source): void {
		this.currentSource = source;
		this.searchQuery = '';
		this.searchInput.value = '';
		this.cancelSearch();
		this.clearSelection();
		this.fileScroller.scrollTop = 0;
		this.render();
	}

	private handleFileSelection(path: string, event: MouseEvent): void {
		const modifier = event.ctrlKey || event.metaKey;
		if (event.shiftKey && this.selectionAnchor) {
			const anchorIndex = this.visibleFilePaths.indexOf(this.selectionAnchor);
			const targetIndex = this.visibleFilePaths.indexOf(path);
			if (anchorIndex !== -1 && targetIndex !== -1) {
				const start = Math.min(anchorIndex, targetIndex);
				const end = Math.max(anchorIndex, targetIndex);
				this.setSelection(this.visibleFilePaths.slice(start, end + 1), path, modifier);
			}
		} else if (modifier) {
			const next = new Set(this.selectedPaths);
			if (next.has(path)) next.delete(path); else next.add(path);
			this.selectedPaths.clear();
			for (const item of next) this.selectedPaths.add(item);
			this.selectionAnchor = path;
		} else {
			this.setSelection([path], path);
		}
		this.renderFileWindow();
	}

	private setSelection(paths: readonly string[], anchor: string | null, additive = false): void {
		if (!additive) this.selectedPaths.clear();
		for (const path of paths) this.selectedPaths.add(path);
		this.selectionAnchor = anchor;
	}

	private clearSelection(): void {
		this.selectedPaths.clear();
		this.selectionAnchor = null;
	}

	private handleListKeydown(event: KeyboardEvent): void {
		if (this.visibleFilePaths.length === 0) return;
		const currentIndex = this.selectionAnchor ? this.visibleFilePaths.indexOf(this.selectionAnchor) : -1;

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			const nextIndex = Math.max(0, Math.min(this.visibleFilePaths.length - 1, currentIndex + delta));
			const nextPath = this.visibleFilePaths[nextIndex];
			if (!nextPath) return;
			this.setSelection([nextPath], nextPath);
			this.scrollToPath(nextPath);
			return;
		}

		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			this.setSelection(this.visibleFilePaths, this.visibleFilePaths[0] ?? null);
			this.renderFileWindow();
			return;
		}

		if (event.key === 'Enter' && this.selectedPaths.size > 0) {
			event.preventDefault();
			const path = [...this.selectedPaths][0];
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) void this.openFile(file);
		}

		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			void this.deleteSelectedFiles();
		}
	}

	private scrollToPath(path: string): void {
		const index = this.visibleFilePaths.indexOf(path);
		if (index < 0) return;
		const top = index * ROW_HEIGHT;
		const bottom = top + ROW_HEIGHT;
		const viewportTop = this.fileScroller.scrollTop;
		const viewportBottom = viewportTop + this.fileScroller.clientHeight;
		if (top < viewportTop) this.fileScroller.scrollTop = top;
		else if (bottom > viewportBottom) this.fileScroller.scrollTop = bottom - this.fileScroller.clientHeight;
		this.renderFileWindow();
		this.focusSelectedRow();
	}

	private focusSelectedRow(): void {
		const path = this.selectionAnchor;
		if (!path) return;
		const row = [...this.fileContent.querySelectorAll<HTMLElement>('[data-path]')].find((element) => element.dataset.path === path);
		row?.focus();
	}

	private showFolderMenu(event: MouseEvent, path: string): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle('Open folder').setIcon('folder').onClick(() => this.selectSource({ type: 'folder', id: path })));
		menu.addItem((item) => item.setTitle(this.plugin.isPinned(path) ? 'Remove from shortcuts' : 'Add to shortcuts').setIcon('bookmark').onClick(() => void this.plugin.togglePinned(path)));
		if (this.plugin.powerTools.available && this.plugin.powerTools.capabilities?.folderNotes && path) {
			menu.addItem((item) => item.setTitle('Create/open folder note').setIcon('file-plus').onClick(() => void this.plugin.powerTools.createFolderNote(path)));
		}
		menu.showAtMouseEvent(event);
	}

	private addPinContextMenu(element: HTMLElement, path: string): void {
		element.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(this.plugin.isPinned(path) ? 'Remove from shortcuts' : 'Add to shortcuts').setIcon('bookmark').onClick(() => void this.plugin.togglePinned(path)));
			menu.showAtMouseEvent(event);
		}, { signal: this.renderController.signal });
	}

	private showFileMenu(event: MouseEvent, file: TFile): void {
		const selected = [...this.selectedPaths]
			.map((path) => this.plugin.app.vault.getAbstractFileByPath(path))
			.filter((abstract): abstract is TFile => abstract instanceof TFile);
		const files = selected.length > 0 ? selected : [file];
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(files.length > 1 ? `Open ${files.length} files` : 'Open').setIcon('file-text').onClick(() => {
			for (const target of files) void this.openFile(target);
		}));
		menu.addItem((item) => item.setTitle('Open in new tab').setIcon('external-link').onClick(() => void this.plugin.app.workspace.getLeaf('tab').openFile(file)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.plugin.isPinned(file.path) ? 'Remove from shortcuts' : 'Add to shortcuts').setIcon('bookmark').onClick(() => void this.plugin.togglePinned(file.path)));
		menu.addItem((item) => item.setTitle('Rename').setIcon('pencil').onClick(() => void this.renameFile(file)));
		menu.addItem((item) => item.setTitle(files.length > 1 ? `Delete ${files.length} files` : 'Delete').setIcon('trash').onClick(() => void this.deleteSelectedFiles()));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle('Reveal in file explorer').setIcon('folder-open').onClick(() => this.reveal(file)));
		menu.showAtMouseEvent(event);
	}

	private renameFile(file: TFile): Promise<void> {
		return new Promise((resolve) => {
			new TextPromptModal(this.plugin.app, 'Rename file', file.basename, (nextName) => {
				void this.performRename(file, nextName).finally(resolve);
			}).open();
		});
	}

	private async performRename(file: TFile, nextName: string): Promise<void> {
		const clean = nextName.trim().replace(/[\\/:]/g, '-');
		if (!clean || clean === file.basename) return;
		const extension = file.extension ? `.${file.extension}` : '';
		const destination = normalizePath(file.parent?.path ? `${file.parent.path}/${clean}${extension}` : `${clean}${extension}`);
		if (this.plugin.app.vault.getAbstractFileByPath(destination)) {
			new Notice('A file already exists with that name.');
			return;
		}
		await this.plugin.app.vault.rename(file, destination);
		this.clearSelection();
		this.refresh();
	}

	private async deleteSelectedFiles(): Promise<void> {
		const files = [...this.selectedPaths]
			.map((path) => this.plugin.app.vault.getAbstractFileByPath(path))
			.filter((abstract): abstract is TFile => abstract instanceof TFile);
		if (files.length === 0) return;
		if (this.plugin.settings.confirmBeforeDelete) {
			const description = files.length === 1 ? `Delete “${files[0]?.basename ?? ''}”?` : `Delete ${files.length} selected files?`;
			new ConfirmModal(this.plugin.app, 'Delete files', `${description} This cannot be undone.`, () => { void this.performDelete(files); }).open();
			return;
		}
		await this.performDelete(files);
	}

	private async performDelete(files: readonly TFile[]): Promise<void> {
		for (const file of files) await this.plugin.app.vault.trash(file, true);
		this.clearSelection();
		this.refresh();
	}

	private async moveFilesToFolder(paths: readonly string[], folderPath: string): Promise<void> {
		const unique = [...new Set(paths)];
		const target = folderPath ? normalizePath(folderPath) : '';
		for (const path of unique) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const destination = normalizePath(target ? `${target}/${file.name}` : file.name);
			if (destination === file.path) continue;
			if (this.plugin.app.vault.getAbstractFileByPath(destination)) {
				new Notice(`Cannot move “${file.basename}”: a file with that name already exists.`);
				continue;
			}
			await this.plugin.app.vault.rename(file, destination);
		}
		this.clearSelection();
		this.refresh();
	}

	private async openFile(file: TFile): Promise<void> {
		this.plugin.recordRecentNote(file.path);
		await this.plugin.app.workspace.getLeaf(this.plugin.settings.dualPane ? true : false).openFile(file);
	}

	private reveal(file: TFile): void {
		const fileExplorer = this.plugin.app.workspace.getLeavesOfType('file-explorer')[0];
		if (!fileExplorer) {
			new Notice('The core file explorer is not open.');
			return;
		}
		void fileExplorer.openFile(file);
	}

	private scheduleSearchRender(): void {
		this.cancelSearch();
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = null;
			this.prepareFileList();
			this.fileScroller.scrollTop = 0;
			this.renderFileWindow();
		}, SEARCH_DEBOUNCE_MS);
	}

	private cancelSearch(): void {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
		this.searchTimer = null;
	}

	private cancelRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
	}
}
