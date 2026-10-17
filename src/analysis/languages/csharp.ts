import type { LanguageSpec, Node, ParamSite } from '../types';
import { childText, field, fields, hasWord, named } from '../util';

function declaratorNames(variableDeclaration: Node | undefined): Node[] {
	return named(variableDeclaration)
		.filter((d) => d.type === 'variable_declarator')
		.map((d) => field(d, 'name'))
		.filter((n): n is Node => n !== null);
}

export const csharp: LanguageSpec = {
	grammar: 'c-sharp',
	functions: new Set([
		'method_declaration',
		'constructor_declaration',
		'local_function_statement',
		'lambda_expression',
		'anonymous_method_expression',
		'operator_declaration',
		'conversion_operator_declaration',
	]),
	params(fn) {
		const params = field(fn, 'parameters');
		if (!params) {
			return [];
		}
		if (params.type === 'implicit_parameter' || params.type === 'identifier') {
			return [{ node: params }];
		}
		const sites: ParamSite[] = named(params)
			.filter((p) => p.type === 'parameter')
			.map((node) => ({ node }));
		// The grammar flattens a `params T[] name` parameter into the list itself.
		for (const name of fields(params, 'name')) {
			sites.push({ node: name, decl: params });
		}
		return sites.sort((a, b) => a.node.startIndex - b.node.startIndex);
	},
	classes: new Set(['class_declaration', 'struct_declaration', 'record_declaration', 'interface_declaration']),
	blocks: new Set(['block', 'for_statement', 'foreach_statement', 'catch_clause', 'using_statement', 'switch_section']),
	declarations: {
		field_declaration(node, ctx) {
			const mods = childText(node, 'modifier');
			const isConst = hasWord(mods, 'const') || (hasWord(mods, 'static') && hasWord(mods, 'readonly'));
			const kind = isConst ? 'constant' : hasWord(mods, 'readonly') ? 'readonlyField' : 'field';
			for (const name of declaratorNames(named(node).find((c) => c.type === 'variable_declaration'))) {
				ctx.declare(name, kind, node);
			}
		},
		property_declaration(node, ctx) {
			const name = field(node, 'name');
			if (!name) {
				return;
			}
			const accessors = field(node, 'accessors');
			const writable = accessors ? /\b(set|init)\b/.test(accessors.text) : false;
			ctx.declare(name, writable ? 'field' : 'readonlyField', node);
		},
		variable_declaration(node, ctx) {
			const parent = node.parent?.type;
			if (parent === 'field_declaration' || parent === 'event_field_declaration') {
				return;
			}
			for (const d of named(node).filter((c) => c.type === 'variable_declarator')) {
				const name = field(d, 'name');
				if (name) {
					ctx.declare(name, 'local', node, { visibleFrom: d.endIndex });
				}
			}
		},
		foreach_statement(node, ctx) {
			const left = field(node, 'left');
			if (left) {
				ctx.declareAll(left, 'local', node, { visibleFrom: field(node, 'right')?.endIndex });
			}
		},
		catch_declaration(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'local', node);
			}
		},
		declaration_expression(node, ctx) {
			const name = field(node, 'name');
			if (name) {
				ctx.declare(name, 'local', node);
			}
		},
	},
	bindingTypes: new Set(['identifier', 'implicit_parameter']),
	skipFields: { '*': ['type', 'right'] },
	stopTypes: new Set(['equals_value_clause', 'attribute_list', 'modifier']),
	refTypes: new Set(['identifier']),
	nonRefFields: {
		member_access_expression: ['name'],
		qualified_name: ['name', 'qualifier'],
		argument: ['name'],
		attribute: ['name'],
		namespace_declaration: ['name'],
		file_scoped_namespace_declaration: ['name'],
	},
	nonRefParents: new Set([
		'using_directive',
		'qualified_name',
		'name_colon',
		'attribute',
		'generic_name',
		'type_argument_list',
		'base_list',
		'type_parameter_list',
		'type_parameter',
	]),
	member(node) {
		if (node.type !== 'member_access_expression') {
			return undefined;
		}
		const expression = field(node, 'expression');
		const member = field(node, 'name');
		if (expression?.type === 'this' && member) {
			return { member, selfKeyword: true };
		}
		return undefined;
	},
	implicitMembers: true,
};
