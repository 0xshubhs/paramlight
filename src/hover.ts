import * as vscode from 'vscode';
import type { DefKind, Mark } from './analysis/types';

const LABELS: Readonly<Record<DefKind, string>> = {
	param: 'Parameter',
	self: 'Receiver',
	local: 'Local',
	moduleLocal: 'Module binding',
	field: 'Field',
	readonlyField: 'Readonly field',
	constant: 'Constant',
	global: 'Global (mutable)',
};

const ICONS: Readonly<Record<DefKind, string>> = {
	param: 'symbol-parameter',
	self: 'symbol-variable',
	local: 'symbol-variable',
	moduleLocal: 'symbol-variable',
	field: 'symbol-field',
	readonlyField: 'symbol-field',
	constant: 'symbol-constant',
	global: 'globe',
};

/** Builds the hover for the marks covering a position; shadow warnings come first. */
export function renderHover(marks: readonly Mark[], uri: vscode.Uri): vscode.MarkdownString | undefined {
	if (marks.length === 0) {
		return undefined;
	}
	const md = new vscode.MarkdownString(undefined, true);
	const ordered = [...marks].sort((a, b) => Number(b.kind === 'shadow') - Number(a.kind === 'shadow'));
	const seen = new Set<string>();
	for (const mark of ordered) {
		const { info } = mark;
		const key = `${mark.kind}|${info.kind}|${info.line}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		if (seen.size > 1) {
			md.appendMarkdown('\n\n---\n\n');
		}
		if (mark.kind === 'shadow' && info.shadows) {
			const s = info.shadows;
			md.appendMarkdown(`$(warning) **Shadows** ${LABELS[s.kind].toLowerCase()} \`${code(qualified(s.name, s.owner))}\``);
			md.appendMarkdown(` declared on ${lineLink(uri, s.line)}`);
			continue;
		}
		md.appendMarkdown(`$(${ICONS[info.kind]}) **${LABELS[info.kind]}** `);
		if (info.kind === 'param') {
			md.appendMarkdown(`\`${code(info.name)}\` of \`${code(info.owner ? `${info.owner}()` : 'anonymous function')}\``);
		} else {
			md.appendMarkdown(`\`${code(qualified(info.name, info.owner))}\``);
		}
		const details: string[] = [];
		if (info.type) {
			details.push(`type \`${code(info.type)}\``);
		}
		if (info.value) {
			details.push(`value \`${code(info.value)}\``);
		}
		details.push(`declared on ${lineLink(uri, info.line)}`);
		md.appendMarkdown(`\n\n${details.join(' · ')}`);
	}
	return md;
}

function qualified(name: string, owner: string | undefined): string {
	return owner ? `${owner}.${name}` : name;
}

function lineLink(uri: vscode.Uri, line: number): string {
	return `[line ${line + 1}](${uri.with({ fragment: `L${line + 1}` }).toString()})`;
}

/** Keeps user text from breaking out of an inline code span. */
function code(text: string): string {
	return text.replace(/`/g, "'");
}
