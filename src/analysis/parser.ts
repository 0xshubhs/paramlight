import { promises as fs } from 'fs';
import * as path from 'path';
import { Language, Parser } from '@vscode/tree-sitter-wasm';
import { analyze } from './engine';
import { LANGUAGES } from './languages';
import type { Mark } from './types';

/**
 * Loads the tree-sitter runtime and grammars on demand from a directory of
 * `.wasm` files and turns source text into marks.
 */
export class CodeAnalyzer {
	private runtime: Promise<void> | undefined;
	private readonly parsers = new Map<string, Promise<Parser>>();

	constructor(private readonly wasmDir: string) {}

	supports(languageId: string): boolean {
		return languageId in LANGUAGES;
	}

	async analyze(languageId: string, text: string): Promise<Mark[]> {
		const spec = LANGUAGES[languageId];
		if (!spec) {
			return [];
		}
		const parser = await this.parser(spec.grammar);
		const tree = parser.parse(text);
		if (!tree) {
			return [];
		}
		try {
			return analyze(tree.rootNode, spec);
		} finally {
			tree.delete();
		}
	}

	dispose(): void {
		for (const parser of this.parsers.values()) {
			parser.then((p) => p.delete(), () => undefined);
		}
		this.parsers.clear();
	}

	private parser(grammar: string): Promise<Parser> {
		let parser = this.parsers.get(grammar);
		if (!parser) {
			parser = this.load(grammar);
			// A failed load should be retried next time rather than cached.
			parser.catch(() => this.parsers.delete(grammar));
			this.parsers.set(grammar, parser);
		}
		return parser;
	}

	private async load(grammar: string): Promise<Parser> {
		this.runtime ??= Parser.init({ locateFile: () => path.join(this.wasmDir, 'tree-sitter.wasm') }).catch((err) => {
			this.runtime = undefined;
			throw err;
		});
		await this.runtime;
		const bytes = await fs.readFile(path.join(this.wasmDir, `tree-sitter-${grammar}.wasm`));
		const language = await Language.load(new Uint8Array(bytes));
		const parser = new Parser();
		parser.setLanguage(language);
		return parser;
	}
}
