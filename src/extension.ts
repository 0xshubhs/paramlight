import * as vscode from 'vscode';
import { LANGUAGE_IDS } from './analysis/languages';
import { CodeAnalyzer } from './analysis/parser';
import type { Mark } from './analysis/types';
import { SECTION, documentSettings, formatSettings } from './config';
import { Controller } from './controller';
import { enabled } from './decorations';
import { FormatProvider } from './format/provider';
import { renderHover } from './hover';

/** Returned from `activate` so integration tests can observe the analysis. */
export interface AllCodeVisualApi {
	marksFor(document: vscode.TextDocument): Mark[] | undefined;
	idle(): Promise<void>;
}

const selector: vscode.DocumentSelector = LANGUAGE_IDS.flatMap((language) => [
	{ language, scheme: 'file' },
	{ language, scheme: 'untitled' },
	{ language, scheme: 'vscode-vfs' },
]);

export function activate(context: vscode.ExtensionContext): AllCodeVisualApi {
	const log = vscode.window.createOutputChannel('All Code Visual', { log: true });
	const analyzer = new CodeAnalyzer(context.asAbsolutePath('dist/wasm'));
	const controller = new Controller(analyzer, log);
	const formatter = new FormatProvider(log);
	let formatRegistration: vscode.Disposable | undefined;

	const syncFormatter = (): void => {
		const wanted = vscode.workspace.getConfiguration(SECTION).get<boolean>('format.enable', true);
		if (wanted && !formatRegistration) {
			formatRegistration = vscode.languages.registerDocumentFormattingEditProvider(selector, formatter);
		} else if (!wanted && formatRegistration) {
			formatRegistration.dispose();
			formatRegistration = undefined;
		}
	};
	syncFormatter();

	context.subscriptions.push(
		log,
		controller,
		{ dispose: () => analyzer.dispose() },
		{ dispose: () => formatRegistration?.dispose() },
		vscode.languages.registerHoverProvider(selector, {
			provideHover(document, position) {
				const settings = documentSettings(document);
				const marks = controller.marksFor(document);
				if (!settings.enable || !settings.hover || !marks) {
					return undefined;
				}
				const offset = document.offsetAt(position);
				const hits = marks.filter((m) => m.start <= offset && offset <= m.end && enabled(m.kind, settings));
				const md = renderHover(hits, document.uri);
				if (!md) {
					return undefined;
				}
				const first = hits[0];
				return new vscode.Hover(md, new vscode.Range(document.positionAt(first.start), document.positionAt(first.end)));
			},
		}),
		vscode.commands.registerCommand('allCodeVisual.toggle', async () => {
			const config = vscode.workspace.getConfiguration(SECTION);
			await config.update('enable', !config.get<boolean>('enable', true), vscode.ConfigurationTarget.Global);
		}),
		vscode.commands.registerCommand('allCodeVisual.refresh', () => controller.restyle()),
		vscode.commands.registerCommand('allCodeVisual.showLog', () => log.show()),
		vscode.commands.registerCommand('allCodeVisual.format', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			if (!formatSettings(editor.document).enable) {
				void vscode.window.showInformationMessage('All Code Visual: formatting is disabled ("allCodeVisual.format.enable").');
				return;
			}
			const options: vscode.FormattingOptions = {
				tabSize: Number(editor.options.tabSize) || 4,
				insertSpaces: editor.options.insertSpaces !== false,
			};
			const source = new vscode.CancellationTokenSource();
			try {
				const edits = await formatter.provideDocumentFormattingEdits(editor.document, options, source.token);
				if (edits.length > 0) {
					await editor.edit((builder) => edits.forEach((e) => builder.replace(e.range, e.newText)));
				}
			} finally {
				source.dispose();
			}
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => controller.refreshVisible()),
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.contentChanges.length > 0) {
				controller.onEdit(e.document);
			}
		}),
		vscode.workspace.onDidCloseTextDocument((document) => controller.forget(document)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(SECTION)) {
				syncFormatter();
				controller.restyle();
			}
		}),
	);

	controller.refreshVisible();
	return {
		marksFor: (document) => controller.marksFor(document),
		idle: () => controller.idle(),
	};
}

export function deactivate(): void {
	// Everything is released through context.subscriptions.
}
