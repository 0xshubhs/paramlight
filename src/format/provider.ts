import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { formatSettings } from '../config';
import {
	type BundledTool,
	type CliTool,
	DEFAULT_TOOLS,
	type FormatTool,
	expandArgs,
	findUp,
	isBundled,
	prettierConfig,
	runTool,
	rustEdition,
	toolName,
} from './tools';

type PrettierModule = typeof import('./prettier');

/**
 * Formats a whole document with the first available tool for its language:
 * a project-local or bundled Prettier, or a CLI formatter fed through stdin.
 */
export class FormatProvider implements vscode.DocumentFormattingEditProvider {
	private prettier: PrettierModule | undefined;
	private readonly warnedMissing = new Set<string>();

	constructor(private readonly log: vscode.LogOutputChannel) {}

	async provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.TextEdit[]> {
		const settings = formatSettings(document);
		if (!settings.enable) {
			return [];
		}
		const tools: readonly FormatTool[] = settings.tools[document.languageId] ?? DEFAULT_TOOLS[document.languageId] ?? [];
		const text = document.getText();
		const abort = new AbortController();
		const cancel = token.onCancellationRequested(() => abort.abort());
		try {
			for (const tool of tools) {
				const result = isBundled(tool)
					? await this.runPrettier(tool, document, options, text)
					: await this.runCli(tool, document, text, settings.timeoutMs, abort.signal);
				if (token.isCancellationRequested) {
					return [];
				}
				if (result.status === 'missing') {
					continue;
				}
				if (result.status === 'failed') {
					this.log.error(`${toolName(tool)} failed on ${document.uri.fsPath}: ${result.message}`);
					vscode.window.setStatusBarMessage(`$(error) ${toolName(tool)}: ${firstLine(result.message)}`, 6000);
					return [];
				}
				this.log.info(`Formatted ${path.basename(document.fileName)} with ${toolName(tool)}`);
				if (result.output === text || (result.output.length === 0 && text.length > 0)) {
					return [];
				}
				const all = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
				return [vscode.TextEdit.replace(all, result.output)];
			}
			this.reportMissing(document.languageId, tools);
			return [];
		} finally {
			cancel.dispose();
		}
	}

	private async runCli(tool: CliTool, document: vscode.TextDocument, text: string, timeoutMs: number, signal: AbortSignal) {
		const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
		const file = document.isUntitled
			? path.join(folder ?? os.tmpdir(), `untitled${extensionFor(document.languageId)}`)
			: document.uri.fsPath;
		const cwd = path.dirname(file);
		let command = tool.command;
		if (tool.localBin) {
			// Running binaries from the project would execute workspace code.
			if (!vscode.workspace.isTrusted) {
				return { status: 'missing' } as const;
			}
			const bin = process.platform === 'win32' ? `${tool.command}.cmd` : tool.command;
			const found = await findUp(cwd, [path.join('node_modules', '.bin', bin)], folder);
			if (!found) {
				return { status: 'missing' } as const;
			}
			command = found;
		}
		const vars: Record<string, string> = { file, fileDirname: cwd, workspaceFolder: folder ?? cwd };
		if (tool.args.some((a) => a.includes('${rustEdition}'))) {
			vars.rustEdition = await rustEdition(cwd);
		}
		return runTool(command, expandArgs(tool.args, vars), text, tool.okExitCodes ?? [0], { cwd, timeoutMs, signal });
	}

	private async runPrettier(tool: BundledTool, document: vscode.TextDocument, options: vscode.FormattingOptions, text: string) {
		try {
			this.prettier ??= require(path.join(__dirname, 'prettier.js')) as PrettierModule;
			const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
			const config = document.isUntitled ? {} : await prettierConfig(path.dirname(document.uri.fsPath), folder);
			const output = await this.prettier.format(text, tool.prettier, {
				tabWidth: options.tabSize,
				useTabs: !options.insertSpaces,
				filepath: document.isUntitled ? undefined : document.uri.fsPath,
				...config,
			});
			return { status: 'ok', output } as const;
		} catch (err) {
			return { status: 'failed', message: err instanceof Error ? err.message : String(err) } as const;
		}
	}

	private reportMissing(languageId: string, tools: readonly FormatTool[]): void {
		if (this.warnedMissing.has(languageId)) {
			return;
		}
		this.warnedMissing.add(languageId);
		const names = tools.filter((t) => !isBundled(t) && !t.localBin).map((t) => `\`${toolName(t)}\``);
		const hint = names.length > 0 ? `Install ${names.join(' or ')}, or ` : '';
		void vscode.window
			.showWarningMessage(`All Code Visual: no formatter found for ${languageId}. ${hint}set "allCodeVisual.format.tools".`, 'Open Settings')
			.then((choice) => {
				if (choice) {
					void vscode.commands.executeCommand('workbench.action.openSettings', 'allCodeVisual.format');
				}
			});
	}
}

function firstLine(text: string): string {
	return text.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? text;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
	javascript: '.js',
	javascriptreact: '.jsx',
	typescript: '.ts',
	typescriptreact: '.tsx',
	python: '.py',
	rust: '.rs',
	go: '.go',
	c: '.c',
	cpp: '.cpp',
	java: '.java',
	csharp: '.cs',
	php: '.php',
	ruby: '.rb',
};

function extensionFor(languageId: string): string {
	return EXTENSIONS[languageId] ?? '';
}
