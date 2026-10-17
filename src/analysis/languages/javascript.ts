import type { Ctx, LanguageSpec, Node } from '../types';
import { field, hasChild, isLiteral, isUpperSnake, named } from '../util';

function declareVariables(node: Node, ctx: Ctx): void {
	const keyword = node.child(0)?.type;
	for (const declarator of named(node)) {
		if (declarator.type !== 'variable_declarator') {
			continue;
		}
		const name = field(declarator, 'name');
		if (!name) {
			continue;
		}
		const opts = { visibleFrom: declarator.endIndex, hoist: keyword === 'var' };
		if (ctx.level === 'module') {
			const constant =
				keyword === 'const' && name.type === 'identifier' && (isUpperSnake(name.text) || isLiteral(field(declarator, 'value')));
			ctx.declareAll(name, constant ? 'constant' : keyword === 'const' ? 'moduleLocal' : 'global', declarator, opts);
		} else {
			ctx.declareAll(name, 'local', declarator, opts);
		}
	}
}

function declareField(node: Node, ctx: Ctx): void {
	const name = field(node, 'name') ?? field(node, 'property');
	if (!name) {
		return;
	}
	const isStatic = hasChild(node, 'static');
	const isReadonly = hasChild(node, 'readonly');
	const kind = isReadonly ? (isStatic ? 'constant' : 'readonlyField') : 'field';
	ctx.declare(name, kind, node);
}

/** TypeScript parameter properties: `constructor(private readonly x: T)` also declares a field. */
function declareParameterProperty(node: Node, ctx: Ctx): void {
	const isProperty = hasChild(node, 'accessibility_modifier', 'override_modifier', 'readonly');
	const pattern = field(node, 'pattern');
	if (isProperty && pattern?.type === 'identifier') {
		ctx.declare(pattern, hasChild(node, 'readonly') ? 'readonlyField' : 'field', node);
	}
}

export const javascript: LanguageSpec = {
	grammar: 'javascript',
	functions: new Set([
		'function_declaration',
		'function_expression',
		'function',
		'arrow_function',
		'method_definition',
		'generator_function_declaration',
		'generator_function',
	]),
	params(fn) {
		const list = field(fn, 'parameters');
		if (list) {
			return named(list)
				.filter((p) => p.type !== 'comment')
				.map((node) => ({ node }));
		}
		const single = field(fn, 'parameter');
		return single ? [{ node: single }] : [];
	},
	classes: new Set(['class_declaration', 'class', 'abstract_class_declaration']),
	blocks: new Set(['statement_block', 'for_statement', 'for_in_statement', 'catch_clause', 'switch_body', 'class_static_block']),
	declarations: {
		lexical_declaration: declareVariables,
		variable_declaration: declareVariables,
		field_definition: declareField,
		public_field_definition: declareField,
		required_parameter: declareParameterProperty,
		optional_parameter: declareParameterProperty,
		for_in_statement(node, ctx) {
			if (field(node, 'kind')) {
				ctx.declareAll(field(node, 'left')!, 'local', node, { visibleFrom: field(node, 'right')?.endIndex });
			}
		},
		catch_clause(node, ctx) {
			const param = field(node, 'parameter');
			if (param) {
				ctx.declareAll(param, 'local', node);
			}
		},
	},
	bindingTypes: new Set(['identifier', 'shorthand_property_identifier_pattern']),
	skipFields: {
		'*': ['type', 'decorator', 'return_type'],
		required_parameter: ['value'],
		optional_parameter: ['value'],
		assignment_pattern: ['right'],
		object_assignment_pattern: ['right'],
		pair_pattern: ['key'],
		variable_declarator: ['value'],
	},
	refTypes: new Set(['identifier', 'shorthand_property_identifier']),
	nonRefFields: {
		jsx_opening_element: ['name'],
		jsx_closing_element: ['name'],
		jsx_self_closing_element: ['name'],
		import_specifier: ['name', 'alias'],
		namespace_import: ['name'],
	},
	nonRefParents: new Set(['import_clause', 'nested_identifier', 'type_query']),
	member(node) {
		if (node.type !== 'member_expression') {
			return undefined;
		}
		const object = field(node, 'object');
		const property = field(node, 'property');
		if (object?.type === 'this' && property) {
			return { member: property, selfKeyword: true };
		}
		return undefined;
	},
	implicitMembers: false,
};

export const typescript: LanguageSpec = { ...javascript, grammar: 'typescript' };
export const tsx: LanguageSpec = { ...javascript, grammar: 'tsx' };
