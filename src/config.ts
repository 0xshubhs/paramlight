import * as vscode from 'vscode';
import type { CliTool } from './format/tools';

export const SECTION = 'paramlight';

export type ArgumentsMode = 'color and symbol' | 'color only' | 'symbol only';

/** Settings that shape the decoration types; they apply to every editor. */
export interface StyleSettings {
	argumentsMode: ArgumentsMode;
	argumentsSuffix: string;
	paletteSize: number;
	overviewRuler: boolean;
}

/** Settings that can differ per language (`"[python]": { ... }`). */
export interface DocumentSettings {
	enable: boolean;
	arguments: boolean;
	fields: boolean;
	constants: boolean;
	globals: boolean;
	shadowing: boolean;
	hover: boolean;
	maxFileSize: number;
}

export interface FormatSettings {
	enable: boolean;
	timeoutMs: number;
	tools: Readonly<Record<string, CliTool[]>>;
}

export function styleSettings(): StyleSettings {
	const c = vscode.workspace.getConfiguration(SECTION);
	return {
		argumentsMode: c.get<ArgumentsMode>('arguments.mode', 'color and symbol'),
		argumentsSuffix: c.get<string>('arguments.suffix', '⬆'),
		paletteSize: clamp(c.get<number>('arguments.paletteSize', 15), 1, 32),
		overviewRuler: c.get<boolean>('overviewRuler.enable', false),
	};
}

export function documentSettings(document: vscode.TextDocument): DocumentSettings {
	const c = vscode.workspace.getConfiguration(SECTION, document);
	return {
		enable: c.get<boolean>('enable', true) && c.get<string[]>('languages', []).includes(document.languageId),
		arguments: c.get<boolean>('arguments.enable', true),
		fields: c.get<boolean>('fields.enable', true),
		constants: c.get<boolean>('constants.enable', true),
		globals: c.get<boolean>('globals.enable', true),
		shadowing: c.get<boolean>('shadowing.enable', true),
		hover: c.get<boolean>('hover.enable', true),
		maxFileSize: c.get<number>('maxFileSize', 1_000_000),
	};
}

export function formatSettings(document: vscode.TextDocument): FormatSettings {
	const c = vscode.workspace.getConfiguration(SECTION, document);
	return {
		enable: c.get<boolean>('format.enable', true),
		timeoutMs: c.get<number>('format.timeout', 10_000),
		tools: c.get<Record<string, CliTool[]>>('format.tools', {}),
	};
}

export function debounceMs(): number {
	return clamp(vscode.workspace.getConfiguration(SECTION).get<number>('debounce', 200), 0, 5000);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}
