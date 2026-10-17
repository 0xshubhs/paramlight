import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { CodeAnalyzer } from '../../analysis/parser';
import type { Mark, MarkKind } from '../../analysis/types';

const root = path.resolve(__dirname, '../../..');
const analyzer = new CodeAnalyzer(path.join(root, 'node_modules/@vscode/tree-sitter-wasm/wasm'));
after(() => analyzer.dispose());

interface Result {
	text: string;
	marks: Mark[];
}

async function analyzeText(languageId: string, text: string): Promise<Result> {
	return { text, marks: await analyzer.analyze(languageId, text) };
}

function analyzeFixture(file: string, languageId: string): Promise<Result> {
	return analyzeText(languageId, readFileSync(path.join(root, 'test/fixtures', file), 'utf8'));
}

function lineOf(text: string, offset: number): number {
	return text.slice(0, offset).split('\n').length;
}

/** Marks for `name` on a one-based `line`, optionally filtered by kind. */
function at(r: Result, line: number, name: string, kind?: MarkKind): Mark[] {
	return r.marks.filter((m) => m.name === name && lineOf(r.text, m.start) === line && (!kind || m.kind === kind));
}

function expectMark(r: Result, line: number, name: string, kind: MarkKind, extra: { color?: number; declaration?: boolean } = {}): Mark {
	const found = at(r, line, name, kind);
	assert.ok(found.length > 0, `expected ${kind} mark for "${name}" on line ${line}; got ${describeLine(r, line)}`);
	const mark = found[0];
	if (extra.color !== undefined) {
		assert.equal(mark.colorIndex, extra.color, `color of "${name}" on line ${line}`);
	}
	if (extra.declaration !== undefined) {
		assert.equal(found.some((m) => m.declaration === extra.declaration), true, `declaration flag of "${name}" on line ${line}`);
	}
	return mark;
}

function expectNone(r: Result, line: number, name: string, kind?: MarkKind): void {
	assert.deepEqual(at(r, line, name, kind), [], `expected no ${kind ?? ''} mark for "${name}" on line ${line}`);
}

function describeLine(r: Result, line: number): string {
	const marks = r.marks.filter((m) => lineOf(r.text, m.start) === line);
	return marks.map((m) => `${m.name}:${m.kind}`).join(', ') || 'nothing';
}

/** Every mark must cover exactly the text of its name. */
function expectRangesMatchText(r: Result): void {
	for (const m of r.marks) {
		const slice = r.text.slice(m.start, m.end).replace(/^\$/, '');
		assert.equal(slice, m.name.replace(/^\$/, ''), `range of ${m.kind} mark "${m.name}"`);
	}
}

describe('TypeScript', () => {
	it('colors parameters, boxes members and flags shadowing', async () => {
		const r = await analyzeFixture('sample.ts', 'typescript');
		expectRangesMatchText(r);
		expectMark(r, 1, 'MAX_SUPPLY', 'constant', { declaration: true });
		expectMark(r, 19, 'MAX_SUPPLY', 'constant', { declaration: false });
		expectMark(r, 2, 'counter', 'global');
		expectMark(r, 17, 'counter', 'global');
		expectNone(r, 3, 'helper');
		expectMark(r, 6, 'factory', 'readonlyField');
		expectMark(r, 9, 'VERSION', 'constant');
		expectMark(r, 11, 'weth', 'param', { color: 0 });
		expectMark(r, 11, 'weth', 'readonlyField');
		expectMark(r, 23, 'weth', 'readonlyField');
		expectMark(r, 12, 'factory', 'readonlyField');
		expectMark(r, 12, 'factory', 'param', { color: 1 });
		expectMark(r, 15, 'amountIn', 'param', { color: 0, declaration: true });
		expectMark(r, 15, 'path', 'param', { color: 1 });
		expectMark(r, 15, 'to', 'param', { color: 2 });
		expectMark(r, 16, 'amountIn', 'param', { color: 0, declaration: false });
		expectMark(r, 16, 'reserve', 'field');
		expectMark(r, 16, '#secret', 'field');
		expectMark(r, 18, 'hop', 'param', { color: 0 });
		expectMark(r, 18, 'to', 'param', { color: 2 });
		expectNone(r, 18, 'console');
		const shadow = expectMark(r, 20, 'amountIn', 'shadow');
		assert.equal(shadow.info.shadows?.kind, 'param');
		assert.equal(shadow.info.shadows?.line, 14);
		expectNone(r, 21, 'amountIn', 'param');
		expectMark(r, 27, 'a', 'param', { color: 0 });
		expectMark(r, 29, 'a', 'shadow');
		expectNone(r, 29, 'c');
	});

	it('does not treat property keys, method calls or labels as references', async () => {
		const r = await analyzeText(
			'typescript',
			['class A {', '  run(a: number) {', '    this.run(a);', '    return { a: 1, b: a, a2: { a } };', '  }', '}'].join('\n'),
		);
		expectNone(r, 3, 'run');
		expectMark(r, 3, 'a', 'param');
		assert.equal(at(r, 4, 'a', 'param').length, 2, 'value `a` and shorthand `{ a }` are references; the key is not');
	});

	it('handles JSX and plain JavaScript destructuring', async () => {
		const r = await analyzeText(
			'javascriptreact',
			['function Card({ title, items = [] }, ...rest) {', '  return <List title={title}>{items.map((x) => <li>{x}</li>)}{rest}</List>;', '}'].join('\n'),
		);
		expectMark(r, 2, 'title', 'param', { color: 0 });
		expectMark(r, 2, 'items', 'param', { color: 1 });
		expectMark(r, 2, 'rest', 'param', { color: 2 });
		expectMark(r, 2, 'x', 'param', { color: 0 });
		expectNone(r, 2, 'List');
	});
});

describe('Python', () => {
	it('handles self members, globals, comprehensions and shadowing', async () => {
		const r = await analyzeFixture('sample.py', 'python');
		expectRangesMatchText(r);
		expectMark(r, 1, 'MAX_FEE', 'constant');
		expectMark(r, 19, 'MAX_FEE', 'constant');
		expectMark(r, 2, 'registry', 'global');
		expectMark(r, 14, 'registry', 'global');
		expectNone(r, 7, 'self');
		expectMark(r, 7, 'token0', 'param', { color: 0 });
		expectMark(r, 8, 'token0', 'field');
		expectMark(r, 10, 'reserve', 'field');
		expectMark(r, 15, 'FEE', 'constant');
		expectMark(r, 15, 'reserve', 'field');
		expectMark(r, 12, 'opts', 'param', { color: 3 });
		expectMark(r, 16, 'path', 'param', { color: 1 });
		expectNone(r, 16, 'k');
		expectMark(r, 17, 'amount_in', 'shadow');
		expectMark(r, 19, 'x', 'param', { color: 0 });
		expectMark(r, 19, 'amount_in', 'param', { color: 0 });
		const shadow = expectMark(r, 21, 'registry', 'shadow');
		assert.equal(shadow.info.shadows?.kind, 'global');
	});

	it('ignores keyword names, method calls and attribute names', async () => {
		const r = await analyzeText(
			'python',
			[
				'class C:',
				'    def helper(self):',
				'        pass',
				'    def run(self, x):',
				'        self.helper()',
				'        cb = self.helper',
				'        return f(x=x, y=other.x)',
			].join('\n'),
		);
		expectNone(r, 5, 'helper');
		expectNone(r, 6, 'helper');
		assert.equal(at(r, 7, 'x', 'param').length, 1, 'only the keyword value is the parameter');
	});
});

describe('Rust', () => {
	it('handles self fields, statics, closures and rebinding', async () => {
		const r = await analyzeFixture('sample.rs', 'rust');
		expectRangesMatchText(r);
		expectMark(r, 1, 'MAX', 'constant');
		expectMark(r, 2, 'COUNTER', 'global');
		expectMark(r, 15, 'COUNTER', 'global');
		expectMark(r, 3, 'NAME', 'constant');
		expectMark(r, 6, 'reserve0', 'field');
		expectMark(r, 12, 'reserve0', 'field');
		expectMark(r, 11, 'b', 'param', { color: 2 });
		expectMark(r, 17, 'b', 'param', { color: 2 });
		expectMark(r, 14, 'to', 'param', { color: 3 });
		expectMark(r, 16, 'amount_in', 'param', { color: 0 });
		expectNone(r, 13, 'out', 'shadow');
	});

	it('does not bind enum variants in patterns', async () => {
		const r = await analyzeText('rust', 'fn f(v: Option<u8>) -> u8 { match v { Some(n) => n, None => 0 } }');
		expectMark(r, 1, 'v', 'param');
		assert.equal(r.marks.some((m) => m.name === 'None' || m.name === 'Some'), false);
	});
});

describe('Go', () => {
	it('resolves receivers, package state and redeclared variables', async () => {
		const r = await analyzeFixture('sample.go', 'go');
		expectRangesMatchText(r);
		expectMark(r, 3, 'MaxFee', 'constant');
		expectMark(r, 18, 'MaxFee', 'constant');
		expectMark(r, 5, 'registry', 'global');
		expectMark(r, 17, 'registry', 'global');
		expectMark(r, 8, 'reserve1', 'field');
		expectMark(r, 13, 'reserve0', 'field');
		expectNone(r, 12, 'p');
		expectNone(r, 12, 'out');
		expectMark(r, 14, 'path', 'param', { color: 1 });
		expectMark(r, 20, 'amountIn', 'shadow');
	});

	it('treats `:=` on an existing name as reuse, not a new variable', async () => {
		const r = await analyzeText('go', 'package a\nfunc f() { x, err := g(); y, err := h(); _ = x; _ = y; _ = err }');
		assert.equal(r.marks.filter((m) => m.kind === 'shadow').length, 0);
	});
});

describe('C and C++', () => {
	it('handles macros, globals and pointer parameters in C', async () => {
		const r = await analyzeFixture('sample.c', 'c');
		expectRangesMatchText(r);
		expectMark(r, 2, 'MAX_LEN', 'constant');
		expectMark(r, 8, 'MAX_LEN', 'constant');
		expectMark(r, 3, 'LIMIT', 'constant');
		expectMark(r, 4, 'global_count', 'global');
		expectMark(r, 9, 'cb', 'param', { color: 2 });
		expectMark(r, 9, 'values', 'param', { color: 0 });
		expectMark(r, 13, 'len', 'shadow');
	});

	it('skips prototype parameters', async () => {
		const r = await analyzeText('c', 'int g(int len);\nint len_total = 0;');
		expectNone(r, 1, 'len');
	});

	it('resolves implicit members, this->, init lists and out-of-line methods in C++', async () => {
		const r = await analyzeFixture('sample.cpp', 'cpp');
		expectRangesMatchText(r);
		expectMark(r, 2, 'kMax', 'constant');
		expectMark(r, 7, 'cap_', 'readonlyField');
		expectMark(r, 9, 'balance_', 'field');
		expectMark(r, 10, 'balance_', 'field');
		expectMark(r, 12, 'cap_', 'shadow');
		expectNone(r, 13, 'cap_', 'readonlyField');
		expectMark(r, 19, 'kFee', 'constant');
		expectMark(r, 22, 'balance_', 'field');
		expectMark(r, 22, 'kFee', 'constant');
		expectMark(r, 24, 'y', 'param', { color: 1 });
	});
});

describe('Java and C#', () => {
	it('classifies Java fields by modifiers', async () => {
		const r = await analyzeFixture('Sample.java', 'java');
		expectRangesMatchText(r);
		expectMark(r, 2, 'MAX', 'constant');
		expectMark(r, 18, 'MAX', 'constant');
		expectMark(r, 3, 'name', 'readonlyField');
		expectMark(r, 14, 'name', 'readonlyField');
		expectMark(r, 12, 'count', 'field');
		expectMark(r, 14, 'count', 'field');
		expectNone(r, 7, 'name', 'shadow');
		expectMark(r, 11, 'tags', 'param', { color: 1 });
		expectMark(r, 16, 'step', 'param', { color: 0 });
		expectMark(r, 17, 'count', 'shadow');
		expectNone(r, 18, 'apply');
	});

	it('classifies C# fields, properties and params arrays', async () => {
		const r = await analyzeFixture('Sample.cs', 'csharp');
		expectRangesMatchText(r);
		expectMark(r, 3, 'Max', 'constant');
		expectMark(r, 4, 'name', 'readonlyField');
		expectMark(r, 6, 'Total', 'field');
		expectMark(r, 18, 'Total', 'field');
		expectMark(r, 13, 'tags', 'param', { color: 1 });
		expectMark(r, 16, 'tags', 'param', { color: 1 });
		expectMark(r, 20, 'x', 'param', { color: 0 });
		expectNone(r, 18, 'WriteLine');
	});
});

describe('PHP and Ruby', () => {
	it('handles PHP properties, class constants and isolated function scopes', async () => {
		const r = await analyzeFixture('sample.php', 'php');
		expectRangesMatchText(r);
		expectMark(r, 2, 'MAX_FEE', 'constant');
		expectMark(r, 18, 'MAX_FEE', 'constant');
		expectMark(r, 3, 'MIN_FEE', 'constant');
		expectMark(r, 8, 'token', 'readonlyField');
		expectMark(r, 11, 'token', 'readonlyField');
		expectMark(r, 15, 'FEE', 'constant');
		expectMark(r, 15, 'reserve', 'field');
		expectMark(r, 17, '$amountIn', 'param', { color: 0 });
		expectNone(r, 11, '$this');
	});

	it('handles Ruby instance variables, globals, blocks and constants', async () => {
		const r = await analyzeFixture('sample.rb', 'ruby');
		expectRangesMatchText(r);
		expectMark(r, 1, 'MAX_FEE', 'constant');
		expectMark(r, 15, 'MAX_FEE', 'constant');
		expectMark(r, 13, 'FEE', 'constant');
		expectMark(r, 2, '$registry', 'global');
		expectMark(r, 14, '$registry', 'global');
		expectMark(r, 8, '@token0', 'field');
		expectMark(r, 13, '@reserve', 'field');
		expectMark(r, 12, 'blk', 'param', { color: 4 });
		expectMark(r, 14, 'hop', 'param', { color: 0 });
		expectMark(r, 14, 'amount_in', 'param', { color: 0 });
	});
});

describe('engine', () => {
	it('reports offsets in UTF-16 code units', async () => {
		const r = await analyzeText('javascript', 'function f(a) { const s = "é😀"; return s + a; }');
		expectRangesMatchText(r);
		expectMark(r, 1, 'a', 'param', { declaration: false });
	});

	it('returns nothing for unknown languages and survives syntax errors', async () => {
		assert.deepEqual(await analyzer.analyze('cobol', 'x'), []);
		const r = await analyzeText('python', 'def f(a):\n    return a +\n');
		expectMark(r, 2, 'a', 'param');
	});

	it('analyzes a 20k line file quickly', async () => {
		const fn = (i: number): string =>
			`function f${i}(alpha, beta, { gamma }) {\n  const delta = alpha + beta * gamma;\n  return delta + LIMIT;\n}\n`;
		const text = `const LIMIT = 10;\n${Array.from({ length: 5000 }, (_, i) => fn(i)).join('')}`;
		const started = Date.now();
		const r = await analyzeText('javascript', text);
		const elapsed = Date.now() - started;
		assert.equal(r.marks.filter((m) => m.kind === 'param').length, 5000 * 6);
		assert.ok(elapsed < 5000, `took ${elapsed} ms`);
	});
});
