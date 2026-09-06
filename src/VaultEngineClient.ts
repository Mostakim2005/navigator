import { TFile, TFolder } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { VAULT_ENGINE_API_VERSION, type FolderChildren, type SearchRequest, type SearchResult, type VaultEngineApi, type VaultEngineEvent, type FileRecord } from '@navigation-suite/contracts';

interface EnginePluginShape extends Plugin {
  api?: VaultEngineApi;
}

function isCompatibleApiVersion(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  return value.split('.')[0] === expected.split('.')[0];
}

function isEngineApi(value: unknown): value is VaultEngineApi {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VaultEngineApi>;
  return typeof candidate.capabilities?.apiVersion === 'string'
    && isCompatibleApiVersion(candidate.capabilities.apiVersion, VAULT_ENGINE_API_VERSION)
    && typeof candidate.getFile === 'function'
    && typeof candidate.getFolderChildren === 'function'
    && typeof candidate.getFilesForTag === 'function'
    && typeof candidate.getAllTags === 'function'
    && typeof candidate.getFilesForProperty === 'function'
    && typeof candidate.search === 'function'
    && typeof candidate.subscribe === 'function';
}

export class VaultEngineClient {
  private api: VaultEngineApi | null = null;

  constructor(private readonly app: App) {}

  refresh(): VaultEngineApi | null {
    const plugin = this.app.plugins.getPlugin('vault-engine') as EnginePluginShape | undefined;
    this.api = plugin?.api && isEngineApi(plugin.api) ? plugin.api : null;
    return this.api;
  }

  get available(): boolean {
    return this.api !== null || this.refresh() !== null;
  }

  getFile(path: string): FileRecord | null {
    const indexed = this.api?.getFile(path);
    if (indexed) return indexed;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file && this.isTFile(file))) return null;
    return {
      path: file.path,
      name: file.basename,
      extension: file.extension,
      parentPath: file.parent?.path ?? null,
      created: file.stat.ctime,
      modified: file.stat.mtime,
      tags: [],
      aliases: [],
    };
  }

  getFolderChildren(path: string): FolderChildren {
    if (this.api) return this.api.getFolderChildren(path);
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder && this.isTFolder(folder))) return { folders: [], files: [] };
    return {
      folders: folder.children.filter((child) => this.isTFolder(child)).map((child) => child.path).sort(this.naturalCompare),
      files: folder.children.filter((child) => this.isTFile(child)).map((child) => child.path).sort(this.naturalCompare),
    };
  }

  getFilesForTag(tag: string): readonly string[] {
    return this.api?.getFilesForTag(tag) ?? [];
  }

  getAllTags(): readonly string[] {
    return this.api?.getAllTags() ?? [];
  }

  getFilesForProperty(key: string, value: string): readonly string[] {
    return this.api?.getFilesForProperty(key, value) ?? [];
  }

  search(request: SearchRequest): readonly SearchResult[] {
    if (this.api) return this.api.search(request);
    const query = request.query.trim().toLocaleLowerCase();
    if (!query) return [];
    const files = request.sourceType === 'folder'
      ? this.getFolderFilesRecursive(request.sourceId ?? '')
      : this.app.vault.getMarkdownFiles();
    const results: SearchResult[] = [];
    for (const file of files) {
      const name = file.basename.toLocaleLowerCase();
      const path = file.path.toLocaleLowerCase();
      const score = name === query ? 100 : name.startsWith(query) ? 80 : name.includes(query) ? 60 : path.includes(query) ? 25 : 0;
      if (score > 0) results.push({ path: file.path, score });
    }
    results.sort((left, right) => right.score - left.score || this.naturalCompare(left.path, right.path));
    return typeof request.limit === 'number' ? results.slice(0, Math.max(0, Math.floor(request.limit))) : results;
  }

  subscribe(event: VaultEngineEvent, listener: () => void): (() => void) | null {
    return this.api?.subscribe(event, listener) ?? null;
  }

  private getFolderFilesRecursive(path: string): TFile[] {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder && this.isTFolder(folder))) return [];
    const files: TFile[] = [];
    const visit = (candidate: TFolder): void => {
      for (const child of candidate.children) {
        if (this.isTFile(child)) files.push(child);
        else if (this.isTFolder(child)) visit(child);
      }
    };
    visit(folder);
    return files;
  }

  private isTFile(value: unknown): value is TFile {
    return value instanceof TFile;
  }

  private isTFolder(value: unknown): value is TFolder {
    return value instanceof TFolder;
  }

  private naturalCompare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  }
}

