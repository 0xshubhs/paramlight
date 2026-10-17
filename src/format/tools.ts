import { type ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface CliTool {
	/** Executable on PATH, or a binary searched in `node_modules/.bin` when `localBin` is set. */
	command: string;
	args: string[];
	/** Exit codes that still mean success (rufo exits 3 when it changed the input). */
	okExitCodes?: number[];
	/** Look the command up in the nearest `node_modules/.bin`; only used in trusted workspaces. */
	localBin?: boolean;
}

export type PrettierParser = 'babel' | 'typescript' | 'php';

export interface BundledTool {
	prettier: PrettierParser;
}

export type FormatTool = CliTool | BundledTool;

const clangFormat: CliTool = { command: 'clang-format', args: ['--assume-filename=${file}'] };
const localPrettier: CliTool = { command: 'prettier', args: ['--stdin-filepath', '${file}'], localBin: true };

/** Tools tried in order for each language; the first one that is installed wins. */
export const DEFAULT_TOOLS: Readonly<Record<string, readonly FormatTool[]>> = {
	javascript: [localPrettier, { prettier: 'babel' }],
	javascriptreact: [localPrettier, { prettier: 'babel' }],
	typescript: [localPrettier, { prettier: 'typescript' }],
	typescriptreact: [localPrettier, { prettier: 'typescript' }],
	php: [{ prettier: 'php' }],
	python: [
		{ command: 'ruff', args: ['format', '--stdin-filename', '${file}', '-'] },
		{ command: 'black', args: ['--quiet', '--stdin-filename', '${file}', '-'] },
	],
	rust: [{ command: 'rustfmt', args: ['--edition', '${rustEdition}', '--emit', 'stdout'] }],
	go: [{ command: 'gofmt', args: [] }],
	c: [clangFormat],
	cpp: [clangFormat],
	csharp: [clangFormat],
	java: [{ command: 'google-java-format', args: ['-'] }, clangFormat],
	ruby: [{ command: 'rufo', args: [], okExitCodes: [0, 3] }],
};

export function isBundled(tool: FormatTool): tool is BundledTool {
	return 'prettier' in tool;
}

export function toolName(tool: FormatTool): string {
	return isBundled(tool) ? 'Prettier (bundled)' : tool.command;
}

export type RunResult =
	| { status: 'ok'; output: string }
	| { status: 'missing' }
	| { status: 'failed'; message: string };

export interface RunOptions {
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Pipes `input` through a formatter on stdin and returns what it writes to stdout. */
export function runTool(command: string, args: string[], input: string, okExitCodes: number[], opts: RunOptions): Promise<RunResult> {
	let child: ChildProcess;
	try {
		child = spawn(command, args, {
			cwd: opts.cwd,
			signal: opts.signal,
			// npm installs `.cmd` shims on Windows, which only run through a shell.
			shell: process.platform === 'win32',
			windowsHide: true,
		});
	} catch (err) {
		return Promise.resolve({ status: 'failed', message: err instanceof Error ? err.message : String(err) });
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: RunResult): void => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({ status: 'failed', message: `${path.basename(command)} timed out after ${opts.timeoutMs} ms` });
		}, opts.timeoutMs);
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
		child.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				finish({ status: 'missing' });
			} else if (err.name === 'AbortError') {
				finish({ status: 'failed', message: 'cancelled' });
			} else {
				finish({ status: 'failed', message: err.message });
			}
		});
		child.on('close', (code) => {
			if (code !== null && okExitCodes.includes(code)) {
				finish({ status: 'ok', output: Buffer.concat(stdout).toString('utf8') });
			} else {
				const message = Buffer.concat(stderr).toString('utf8').trim() || `exited with code ${code}`;
				finish({ status: 'failed', message });
			}
		});
		// A formatter that exits early (bad flags) closes stdin; that error is reported via `close`.
		child.stdin?.on('error', () => undefined);
		child.stdin?.end(input, 'utf8');
	});
}

/** Walks up from `dir` (inclusive) and returns the first existing `name`, stopping at `stopAt`. */
export async function findUp(dir: string, names: readonly string[], stopAt?: string): Promise<string | undefined> {
	let current = path.resolve(dir);
	const stop = stopAt ? path.resolve(stopAt) : undefined;
	for (;;) {
		for (const name of names) {
			const candidate = path.join(current, name);
			try {
				await fs.access(candidate);
				return candidate;
			} catch {
				// keep looking
			}
		}
		const parent = path.dirname(current);
		if (parent === current || current === stop) {
			return undefined;
		}
		current = parent;
	}
}

/** Edition from the nearest `Cargo.toml`; rustfmt defaults to 2015 when reading stdin. */
export async function rustEdition(dir: string): Promise<string> {
	const manifest = await findUp(dir, ['Cargo.toml']);
	if (manifest) {
		const text = await fs.readFile(manifest, 'utf8').catch(() => '');
		const match = /^\s*edition\s*=\s*"(\d{4})"/m.exec(text);
		if (match) {
			return match[1];
		}
	}
	return '2021';
}

export function expandArgs(args: readonly string[], vars: Readonly<Record<string, string>>): string[] {
	return args.map((arg) => arg.replace(/\$\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole));
}

/** Reads a JSON Prettier config (`.prettierrc`, `.prettierrc.json` or `package.json#prettier`). */
export async function prettierConfig(dir: string, stopAt?: string): Promise<Record<string, unknown>> {
	const file = await findUp(dir, ['.prettierrc', '.prettierrc.json', 'package.json'], stopAt);
	if (!file) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
		const config = path.basename(file) === 'package.json' ? (parsed as { prettier?: unknown }).prettier : parsed;
		return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
	} catch {
		// YAML or malformed configs fall back to the editor settings.
		return {};
	}
}
