import type { LanguageSpec, Node, ParamSite } from '../types';
import { field, fields, hasChild, named } from '../util';

function receiverType(type: Node | null): string | undefined {
	let t = type;
	while (t && (t.type === 'pointer_type' || t.type === 'parenthesized_type')) {
		t = t.namedChild(0);
	}
	if (t?.type === 'generic_type') {
		t = field(t, 'type');
	}
	return t?.text;
}

export const go: LanguageSpec = {
	grammar: 'go',
	functions: new Set(['function_declaration', 'method_declaration', 'func_literal']),
	params(fn) {
		const sites: ParamSite[] = [];
		for (const recv of named(field(fn, 'receiver'))) {
			sites.push({ node: recv, self: true, selfType: receiverType(field(recv, 'type')) });
		}
		for (const p of named(field(fn, 'parameters'))) {
			sites.push({ node: p });
		}
		const result = field(fn, 'result');
		if (result?.type === 'parameter_list') {
			for (const r of named(result)) {
				sites.push({ node: r, asLocal: true });
			}
		}
		return sites;
	},
	classes: new Set(['struct_type']),
	className(node) {
		return node.parent?.type === 'type_spec' ? field(node.parent, 'name')?.text : undefined;
	},
	blocks: new Set([
		'block',
		'for_statement',
		'if_statement',
		'expression_switch_statement',
		'type_switch_statement',
		'select_statement',
		'expression_case',
		'type_case',
		'default_case',
		'communication_case',
	]),
	declarations: {
		short_var_declaration(node, ctx) {
			ctx.declareAll(field(node, 'left')!, 'local', node, { visibleFrom: node.endIndex });
		},
		var_spec(node, ctx) {
			for (const name of fields(node, 'name')) {
				ctx.declare(name, ctx.level === 'module' ? 'global' : 'local', node, { visibleFrom: node.endIndex });
			}
		},
		const_spec(node, ctx) {
			for (const name of fields(node, 'name')) {
				ctx.declare(name, 'constant', node);
			}
		},
		range_clause(node, ctx) {
			const left = field(node, 'left');
			if (left && hasChild(node, ':=')) {
				ctx.declareAll(left, 'local', node, { visibleFrom: node.endIndex });
			}
		},
		receive_statement(node, ctx) {
			const left = field(node, 'left');
			if (left && hasChild(node, ':=')) {
				ctx.declareAll(left, 'local', node, { visibleFrom: node.endIndex });
			}
		},
		type_switch_statement(node, ctx) {
			for (const alias of fields(node, 'alias')) {
				ctx.declareAll(alias, 'local', node);
			}
		},
		field_declaration(node, ctx) {
			for (const name of fields(node, 'name')) {
				ctx.declare(name, 'field', node);
			}
		},
	},
	bindingTypes: new Set(['identifier']),
	skipFields: { '*': ['type', 'value', 'right'] },
	refTypes: new Set(['identifier']),
	nonRefParents: new Set(['qualified_type', 'label_name', 'package_clause']),
	member(node) {
		if (node.type !== 'selector_expression') {
			return undefined;
		}
		const operand = field(node, 'operand');
		const member = field(node, 'field');
		if (operand?.type === 'identifier' && member) {
			return { member, object: operand };
		}
		return undefined;
	},
	implicitMembers: false,
};
