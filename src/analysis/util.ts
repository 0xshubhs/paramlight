import type { Node } from './types';

export function named(node: Node | null | undefined): Node[] {
	if (!node) {
		return [];
	}
	const out: Node[] = [];
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i);
		if (child) {
			out.push(child);
		}
	}
	return out;
}

export function field(node: Node | null | undefined, name: string): Node | null {
	return node ? node.childForFieldName(name) : null;
}

export function fields(node: Node | null | undefined, name: string): Node[] {
	return node ? node.childrenForFieldName(name).filter((n): n is Node => n !== null) : [];
}

/** True when a direct child (named or anonymous) has the given type or text. */
export function hasChild(node: Node, ...types: string[]): boolean {
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (child && (types.includes(child.type) || types.includes(child.text))) {
			return true;
		}
	}
	return false;
}

/** Text of the direct children of the given types, joined by spaces. */
export function childText(node: Node, ...types: string[]): string {
	return named(node)
		.filter((c) => types.includes(c.type))
		.map((c) => c.text)
		.join(' ');
}

export function hasWord(text: string, word: string): boolean {
	return new RegExp(`\\b${word}\\b`).test(text);
}

export function isUpperSnake(name: string): boolean {
	return name.length > 1 && /^[A-Z_][A-Z0-9_]*$/.test(name) && /[A-Z]/.test(name);
}

const LITERALS = new Set([
	'number',
	'string',
	'true',
	'false',
	'null',
	'regex',
	'integer',
	'float',
	'integer_literal',
	'float_literal',
	'string_literal',
	'boolean_literal',
	'number_literal',
	'int_literal',
	'interpreted_string_literal',
	'raw_string_literal',
]);

export function isLiteral(node: Node | null | undefined): boolean {
	if (!node) {
		return false;
	}
	if (node.type === 'template_string') {
		return !named(node).some((c) => c.type === 'template_substitution');
	}
	if (node.type === 'unary_expression') {
		return isLiteral(node.namedChild(0));
	}
	return LITERALS.has(node.type);
}

/** Collapses whitespace and trims a snippet for hover text; undefined when too long. */
export function snippet(text: string | undefined, max = 48): string | undefined {
	if (!text) {
		return undefined;
	}
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > 0 && flat.length <= max ? flat : undefined;
}
