import type { LanguageSpec } from '../types';
import { field, named } from '../util';

export const ruby: LanguageSpec = {
	grammar: 'ruby',
	functions: new Set(['method', 'singleton_method', 'block', 'do_block', 'lambda']),
	// `def` is a scope gate: method bodies cannot see the locals around them.
	isolatedFunctions: new Set(['method', 'singleton_method']),
	params(fn) {
		return named(field(fn, 'parameters')).map((node) => ({ node }));
	},
	classes: new Set(['class', 'module', 'singleton_class']),
	blocks: new Set(),
	declarations: {
		assignment(node, ctx) {
			const left = field(node, 'left');
			if (!left) {
				return;
			}
			if (left.type === 'constant') {
				ctx.declare(left, 'constant', node);
			} else if (left.type === 'identifier' || left.type === 'left_assignment_list') {
				ctx.declareAll(left, ctx.level === 'module' ? 'moduleLocal' : 'local', node, { visibleFrom: node.endIndex });
			}
		},
		for(node, ctx) {
			const pattern = field(node, 'pattern');
			if (pattern) {
				ctx.declareAll(pattern, ctx.level === 'module' ? 'moduleLocal' : 'local', node);
			}
		},
	},
	bindingTypes: new Set(['identifier']),
	skipFields: { '*': ['value'] },
	refTypes: new Set(['identifier', 'constant']),
	nonRefFields: {
		call: ['method'],
		class: ['superclass'],
		scope_resolution: ['name', 'scope'],
	},
	nonRefParents: new Set(['scope_resolution']),
	direct: {
		instance_variable: 'field',
		class_variable: 'field',
		global_variable: 'global',
	},
	implicitMembers: false,
	classConstantsVisible: true,
};
