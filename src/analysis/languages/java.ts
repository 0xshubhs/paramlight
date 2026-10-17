import type { LanguageSpec, Node } from '../types';
import { childText, field, fields, hasWord, named } from '../util';

function declarators(node: Node): Node[] {
	return fields(node, 'declarator')
		.map((d) => field(d, 'name'))
		.filter((n): n is Node => n !== null);
}

export const java: LanguageSpec = {
	grammar: 'java',
	functions: new Set(['method_declaration', 'constructor_declaration', 'compact_constructor_declaration', 'lambda_expression']),
	params(fn) {
		const params = field(fn, 'parameters');
		if (!params) {
			return [];
		}
		if (params.type === 'identifier') {
			return [{ node: params }];
		}
		return named(params)
			.filter((p) => p.type !== 'receiver_parameter' && !p.type.endsWith('comment'))
			.map((node) => ({ node }));
	},
	classes: new Set([
		'class_declaration',
		'interface_declaration',
		'enum_declaration',
		'record_declaration',
		'annotation_type_declaration',
	]),
	blocks: new Set(['block', 'for_statement', 'enhanced_for_statement', 'catch_clause', 'try_with_resources_statement']),
	declarations: {
		field_declaration(node, ctx) {
			const mods = childText(node, 'modifiers');
			const isFinal = hasWord(mods, 'final');
			const kind = isFinal ? (hasWord(mods, 'static') ? 'constant' : 'readonlyField') : 'field';
			for (const name of declarators(node)) {
				ctx.declare(name, kind, node);
			}
		},
		constant_declaration(node, ctx) {
			for (const name of declarators(node)) {
				ctx.declare(name, 'constant', node);
			}
		},
		local_variable_declaration(node, ctx) {
			for (const d of fields(node, 'declarator')) {
				const name = field(d, 'name');
				if (name) {
					ctx.declare(name, 'local', node, { visibleFrom: d.endIndex });
				}
			}
		},
		enhanced_for_statement(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declareAll(name, 'local', node, { visibleFrom: field(node, 'value')?.endIndex });
			}
		},
		catch_formal_parameter(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'local', node);
			}
		},
		resource(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'local', node, { visibleFrom: node.endIndex });
			}
		},
		record_declaration(node, ctx) {
			for (const p of named(field(node, 'parameters'))) {
				const name = field(p, 'name');
				if (name) {
					ctx.declare(name, 'readonlyField', p);
				}
			}
		},
	},
	bindingTypes: new Set(['identifier']),
	skipFields: { '*': ['type', 'dimensions', 'value'] },
	stopTypes: new Set(['modifiers', 'marker_annotation', 'annotation']),
	refTypes: new Set(['identifier']),
	nonRefFields: {
		field_access: ['field'],
		method_invocation: ['name'],
		method_reference: ['name'],
		annotation: ['name'],
		marker_annotation: ['name'],
		enum_constant: ['name'],
		element_value_pair: ['key'],
	},
	nonRefParents: new Set([
		'scoped_identifier',
		'import_declaration',
		'package_declaration',
		'labeled_statement',
		'break_statement',
		'continue_statement',
	]),
	member(node) {
		if (node.type !== 'field_access') {
			return undefined;
		}
		const object = field(node, 'object');
		const member = field(node, 'field');
		if (object?.type === 'this' && member) {
			return { member, selfKeyword: true };
		}
		return undefined;
	},
	implicitMembers: true,
};
