import type { App, Plugin } from 'obsidian';
import { POWER_TOOLS_API_VERSION, type PowerToolsApi } from '@navigation-suite/contracts';

interface PowerToolsPluginShape extends Plugin {
	api?: PowerToolsApi;
}

function isCompatibleApiVersion(value: unknown, expected: string): boolean {
	if (typeof value !== 'string') return false;
	return value.split('.')[0] === expected.split('.')[0];
}

function isPowerToolsApi(value: unknown): value is PowerToolsApi {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PowerToolsApi>;
	return !!candidate.capabilities
		&& isCompatibleApiVersion(candidate.capabilities.apiVersion, POWER_TOOLS_API_VERSION)
		&& typeof candidate.getFolderIcon === 'function'
		&& typeof candidate.setFolderIcon === 'function'
		&& typeof candidate.openCalendar === 'function'
		&& typeof candidate.createFolderNote === 'function';
}

export class PowerToolsClient {
	private api: PowerToolsApi | null = null;

	constructor(private readonly app: App) {}

	refresh(): PowerToolsApi | null {
		const plugin = this.app.plugins.getPlugin('power-tools') as PowerToolsPluginShape | undefined;
		this.api = plugin?.api && isPowerToolsApi(plugin.api) ? plugin.api : null;
		return this.api;
	}

	get available(): boolean {
		return this.api !== null || this.refresh() !== null;
	}

	get capabilities() {
		return this.api?.capabilities ?? null;
	}

	openCalendar(): Promise<void> {
		return this.api?.openCalendar() ?? Promise.reject(new Error('Power Tools is not available.'));
	}

	createFolderNote(folderPath: string): Promise<void> {
		return this.api?.createFolderNote(folderPath) ?? Promise.reject(new Error('Power Tools is not available.'));
	}

	getFolderIcon(path: string): string | null {
		return this.api?.getFolderIcon(path) ?? null;
	}
}
