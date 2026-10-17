import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { LANGUAGE_IDS } from '../../analysis/languages';
import { format } from '../../format/prettier';
import { DEFAULT_TOOLS, type CliTool, expandArgs, findUp, prettierConfig, runTool, rustEdition } from '../../format/tools';

const opts = { cwd: os.tmpdir(), timeoutMs: 10_000 };

function installed(command: string): boolean {
	const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = process.platform === 'win32' ? [`${command}.exe`, `${command}.cmd`] : [command];
	return dirs.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

async function runDefault(languageId: string, input: string, file: string): Promise<string> {
	const tool = DEFAULT_TOOLS[languageId].find((t): t is CliTool => 'command' in t && installed(t.command));
	assert.ok(tool, `no ${languageId} formatter installed`);
	const args = expandArgs(tool.args, { file, rustEdition: '2021' });
	const result = await runTool(tool.command, args, input, tool.okExitCodes ?? [0], opts);
	assert.equal(result.status, 'ok', JSON.stringify(result));
	return result.status === 'ok' ? result.output : '';
}

describe('runTool', () => {
	it('pipes stdin to stdout', async () => {
		const result = await runTool(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], 'héllo 😀', [0], opts);
		assert.deepEqual(result, { status: 'ok', output: 'héllo 😀' });
	});

	it('reports a missing executable', async () => {
		assert.deepEqual(await runTool('definitely-not-a-formatter-xyz', [], '', [0], opts), { status: 'missing' });
	});

	it('reports failures with stderr and honours extra success codes', async () => {
		const failing = await runTool(process.execPath, ['-e', 'console.error("bad input"); process.exit(2)'], '', [0], opts);
		assert.deepEqual(failing, { status: 'failed', message: 'bad input' });
		const changed = await runTool(process.execPath, ['-e', 'process.stdout.write("x"); process.exit(3)'], '', [0, 3], opts);
		assert.deepEqual(changed, { status: 'ok', output: 'x' });
	});

	it('stops a formatter that hangs', async () => {
		const result = await runTool(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], '', [0], { ...opts, timeoutMs: 300 });
		assert.equal(result.status, 'failed');
	});

	it('can be cancelled', async () => {
		const controller = new AbortController();
		const pending = runTool(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], '', [0], { ...opts, signal: controller.signal });
		controller.abort();
		assert.equal((await pending).status, 'failed');
	});
});

describe('tool configuration', () => {
	it('expands placeholders and leaves unknown ones alone', () => {
		assert.deepEqual(expandArgs(['--assume-filename=${file}', '${unknown}'], { file: '/a/b.c' }), ['--assume-filename=/a/b.c', '${unknown}']);
	});

	it('reads the Rust edition from the nearest Cargo.toml', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'acv-'));
		mkdirSync(path.join(dir, 'src'));
		writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\nedition = "2024"\n');
		assert.equal(await rustEdition(path.join(dir, 'src')), '2024');
		assert.equal(await findUp(path.join(dir, 'src'), ['Cargo.toml']), path.join(dir, 'Cargo.toml'));
	});

	it('reads JSON Prettier config from .prettierrc or package.json', async () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'acv-'));
		writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ prettier: { semi: false } }));
		assert.deepEqual(await prettierConfig(dir, dir), { semi: false });
		writeFileSync(path.join(dir, '.prettierrc'), '{ "singleQuote": true }');
		assert.deepEqual(await prettierConfig(dir, dir), { singleQuote: true });
		writeFileSync(path.join(dir, '.prettierrc'), 'singleQuote: true');
		assert.deepEqual(await prettierConfig(dir, dir), {});
	});

	it('has a default formatter for every supported language', () => {
		for (const id of LANGUAGE_IDS) {
			assert.ok(DEFAULT_TOOLS[id]?.length, id);
		}
	});
});

describe('bundled Prettier', () => {
	it('formats JavaScript, TypeScript and PHP', async () => {
		assert.equal(await format('const a={b:1}', 'babel', {}), 'const a = { b: 1 };\n');
		assert.equal(await format('let x:number=1', 'typescript', { tabWidth: 4 }), 'let x: number = 1;\n');
		assert.match(await format('<?php function f($x){return $x;}', 'php', {}), /function f\(\$x\)\n\{\n {4}return \$x;\n\}/);
	});

	it('rejects invalid code instead of returning garbage', async () => {
		await assert.rejects(format('const = ;', 'babel', {}));
	});
});

describe('installed CLI formatters', () => {
	it('formats Python', { skip: !installed('ruff') && !installed('black') && 'ruff/black not installed' }, async () => {
		assert.equal(await runDefault('python', 'x = [1,2,\n3]\n', 'a.py'), 'x = [1, 2, 3]\n');
	});

	it('formats Go', { skip: !installed('gofmt') && 'gofmt not installed' }, async () => {
		assert.equal(await runDefault('go', 'package a\nfunc  f( ){x:=1\n_=x}\n', 'a.go'), 'package a\n\nfunc f() {\n\tx := 1\n\t_ = x\n}\n');
	});

	it('formats Rust', { skip: !installed('rustfmt') && 'rustfmt not installed' }, async () => {
		assert.equal(await runDefault('rust', 'async fn  main( ){let x=1;}', 'a.rs'), 'async fn main() {\n    let x = 1;\n}\n');
	});

	it('formats C', { skip: !installed('clang-format') && 'clang-format not installed' }, async () => {
		assert.match(await runDefault('c', 'int main( ){return 0;}', 'a.c'), /int main\(\) \{/);
	});
});
