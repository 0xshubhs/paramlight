import type { Ctx, DefKind, LanguageSpec, Node, ParamSite } from '../types';
import { field, isUpperSnake, named } from '../util';

const COMPREHENSIONS = ['list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression'];

function kindAt(ctx: Ctx, name: string): DefKind {
	switch (ctx.level) {
		case 'module':
			return isUpperSnake(name) ? 'constant' : 'global';
		case 'class':
			return isUpperSnake(name) ? 'constant' : 'field';
		default:
			return 'local';
	}
}

function declareTargets(target: Node | null, decl: Node, ctx: Ctx, loopVariable = false): void {
	if (!target) {
		return;
	}
	for (const b of ctx.bindings(target)) {
		const kind = loopVariable && ctx.level === 'module' ? 'moduleLocal' : kindAt(ctx, b.text);
		ctx.declare(b, kind, decl);
	}
}

function isStaticMethod(fn: Node): boolean {
	const wrapper = fn.parent;
	return (
		wrapper?.type === 'decorated_definition' &&
		named(wrapper).some((d) => d.type === 'decorator' && /\bstaticmethod\b/.test(d.text))
	);
}

export const python: LanguageSpec = {
	grammar: 'python',
	functions: new Set(['function_definition', 'lambda', ...COMPREHENSIONS]),
	params(fn, enclosing) {
		const list = field(fn, 'parameters');
		if (!list) {
			return [];
		}
		const sites: ParamSite[] = named(list).map((node) => ({ node }));
		const hasReceiver = fn.type === 'function_definition' && enclosing.inClass && !isStaticMethod(fn);
		if (hasReceiver && sites[0]?.node.type === 'identifier') {
			sites[0] = { ...sites[0], self: true, selfType: enclosing.className };
		}
		return sites;
	},
	functionName(fn) {
		return fn.type === 'lambda' ? 'lambda' : undefined;
	},
	classes: new Set(['class_definition']),
	blocks: new Set(),
	declarations: {
		assignment(node, ctx) {
			declareTargets(field(node, 'left'), node, ctx);
		},
		for_statement(node, ctx) {
			declareTargets(field(node, 'left'), node, ctx, true);
		},
		for_in_clause(node, ctx) {
			declareTargets(field(node, 'left'), node, ctx);
		},
		as_pattern(node, ctx) {
			declareTargets(field(node, 'alias'), node, ctx, true);
		},
		named_expression(node, ctx) {
			declareTargets(field(node, 'name'), node, ctx);
		},
		global_statement(node, ctx) {
			for (const id of named(node)) {
				ctx.markGlobal(id.text);
				ctx.skip(id);
			}
		},
		nonlocal_statement(node, ctx) {
			for (const id of named(node)) {
				ctx.markGlobal(id.text, true);
				ctx.skip(id);
			}
		},
	},
	bindingTypes: new Set(['identifier']),
	skipFields: { '*': ['type', 'value', 'right'] },
	stopTypes: new Set(['attribute', 'subscript']),
	refTypes: new Set(['identifier']),
	nonRefFields: {
		attribute: ['attribute'],
		keyword_argument: ['name'],
		aliased_import: ['name', 'alias'],
	},
	nonRefParents: new Set(['dotted_name', 'import_from_statement', 'import_statement']),
	member(node) {
		if (node.type !== 'attribute') {
			return undefined;
		}
		const object = field(node, 'object');
		const attribute = field(node, 'attribute');
		if (object?.type === 'identifier' && attribute) {
			return { member: attribute, object };
		}
		return undefined;
	},
	implicitMembers: false,
	localsHoisted: true,
};
