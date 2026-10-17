import type { Ctx, LanguageSpec, Node } from '../types';
import { field, fields, named } from '../util';

const WRAPPERS = new Set([
	'pointer_declarator',
	'reference_declarator',
	'array_declarator',
	'init_declarator',
	'parenthesized_declarator',
	'attributed_declarator',
]);

function inner(node: Node): Node | null {
	return field(node, 'declarator') ?? node.namedChild(0);
}

/** Follows a declarator chain (`*`, `&`, `[]`, `= value`) down to the function declarator, if any. */
function functionDeclarator(declarator: Node | null): Node | null {
	let d = declarator;
	while (d && d.type !== 'function_declarator' && WRAPPERS.has(d.type)) {
		d = inner(d);
	}
	return d?.type === 'function_declarator' ? d : null;
}

/** A prototype names a function; `int (*fp)(int)` is a variable holding one. */
function isPrototype(declarator: Node): boolean {
	const fd = functionDeclarator(declarator);
	return fd !== null && field(fd, 'declarator')?.type !== 'parenthesized_declarator';
}

function hasPointer(declarator: Node): boolean {
	for (let d: Node | null = declarator; d && WRAPPERS.has(d.type); d = inner(d)) {
		if (d.type === 'pointer_declarator') {
			return true;
		}
	}
	return false;
}

function qualifiers(node: Node): string {
	return named(node)
		.filter((c) => c.type === 'type_qualifier' || c.type === 'storage_class_specifier')
		.map((c) => c.text)
		.join(' ');
}

function skipPrototypeParams(declarator: Node, ctx: Ctx): void {
	for (const p of named(field(functionDeclarator(declarator), 'parameters'))) {
		for (const b of ctx.bindings(p)) {
			ctx.skip(b);
		}
	}
}

function functionDeclaratorOf(fn: Node): Node | null {
	if (fn.type === 'lambda_expression') {
		return field(fn, 'declarator');
	}
	return functionDeclarator(field(fn, 'declarator'));
}

export const cpp: LanguageSpec = {
	grammar: 'cpp',
	functions: new Set(['function_definition', 'lambda_expression']),
	params(fn) {
		return named(field(functionDeclaratorOf(fn), 'parameters'))
			.filter((p) => p.type.endsWith('parameter_declaration'))
			.map((node) => ({ node }));
	},
	functionName(fn) {
		if (fn.type === 'lambda_expression') {
			return undefined;
		}
		const name = field(functionDeclaratorOf(fn), 'declarator');
		if (name?.type === 'qualified_identifier') {
			return field(name, 'name')?.text;
		}
		return name?.text;
	},
	ownerClass(fn) {
		const name = field(functionDeclaratorOf(fn), 'declarator');
		if (name?.type !== 'qualified_identifier') {
			return undefined;
		}
		const scope = field(name, 'scope');
		return scope?.type === 'template_type' ? field(scope, 'name')?.text : scope?.text;
	},
	classes: new Set(['class_specifier', 'struct_specifier', 'union_specifier']),
	blocks: new Set(['compound_statement', 'for_statement', 'for_range_loop', 'catch_clause', 'condition_clause']),
	declarations: {
		declaration(node, ctx) {
			const quals = qualifiers(node);
			for (const declarator of fields(node, 'declarator')) {
				if (isPrototype(declarator)) {
					skipPrototypeParams(declarator, ctx);
					continue;
				}
				let kind: 'constant' | 'global' | 'local' = 'local';
				if (ctx.level === 'module') {
					const immutable = /\bconstexpr\b/.test(quals) || (/\bconst\b/.test(quals) && !hasPointer(declarator));
					kind = immutable ? 'constant' : 'global';
				}
				ctx.declareAll(declarator, kind, node, { visibleFrom: declarator.endIndex });
			}
		},
		field_declaration(node, ctx) {
			const quals = qualifiers(node);
			for (const declarator of fields(node, 'declarator')) {
				if (isPrototype(declarator)) {
					const name = field(functionDeclarator(declarator), 'declarator');
					if (name) {
						ctx.addMethod(name.text);
					}
					skipPrototypeParams(declarator, ctx);
					continue;
				}
				const isConst = /\b(const|constexpr)\b/.test(quals);
				const kind = isConst ? (/\bstatic\b/.test(quals) || /\bconstexpr\b/.test(quals) ? 'constant' : 'readonlyField') : 'field';
				ctx.declareAll(declarator, kind, node);
			}
		},
		preproc_def(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'constant', node);
			}
		},
		for_range_loop(node, ctx) {
			const declarator = field(node, 'declarator');
			if (declarator) {
				ctx.declareAll(declarator, 'local', node, { visibleFrom: field(node, 'right')?.endIndex });
			}
		},
		catch_clause(node, ctx) {
			for (const p of named(field(node, 'parameters'))) {
				ctx.declareAll(p, 'local', node);
			}
		},
	},
	bindingTypes: new Set(['identifier', 'field_identifier']),
	skipFields: { '*': ['type', 'default_value', 'parameters', 'size', 'value', 'arguments'] },
	stopTypes: new Set(['attribute_declaration', 'qualified_identifier']),
	refTypes: new Set(['identifier']),
	nonRefFields: {
		qualified_identifier: ['name'],
		function_declarator: ['declarator'],
		enumerator: ['name'],
		preproc_function_def: ['name'],
	},
	nonRefParents: new Set(['preproc_params', 'namespace_definition', 'using_declaration']),
	member(node) {
		if (node.type === 'field_expression') {
			const argument = field(node, 'argument');
			const member = field(node, 'field');
			if (argument?.type === 'this' && member) {
				return { member, selfKeyword: true };
			}
		} else if (node.type === 'field_initializer') {
			const member = node.namedChild(0);
			if (member?.type === 'field_identifier') {
				return { member, selfKeyword: true };
			}
		}
		return undefined;
	},
	implicitMembers: true,
};

/** C shares the C++ grammar; there are no methods, so bare names never mean fields. */
export const c: LanguageSpec = { ...cpp, implicitMembers: false };
