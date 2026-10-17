import type { LanguageSpec } from '../types';
import { field, hasChild, named } from '../util';

export const rust: LanguageSpec = {
	grammar: 'rust',
	functions: new Set(['function_item', 'function_signature_item', 'closure_expression']),
	params(fn) {
		const list = field(fn, 'parameters');
		return named(list)
			.filter((p) => p.type !== 'self_parameter' && p.type !== 'attribute_item' && p.type !== 'line_comment')
			.map((node) => ({ node }));
	},
	classes: new Set(['struct_item', 'impl_item', 'trait_item', 'union_item']),
	className(node) {
		if (node.type === 'impl_item') {
			const type = field(node, 'type');
			return (type?.type === 'generic_type' ? field(type, 'type') : type)?.text;
		}
		return field(node, 'name')?.text;
	},
	blocks: new Set(['block', 'for_expression', 'match_arm', 'if_expression', 'while_expression']),
	declarations: {
		let_declaration(node, ctx) {
			const pattern = field(node, 'pattern');
			if (pattern) {
				ctx.declareAll(pattern, 'local', node, { visibleFrom: node.endIndex });
			}
		},
		let_condition(node, ctx) {
			const pattern = field(node, 'pattern');
			if (pattern) {
				ctx.declareAll(pattern, 'local', node, { visibleFrom: node.endIndex });
			}
		},
		for_expression(node, ctx) {
			const pattern = field(node, 'pattern');
			if (pattern) {
				ctx.declareAll(pattern, 'local', node, { visibleFrom: field(node, 'value')?.endIndex });
			}
		},
		match_arm(node, ctx) {
			const pattern = field(node, 'pattern');
			if (pattern) {
				ctx.declareAll(pattern, 'local', node, { visibleFrom: pattern.startIndex });
			}
		},
		const_item(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'constant', node);
			}
		},
		static_item(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, hasChild(node, 'mutable_specifier') ? 'global' : 'constant', node);
			}
		},
		field_declaration(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'field', node);
			}
		},
	},
	bindingTypes: new Set(['identifier', 'shorthand_field_identifier']),
	skipFields: { '*': ['type', 'condition', 'value'] },
	stopTypes: new Set(['scoped_identifier', 'attribute_item']),
	// Bindings are snake_case; capitalized names in patterns are enum variants or constants.
	isBindingName: (name) => /^[a-z_]/.test(name),
	refTypes: new Set(['identifier']),
	nonRefFields: { macro_invocation: ['macro'] },
	nonRefParents: new Set([
		'scoped_identifier',
		'scoped_type_identifier',
		'scoped_use_list',
		'use_list',
		'use_as_clause',
		'use_declaration',
		'attribute',
		'meta_item',
	]),
	member(node) {
		if (node.type !== 'field_expression') {
			return undefined;
		}
		const value = field(node, 'value');
		const member = field(node, 'field');
		if (value?.type === 'self' && member) {
			return { member, selfKeyword: true };
		}
		return undefined;
	},
	implicitMembers: false,
	allowRebinding: true,
};
