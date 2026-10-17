import * as vscode from 'vscode';
import type { CodeAnalyzer } from './analysis/parser';
import type { Mark } from './analysis/types';
import { debounceMs, documentSettings, styleSettings } from './config';
import { DecorationStyles } from './decorations';

interface Entry {
	version: number;
	marks: Mark[];
}

const SKIPPED_SCHEMES = new Set(['output', 'debug', 'vscode-scm', 'comment']);

/** Keeps decorations of visible editors in sync with their documents. */
export class Controller implements vscode.Disposable {
	private styles: DecorationStyles;
	private readonly cache = new Map<string, Entry>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly running = new Map<string, Promise<void>>();

	constructor(
		private readonly analyzer: CodeAnalyzer,
		private readonly log: vscode.LogOutputChannel,
	) {
		this.styles = new DecorationStyles(styleSettings());
	}

	/** Marks for a document at its current version, if they have been computed. */
	marksFor(document: vscode.TextDocument): Mark[] | undefined {
		const entry = this.cache.get(document.uri.toString());
		return entry && entry.version === document.version ? entry.marks : undefined;
	}

	refreshVisible(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.schedule(editor.document, 0);
		}
	}

	restyle(): void {
		this.styles.dispose();
		this.styles = new DecorationStyles(styleSettings());
		this.cache.clear();
		this.refreshVisible();
	}

	onEdit(document: vscode.TextDocument): void {
		if (vscode.window.visibleTextEditors.some((e) => e.document === document)) {
			this.schedule(document, debounceMs());
		}
	}

	forget(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		this.cache.delete(key);
		clearTimeout(this.timers.get(key));
		this.timers.delete(key);
	}

	/** Resolves once no analysis is scheduled or running; used by tests. */
	async idle(): Promise<void> {
		while (this.timers.size > 0 || this.running.size > 0) {
			await Promise.all([...this.running.values()]);
			if (this.timers.size > 0) {
				await new Promise((r) => setTimeout(r, 20));
			}
		}
	}

	private schedule(document: vscode.TextDocument, delay: number): void {
		if (SKIPPED_SCHEMES.has(document.uri.scheme) || !this.analyzer.supports(document.languageId)) {
			return;
		}
		const key = document.uri.toString();
		clearTimeout(this.timers.get(key));
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				const run = this.update(document).finally(() => this.running.delete(key));
				this.running.set(key, run);
			}, delay),
		);
	}

	private async update(document: vscode.TextDocument): Promise<void> {
		const editors = vscode.window.visibleTextEditors.filter((e) => e.document === document);
		const settings = documentSettings(document);
		const text = document.getText();
		if (!settings.enable || text.length > settings.maxFileSize) {
			this.cache.delete(document.uri.toString());
			editors.forEach((e) => this.styles.clear(e));
			return;
		}
		let entry = this.cache.get(document.uri.toString());
		if (!entry || entry.version !== document.version) {
			const version = document.version;
			try {
				const started = Date.now();
				const marks = await this.analyzer.analyze(document.languageId, text);
				this.log.trace(`Analyzed ${document.uri.fsPath} in ${Date.now() - started} ms (${marks.length} marks)`);
				entry = { version, marks };
			} catch (err) {
				this.log.error(`Analysis failed for ${document.uri.toString()}: ${err instanceof Error ? err.stack : String(err)}`);
				return;
			}
			if (document.version !== version || document.isClosed) {
				// The document changed while parsing; the edit has scheduled a fresh run.
				return;
			}
			this.cache.set(document.uri.toString(), entry);
		}
		for (const editor of vscode.window.visibleTextEditors.filter((e) => e.document === document)) {
			this.styles.apply(editor, entry.marks, settings);
		}
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.cache.clear();
		this.styles.dispose();
	}
}
