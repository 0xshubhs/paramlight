import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ParamlightApi } from '../../extension';

const EXTENSION_ID = '0xshubhs.paramlight';
const fixtures = (): string => vscode.workspace.workspaceFolders![0].uri.fsPath;

async function api(): Promise<ParamlightApi> {
	const ext = vscode.extensions.getExtension<ParamlightApi>(EXTENSION_ID);
	assert.ok(ext, 'extension is installed');
	return ext.activate();
}

async function waitFor<T>(probe: () => T | undefined | false, what: string, timeoutMs = 15000): Promise<T> {
	const started = Date.now();
	for (;;) {
		const value = probe();
		if (value) {
			return value;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

async function show(document: vscode.TextDocument): Promise<vscode.TextEditor> {
	const editor = await vscode.window.showTextDocument(document);
	const ext = await api();
	await waitFor(() => (ext.marksFor(document)?.length ?? 0) > 0, `marks for ${document.uri.fsPath}`);
	return editor;
}

function hoverText(hovers: vscode.Hover[]): string {
	return hovers
		.flatMap((h) => h.contents)
		.map((c) => (typeof c === 'string' ? c : c.value))
		.join('\n');
}

function tempFile(name: string, content: string): vscode.Uri {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acv-it-'));
	const file = path.join(dir, name);
	fs.writeFileSync(file, content);
	return vscode.Uri.file(file);
}

suite('Paramlight', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	const cases: Array<[string, string]> = [
		['sample.ts', 'typescript'],
		['sample.py', 'python'],
		['sample.rs', 'rust'],
		['sample.go', 'go'],
		['sample.c', 'c'],
		['sample.cpp', 'cpp'],
		['Sample.java', 'java'],
		['Sample.cs', 'csharp'],
		['sample.php', 'php'],
		['sample.rb', 'ruby'],
	];
	for (const [file, languageId] of cases) {
		test(`decorates ${languageId}`, async () => {
			const document = await vscode.workspace.openTextDocument(path.join(fixtures(), file));
			assert.equal(document.languageId, languageId);
			await show(document);
			const marks = (await api()).marksFor(document)!;
			assert.ok(marks.some((m) => m.kind === 'param'), 'has parameter marks');
			assert.ok(marks.some((m) => m.kind === 'constant'), 'has constant marks');
		});
	}

	test('explains a parameter on hover', async () => {
		const document = await vscode.workspace.openTextDocument(path.join(fixtures(), 'sample.ts'));
		await show(document);
		const line = document.lineAt(15).text;
		const position = new vscode.Position(15, line.indexOf('amountIn') + 2);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
		const text = hoverText(hovers);
		assert.match(text, /\*\*Parameter\*\* `amountIn` of `swap\(\)`/);
		assert.match(text, /type `number`/);
	});

	test('explains shadowing on hover', async () => {
		const document = await vscode.workspace.openTextDocument(path.join(fixtures(), 'sample.py'));
		await show(document);
		const position = new vscode.Position(20, document.lineAt(20).text.indexOf('registry') + 1);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
		assert.match(hoverText(hovers), /\*\*Shadows\*\* global \(mutable\) `registry`/);
	});

	test('honours language-specific settings', async () => {
		const config = vscode.workspace.getConfiguration('paramlight', { languageId: 'python' });
		await config.update('hover.enable', false, vscode.ConfigurationTarget.Global, true);
		try {
			const document = await vscode.workspace.openTextDocument(path.join(fixtures(), 'sample.py'));
			await show(document);
			const position = new vscode.Position(20, document.lineAt(20).text.indexOf('registry') + 1);
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
			assert.doesNotMatch(hoverText(hovers), /Shadows/);
		} finally {
			await config.update('hover.enable', undefined, vscode.ConfigurationTarget.Global, true);
		}
	});

	test('re-analyzes after an edit', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'function f(a: number) { return a; }\n' });
		const editor = await show(document);
		await editor.edit((b) => b.insert(new vscode.Position(1, 0), 'function g(fresh: string) { return fresh; }\n'));
		const ext = await api();
		await waitFor(() => ext.marksFor(document)?.some((m) => m.name === 'fresh'), 'marks after edit');
		assert.equal(ext.marksFor(document)!.filter((m) => m.name === 'fresh').length, 2);
	});

	test('toggle flips the enable setting', async () => {
		const config = () => vscode.workspace.getConfiguration('paramlight');
		const before = config().get<boolean>('enable');
		await vscode.commands.executeCommand('paramlight.toggle');
		try {
			assert.equal(config().get<boolean>('enable'), !before);
		} finally {
			await config().update('enable', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('formats JavaScript with the bundled Prettier using the editor indentation', async () => {
		const document = await vscode.workspace.openTextDocument(tempFile('messy.js', 'const a={b:1,c:[1,2]}\nfunction f( x ){return x}\n'));
		const editor = await vscode.window.showTextDocument(document);
		editor.options = { tabSize: 3, insertSpaces: true };
		await vscode.commands.executeCommand('paramlight.format');
		await waitFor(() => document.getText().includes('const a = { b: 1, c: [1, 2] };'), 'formatted text');
		assert.equal(document.getText(), 'const a = { b: 1, c: [1, 2] };\nfunction f(x) {\n   return x;\n}\n');
	});

	test('a project Prettier config wins over the editor indentation', async () => {
		const uri = tempFile('styled.ts', 'function f( x:number ){return "x"}\n');
		fs.writeFileSync(path.join(path.dirname(uri.fsPath), '.prettierrc'), '{ "tabWidth": 2, "singleQuote": true, "semi": false }');
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('paramlight.format');
		await waitFor(() => document.getText().includes("return 'x'"), 'formatted text');
		assert.equal(document.getText(), "function f(x: number) {\n  return 'x'\n}\n");
	});

	test('formats Go through the formatting provider', async function () {
		const hasGofmt = (process.env.PATH ?? '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, 'gofmt')));
		if (!hasGofmt) {
			this.skip();
		}
		const document = await vscode.workspace.openTextDocument(tempFile('messy.go', 'package a\nfunc  f( ){x:=1\n_=x}\n'));
		await vscode.window.showTextDocument(document);
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
			'vscode.executeFormatDocumentProvider',
			document.uri,
			{ tabSize: 4, insertSpaces: false },
		);
		assert.ok(edits && edits.length > 0, 'formatter returned edits');
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, edits);
		await vscode.workspace.applyEdit(edit);
		assert.equal(document.getText(), 'package a\n\nfunc f() {\n\tx := 1\n\t_ = x\n}\n');
	});
});
