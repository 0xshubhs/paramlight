import type {
	Ctx,
	DeclareOptions,
	DefKind,
	LanguageSpec,
	Mark,
	MarkInfo,
	MarkKind,
	Node,
	ScopeKind,
} from './types';
import { field, named, snippet } from './util';

interface Def {
	name: string;
	kind: DefKind;
	start: number;
	end: number;
	line: number;
	scope: Scope;
	visibleFrom: number;
	owner?: string;
	type?: string;
	value?: string;
	paramIndex?: number;
	selfType?: string;
}

class Scope {
	readonly defs = new Map<string, Def[]>();
	readonly methods = new Set<string>();
	globals?: Set<string>;
	nonlocals?: Set<string>;

	constructor(
		readonly kind: ScopeKind,
		readonly parent: Scope | undefined,
		readonly name?: string,
		readonly isolated = false,
		readonly ownerClass?: string,
	) {}

	add(def: Def): void {
		const list = this.defs.get(def.name);
		if (list) {
			list.push(def);
		} else {
			this.defs.set(def.name, [def]);
		}
	}
}

interface Ref {
	name: string;
	start: number;
	end: number;
	scope: Scope;
}

interface MemberRef extends Ref {
	line: number;
	objectName?: string;
	objectStart: number;
	selfKeyword: boolean;
	callee: boolean;
}

interface DirectRef extends Ref {
	line: number;
	kind: DefKind;
}

type Frame = { node: Node; field: string | null; parent: Node | null } | { exit: true };

const MARK_KIND: Partial<Record<DefKind, MarkKind>> = {
	param: 'param',
	field: 'field',
	readonlyField: 'readonlyField',
	constant: 'constant',
	global: 'global',
};

const DEDUPED: ReadonlySet<DefKind> = new Set(['local', 'moduleLocal', 'global', 'constant']);

/**
 * Walks a syntax tree once to build lexical scopes, then resolves every
 * identifier against them and returns the marks to render.
 */
export function analyze(root: Node, spec: LanguageSpec): Mark[] {
	return new Analyzer(spec).run(root);
}

class Analyzer {
	private readonly module = new Scope('module', undefined);
	private current: Scope = this.module;
	private readonly bound = new Set<number>();
	private readonly skipped = new Set<number>();
	private readonly defs: Def[] = [];
	private readonly refs: Ref[] = [];
	private readonly members: MemberRef[] = [];
	private readonly directs: DirectRef[] = [];
	private readonly classes = new Map<string, Scope[]>();
	private readonly synthetic = new Map<string, Def>();
	private readonly marks: Mark[] = [];
	private readonly infos = new Map<Def, MarkInfo>();
	private readonly ctx: Ctx;

	constructor(private readonly spec: LanguageSpec) {
		const level = (): ScopeKind => this.current.kind;
		this.ctx = {
			get level() {
				return level();
			},
			declare: (nameNode, kind, decl, opts) => this.declare(nameNode, kind, decl, opts),
			declareAll: (pattern, kind, decl, opts) => {
				for (const b of this.bindings(pattern)) {
					this.declare(b, kind, decl, opts);
				}
			},
			bindings: (pattern) => this.bindings(pattern),
			markGlobal: (name, nonlocal) => {
				const fn = this.nearest('function');
				if (fn) {
					const set = nonlocal ? (fn.nonlocals ??= new Set()) : (fn.globals ??= new Set());
					set.add(name);
				}
			},
			skip: (node) => this.skipped.add(node.id),
			addMethod: (name) => this.nearest('class')?.methods.add(name),
		};
	}

	run(root: Node): Mark[] {
		this.walk(root);
		this.resolveRefs();
		this.resolveMembers();
		this.resolveDirects();
		this.markDeclarations();
		this.markShadows();
		return this.marks.sort((a, b) => a.start - b.start || a.end - b.end);
	}

	// ---- pass 1: scopes, declarations and references ----

	private walk(root: Node): void {
		const stack: Frame[] = [{ node: root, field: null, parent: null }];
		while (stack.length > 0) {
			const frame = stack.pop()!;
			if ('exit' in frame) {
				this.current = this.current.parent ?? this.module;
				continue;
			}
			const { node } = frame;
			if (this.enter(node, frame.field, frame.parent)) {
				stack.push({ exit: true });
			}
			for (let i = node.childCount - 1; i >= 0; i--) {
				const child = node.child(i);
				if (!child || !child.isNamed) {
					continue;
				}
				const childField = node.fieldNameForChild(i);
				// Type annotations hold no variable references, except inline class bodies (C structs).
				if (childField === 'type' && !this.spec.classes.has(child.type)) {
					continue;
				}
				stack.push({ node: child, field: childField, parent: node });
			}
		}
	}

	/** Returns true when a scope was pushed for this node. */
	private enter(node: Node, fieldName: string | null, parent: Node | null): boolean {
		const { spec } = this;
		const type = node.type;
		let pushed = false;

		if (spec.functions.has(type)) {
			const outer = this.current;
			const name = this.functionName(node);
			if (outer.kind === 'class' && name) {
				outer.methods.add(name);
			}
			this.current = new Scope(
				'function',
				outer,
				name,
				spec.isolatedFunctions?.has(type) ?? false,
				spec.ownerClass?.(node),
			);
			pushed = true;
			this.declareParams(node, outer);
		} else if (spec.classes.has(type)) {
			const name = spec.className ? spec.className(node) : field(node, 'name')?.text;
			this.current = new Scope('class', this.current, name);
			if (name) {
				const list = this.classes.get(name);
				if (list) {
					list.push(this.current);
				} else {
					this.classes.set(name, [this.current]);
				}
			}
			pushed = true;
		} else if (spec.blocks.has(type)) {
			this.current = new Scope('block', this.current);
			pushed = true;
		}

		spec.declarations[type]?.(node, this.ctx);

		const directKind = spec.direct?.[type];
		if (directKind) {
			this.directs.push({
				name: node.text,
				start: node.startIndex,
				end: node.endIndex,
				line: node.startPosition.row,
				kind: directKind,
				scope: this.current,
			});
		}

		const access = spec.member?.(node);
		if (access) {
			this.skipped.add(access.member.id);
			const obj = access.object;
			this.members.push({
				name: access.member.text,
				start: access.member.startIndex,
				end: access.member.endIndex,
				line: access.member.startPosition.row,
				objectName: obj && spec.refTypes.has(obj.type) ? obj.text : undefined,
				objectStart: obj ? obj.startIndex : node.startIndex,
				selfKeyword: access.selfKeyword ?? false,
				callee: fieldName === 'function',
				scope: this.current,
			});
		}

		if (
			spec.refTypes.has(type) &&
			!this.bound.has(node.id) &&
			!this.skipped.has(node.id) &&
			this.isRefPosition(node, fieldName, parent)
		) {
			this.refs.push({ name: node.text, start: node.startIndex, end: node.endIndex, scope: this.current });
		}
		return pushed;
	}

	private isRefPosition(node: Node, fieldName: string | null, parent: Node | null): boolean {
		const { spec } = this;
		if (!parent || node.text === '_') {
			return false;
		}
		if (fieldName === 'name' && (spec.functions.has(parent.type) || spec.classes.has(parent.type))) {
			return false;
		}
		if (fieldName && spec.nonRefFields) {
			if (spec.nonRefFields[parent.type]?.includes(fieldName) || spec.nonRefFields['*']?.includes(fieldName)) {
				return false;
			}
		}
		if (spec.nonRefParents?.has(parent.type)) {
			return false;
		}
		return spec.isRef ? spec.isRef(node, parent) : true;
	}

	private declareParams(fn: Node, outer: Scope): void {
		const sites = this.spec.params(fn, {
			inClass: outer.kind === 'class',
			className: outer.kind === 'class' ? outer.name : undefined,
		});
		let index = 0;
		for (const site of sites) {
			const decl = site.decl ?? site.node;
			for (const b of this.bindings(site.node)) {
				if (site.self) {
					this.declare(b, 'self', decl, undefined, { selfType: site.selfType });
				} else if (site.asLocal) {
					this.declare(b, 'local', decl, { visibleFrom: fn.startIndex });
				} else {
					this.declare(b, 'param', decl, undefined, { paramIndex: index++ });
				}
			}
		}
	}

	private bindings(pattern: Node | null): Node[] {
		const { spec } = this;
		const out: Node[] = [];
		const anySkip = spec.skipFields['*'] ?? [];
		const visit = (node: Node): void => {
			if (spec.bindingTypes.has(node.type)) {
				if (!spec.isBindingName || spec.isBindingName(node.text)) {
					out.push(node);
				}
				return;
			}
			if (spec.stopTypes?.has(node.type)) {
				return;
			}
			const skip = spec.skipFields[node.type];
			for (let i = 0; i < node.childCount; i++) {
				const child = node.child(i);
				if (!child || !child.isNamed) {
					continue;
				}
				const f = node.fieldNameForChild(i);
				if (f && (anySkip.includes(f) || skip?.includes(f))) {
					continue;
				}
				visit(child);
			}
		};
		if (pattern) {
			visit(pattern);
		}
		return out;
	}

	private declare(
		nameNode: Node,
		kind: DefKind,
		decl: Node,
		opts?: DeclareOptions,
		extra?: { paramIndex?: number; selfType?: string },
	): void {
		const name = opts?.name ?? nameNode.text;
		if (!name || name === '_') {
			return;
		}
		this.bound.add(nameNode.id);

		let target: Scope | undefined;
		if (kind === 'field' || kind === 'readonlyField') {
			target = this.nearest('class');
		} else if (kind === 'local' && (opts?.hoist || this.spec.localsHoisted)) {
			target = this.nearest('function') ?? this.module;
		} else {
			target = this.current;
		}

		const asRef: Ref = { name, start: nameNode.startIndex, end: nameNode.endIndex, scope: this.current };
		if (target && target.kind === 'function' && (kind === 'local' || kind === 'moduleLocal')) {
			if (target.globals?.has(name) || target.nonlocals?.has(name)) {
				this.refs.push(asRef);
				return;
			}
		}
		const existing = target?.defs.get(name);
		const rebinding = this.spec.allowRebinding && kind === 'local';
		if (existing && existing.length > 0 && DEDUPED.has(kind) && !rebinding) {
			// Assigning an existing binding again (Python, Go `:=`, JS `var`) is a use, not a new name.
			this.refs.push(asRef);
			return;
		}

		const scope = target ?? this.current;
		const def: Def = {
			name,
			kind,
			start: nameNode.startIndex,
			end: nameNode.endIndex,
			line: nameNode.startPosition.row,
			scope,
			visibleFrom: opts?.visibleFrom ?? nameNode.endIndex,
			paramIndex: extra?.paramIndex,
			selfType: extra?.selfType,
		};
		if (kind === 'param') {
			def.owner = scope.name;
		} else if (kind !== 'local' && kind !== 'self') {
			def.owner = this.enclosingClass(scope);
		}
		if (kind !== 'local' && kind !== 'moduleLocal' && kind !== 'self') {
			def.type = typeOf(decl);
			if (kind === 'constant' || kind === 'global') {
				def.value = valueOf(nameNode, decl);
			}
		}
		target?.add(def);
		this.defs.push(def);
	}

	private nearest(kind: ScopeKind): Scope | undefined {
		for (let s: Scope | undefined = this.current; s; s = s.parent) {
			if (s.kind === kind) {
				return s;
			}
		}
		return undefined;
	}

	private functionName(fn: Node): string | undefined {
		const own = this.spec.functionName?.(fn) ?? field(fn, 'name')?.text;
		if (own) {
			return own;
		}
		const parent = fn.parent;
		if (parent) {
			const holder =
				field(parent, 'name') ?? field(parent, 'left') ?? field(parent, 'pattern') ?? field(parent, 'declarator');
			if (holder && holder.endIndex <= fn.startIndex && /^[\w$#@.]{1,40}$/.test(holder.text)) {
				return holder.text;
			}
		}
		return undefined;
	}

	// ---- pass 2: resolution ----

	private resolve(name: string, scope: Scope | undefined, pos: number, crossed = false, onlyConst = false): Def | undefined {
		const { spec } = this;
		for (let s = scope; s; s = s.parent) {
			const hiddenClass = s.kind === 'class' && crossed && !spec.implicitMembers;
			if (!hiddenClass || spec.classConstantsVisible) {
				const found = this.pick(s, name, pos, onlyConst || hiddenClass);
				if (found) {
					return found;
				}
			}
			if (s.kind === 'function') {
				if (s.globals?.has(name)) {
					return this.pick(this.module, name, pos, false);
				}
				if (s.ownerClass && spec.implicitMembers && !onlyConst) {
					const member = this.classMember(s.ownerClass, name);
					if (member) {
						return member;
					}
				}
				crossed = true;
				if (s.isolated) {
					onlyConst = true;
				}
			}
		}
		return undefined;
	}

	private pick(scope: Scope, name: string, pos: number, onlyConst: boolean): Def | undefined {
		const list = scope.defs.get(name);
		if (!list) {
			return undefined;
		}
		const positional = (scope.kind === 'function' || scope.kind === 'block') && !this.spec.localsHoisted;
		for (let i = list.length - 1; i >= 0; i--) {
			const d = list[i];
			if (onlyConst && d.kind !== 'constant') {
				continue;
			}
			if (positional && d.kind === 'local' && d.visibleFrom > pos) {
				continue;
			}
			return d;
		}
		return undefined;
	}

	private classMember(className: string, name: string): Def | undefined {
		for (const scope of this.classes.get(className) ?? []) {
			const found = scope.defs.get(name)?.[0];
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	private classHasMethod(className: string, name: string): boolean {
		return (this.classes.get(className) ?? []).some((s) => s.methods.has(name));
	}

	private enclosingClass(scope: Scope | undefined): string | undefined {
		for (let s = scope; s; s = s.parent) {
			if (s.kind === 'class') {
				return s.name ?? '';
			}
			if (s.kind === 'function' && s.ownerClass) {
				return s.ownerClass;
			}
		}
		return undefined;
	}

	private resolveRefs(): void {
		for (const ref of this.refs) {
			const def = this.resolve(ref.name, ref.scope, ref.start);
			if (def) {
				this.mark(def, ref.start, ref.end, false);
			}
		}
	}

	private resolveMembers(): void {
		for (const m of this.members) {
			let cls: string | undefined;
			if (m.selfKeyword) {
				cls = this.enclosingClass(m.scope) ?? '';
			} else if (m.objectName) {
				const obj = this.resolve(m.objectName, m.scope, m.objectStart);
				if (obj?.kind === 'self') {
					cls = obj.selfType ?? this.enclosingClass(obj.scope) ?? '';
				}
			}
			if (cls === undefined) {
				continue;
			}
			const declared = this.classMember(cls, m.name);
			if (declared && MARK_KIND[declared.kind] && declared.kind !== 'param') {
				this.mark(declared, m.start, m.end, false);
				continue;
			}
			if (m.callee || this.classHasMethod(cls, m.name)) {
				continue;
			}
			// Dynamic languages create fields by assignment; the first sighting acts as the declaration.
			const def = this.syntheticDef(`field|${cls}|${m.name}`, m.name, 'field', m, cls);
			this.mark(def, m.start, m.end, def.start === m.start);
		}
	}

	private resolveDirects(): void {
		for (const d of this.directs) {
			const owner = d.kind === 'global' ? undefined : this.enclosingClass(d.scope);
			const def = this.syntheticDef(`${d.kind}|${owner ?? ''}|${d.name}`, d.name, d.kind, d, owner);
			this.mark(def, d.start, d.end, def.start === d.start);
		}
	}

	private syntheticDef(key: string, name: string, kind: DefKind, at: Ref & { line: number }, owner?: string): Def {
		let def = this.synthetic.get(key);
		if (!def) {
			def = { name, kind, start: at.start, end: at.end, line: at.line, scope: at.scope, visibleFrom: 0, owner };
			this.synthetic.set(key, def);
		}
		return def;
	}

	private markDeclarations(): void {
		for (const def of this.defs) {
			this.mark(def, def.start, def.end, true);
		}
	}

	private markShadows(): void {
		const { spec } = this;
		for (const def of this.defs) {
			if (def.kind !== 'param' && def.kind !== 'local') {
				continue;
			}
			const own = def.scope;
			const outer = this.resolve(
				def.name,
				own.parent,
				def.start,
				own.kind === 'function',
				own.kind === 'function' && own.isolated,
			);
			if (!outer || outer === def) {
				continue;
			}
			let shadows = false;
			if (outer.kind === 'param' || outer.kind === 'local') {
				shadows = !(spec.allowRebinding && nearestFunction(outer.scope) === nearestFunction(own));
			} else if (outer.kind === 'global' || outer.kind === 'constant') {
				shadows = true;
			} else if (outer.kind === 'field' || outer.kind === 'readonlyField') {
				// Constructor and setter parameters named after fields are idiomatic; locals are not.
				shadows = def.kind === 'local';
			}
			if (shadows) {
				this.marks.push({
					kind: 'shadow',
					start: def.start,
					end: def.end,
					name: def.name,
					declaration: true,
					info: {
						...this.info(def),
						shadows: { kind: outer.kind, name: outer.name, line: outer.line, owner: outer.owner },
					},
				});
			}
		}
	}

	private mark(def: Def, start: number, end: number, declaration: boolean): void {
		const kind = MARK_KIND[def.kind];
		if (!kind) {
			return;
		}
		this.marks.push({
			kind,
			start,
			end,
			name: def.name,
			declaration,
			colorIndex: def.paramIndex,
			info: this.info(def),
		});
	}

	private info(def: Def): MarkInfo {
		let info = this.infos.get(def);
		if (!info) {
			info = { kind: def.kind, name: def.name, owner: def.owner, line: def.line, type: def.type, value: def.value };
			this.infos.set(def, info);
		}
		return info;
	}
}

function nearestFunction(scope: Scope): Scope | undefined {
	for (let s: Scope | undefined = scope; s; s = s.parent) {
		if (s.kind === 'function') {
			return s;
		}
	}
	return undefined;
}

function typeOf(decl: Node): string | undefined {
	let t = field(decl, 'type');
	if (!t) {
		for (const child of named(decl)) {
			t = field(child, 'type');
			if (t) {
				break;
			}
		}
	}
	return snippet(t?.text.replace(/^:\s*/, ''), 40);
}

function valueOf(nameNode: Node, decl: Node): string | undefined {
	for (let n = nameNode.parent; n; n = n.parent) {
		const v = field(n, 'value') ?? field(n, 'right') ?? field(n, 'default_value');
		if (v && !(v.startIndex <= nameNode.startIndex && nameNode.endIndex <= v.endIndex)) {
			return snippet(v.text);
		}
		if (n.type === 'variable_declarator' || n.type === 'const_element') {
			const last = n.lastNamedChild;
			if (last && last.startIndex > nameNode.startIndex) {
				return snippet(last.text);
			}
		}
		if (n.id === decl.id) {
			break;
		}
	}
	return undefined;
}
