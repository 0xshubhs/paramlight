import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

// Keep in sync with the grammars named in src/analysis/languages.
const GRAMMARS = ['javascript', 'typescript', 'tsx', 'python', 'rust', 'go', 'cpp', 'java', 'c-sharp', 'php', 'ruby'];

async function copyWasm() {
	const source = path.dirname(require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm'));
	const target = path.resolve('dist/wasm');
	await mkdir(target, { recursive: true });
	const files = ['tree-sitter.wasm', ...GRAMMARS.map((g) => `tree-sitter-${g}.wasm`)];
	await Promise.all(files.map((f) => copyFile(path.join(source, f), path.join(target, f))));
}

/** @type {import('esbuild').BuildOptions} */
const shared = {
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node20',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	external: ['vscode'],
	logLevel: 'warning',
};

const builds = [
	{ ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
	// Prettier is large and only needed when formatting, so it is loaded lazily from its own file.
	{ ...shared, entryPoints: ['src/format/prettier.ts'], outfile: 'dist/prettier.js' },
];

await rm('dist', { recursive: true, force: true });
await copyWasm();
if (watch) {
	for (const options of builds) {
		const ctx = await esbuild.context(options);
		await ctx.watch();
	}
	console.log('[watch] build started');
} else {
	await Promise.all(builds.map((options) => esbuild.build(options)));
}
