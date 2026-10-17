import type { LanguageSpec, Node } from '../types';
import { field, hasChild, named } from '../util';

const stripSigil = (name: string): string => name.replace(/^\$/, '');

export const php: LanguageSpec = {
	grammar: 'php',
	functions: new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']),
	isolatedFunctions: new Set(['function_definition', 'method_declaration', 'anonymous_function']),
	params(fn) {
		return named(field(fn, 'parameters'))
			.filter((p) => p.type.endsWith('parameter'))
			.map((node) => ({ node }));
	},
	classes: new Set(['class_declaration', 'trait_declaration', 'interface_declaration', 'enum_declaration']),
	blocks: new Set(),
	declarations: {
		assignment_expression(node, ctx) {
			const left = field(node, 'left');
			if (left && (left.type === 'variable_name' || left.type === 'list_literal')) {
				ctx.declareAll(left, ctx.level === 'module' ? 'global' : 'local', node, { visibleFrom: node.endIndex });
			}
		},
		property_declaration(node, ctx) {
			const readonly = hasChild(node, 'readonly_modifier');
			for (const element of named(node).filter((c) => c.type === 'property_element')) {
				const name = field(element, 'name');
				if (name) {
					ctx.declare(name, readonly ? 'readonlyField' : 'field', node, { name: stripSigil(name.text) });
				}
			}
		},
		// Constructor promotion: `public function __construct(private readonly string $x)`.
		property_promotion_parameter(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				const readonly = hasChild(node, 'readonly_modifier');
				ctx.declare(name, readonly ? 'readonlyField' : 'field', node, { name: stripSigil(name.text) });
			}
		},
		const_declaration(node, ctx) {
			for (const element of named(node).filter((c) => c.type === 'const_element')) {
				const name = element.namedChild(0);
				if (name) {
					ctx.declare(name, 'constant', element);
				}
			}
		},
		function_call_expression(node, ctx) {
			if (field(node, 'function')?.text !== 'define') {
				return;
			}
			const first = named(field(node, 'arguments'))[0];
			const content = first?.descendantsOfType('string_content')[0];
			if (content) {
				ctx.declare(content, 'constant', node);
			}
		},
		foreach_statement(node, ctx) {
			const parts = named(node);
			for (const target of parts.slice(1).filter((p) => p.type !== 'compound_statement' && p.id !== field(node, 'body')?.id)) {
				ctx.declareAll(target, ctx.level === 'module' ? 'global' : 'local', node);
			}
		},
		global_declaration(node, ctx) {
			for (const v of named(node)) {
				ctx.markGlobal(v.text);
				ctx.skip(v);
			}
		},
		anonymous_function_use_clause(node, ctx) {
			for (const v of named(node).filter((c) => c.type === 'variable_name')) {
				ctx.declare(v, 'local', node);
			}
		},
	},
	bindingTypes: new Set(['variable_name']),
	skipFields: { '*': ['type', 'default_value', 'attributes', 'value'] },
	stopTypes: new Set(['member_access_expression', 'subscript_expression']),
	refTypes: new Set(['variable_name', 'name']),
	isRef(node: Node, parent: Node) {
		if (node.type === 'variable_name') {
			return node.text !== '$this';
		}
		return parent.type !== 'variable_name';
	},
	nonRefFields: {
		member_access_expression: ['name'],
		nullsafe_member_access_expression: ['name'],
		member_call_expression: ['name'],
		nullsafe_member_call_expression: ['name'],
		scoped_call_expression: ['name', 'scope'],
		scoped_property_access_expression: ['name', 'scope'],
		function_call_expression: ['function'],
	},
	nonRefParents: new Set([
		'named_type',
		'qualified_name',
		'namespace_name',
		'namespace_use_clause',
		'namespace_definition',
		'attribute',
		'object_creation_expression',
		'base_clause',
		'class_interface_clause',
		'relative_scope',
		'class_constant_access_expression',
		'const_element',
		'named_label_statement',
		'goto_statement',
	]),
	member(node) {
		if (node.type === 'member_access_expression' || node.type === 'nullsafe_member_access_expression') {
			const object = field(node, 'object');
			const member = field(node, 'name');
			if (object?.text === '$this' && member?.type === 'name') {
				return { member, selfKeyword: true };
			}
		} else if (node.type === 'class_constant_access_expression') {
			const [scope, member] = named(node);
			if (scope?.type === 'relative_scope' && member?.type === 'name') {
				return { member, selfKeyword: true };
			}
		}
		return undefined;
	},
	implicitMembers: false,
	localsHoisted: true,
};
