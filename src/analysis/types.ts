import type { Node } from '@vscode/tree-sitter-wasm';

export type { Node };

/** What a declared name is, as far as decorations are concerned. */
export type DefKind =
	| 'param'
	| 'self'
	| 'local'
	| 'moduleLocal'
	| 'field'
	| 'readonlyField'
	| 'constant'
	| 'global';

/** The visual category a mark is rendered with. */
export type MarkKind = 'param' | 'field' | 'readonlyField' | 'constant' | 'global' | 'shadow';

export type ScopeKind = 'module' | 'class' | 'function' | 'block';

export interface MarkInfo {
	kind: DefKind;
	name: string;
	/** Function name for parameters, class name for members. */
	owner?: string;
	/** Zero-based line of the declaration. */
	line: number;
	type?: string;
	value?: string;
	shadows?: { kind: DefKind; name: string; line: number; owner?: string };
}

export interface Mark {
	kind: MarkKind;
	/** UTF-16 offsets, the same unit VS Code uses for document offsets. */
	start: number;
	end: number;
	name: string;
	declaration: boolean;
	/** Position of the parameter in its function; only set for `param` marks. */
	colorIndex?: number;
	info: MarkInfo;
}

export interface ParamSite {
	/** Node holding the binding (an identifier or a pattern). */
	node: Node;
	/** Receiver such as Python `self` or a Go method receiver. */
	self?: boolean;
	/** Type name of a receiver, used to find the members it refers to. */
	selfType?: string;
	/** Named results (Go) are declared as locals, not colored as parameters. */
	asLocal?: boolean;
	/** Node to read type information from when it differs from `node`. */
	decl?: Node;
}

export interface DeclareOptions {
	/** Declare in the nearest function scope instead of the current block (JS `var`). */
	hoist?: boolean;
	/** Override the name read from the node text (PHP properties drop the `$`). */
	name?: string;
	/** Offset from which the binding is visible; defaults to the end of the name. */
	visibleFrom?: number;
}

export interface Ctx {
	/** Kind of the scope the declaration appears in. */
	readonly level: ScopeKind;
	declare(nameNode: Node, kind: DefKind, decl: Node, opts?: DeclareOptions): void;
	declareAll(pattern: Node, kind: DefKind, decl: Node, opts?: DeclareOptions): void;
	bindings(pattern: Node): Node[];
	/** Python `global`/`nonlocal`, PHP `global`. */
	markGlobal(name: string, nonlocal?: boolean): void;
	/** Exclude a node from being treated as a reference. */
	skip(node: Node): void;
	/** Record a method name on the enclosing class (C++ declarations without a body). */
	addMethod(name: string): void;
}

export interface MemberAccess {
	member: Node;
	/** The object expression, when it is an identifier that may resolve to a receiver. */
	object?: Node;
	/** True when the object is `this`/`self` (or an implicit `this`). */
	selfKeyword?: boolean;
}

export interface LanguageSpec {
	/** Grammar file name without the `tree-sitter-` prefix. */
	grammar: string;
	functions: ReadonlySet<string>;
	params(fn: Node, enclosing: { inClass: boolean; className?: string }): ParamSite[];
	functionName?(fn: Node): string | undefined;
	/** Class an out-of-line method belongs to (C++ `Foo::bar`). */
	ownerClass?(fn: Node): string | undefined;
	/** Functions that cannot see enclosing locals (PHP functions, Ruby `def`). */
	isolatedFunctions?: ReadonlySet<string>;
	classes: ReadonlySet<string>;
	className?(node: Node): string | undefined;
	blocks: ReadonlySet<string>;
	declarations: Readonly<Record<string, (node: Node, ctx: Ctx) => void>>;
	bindingTypes: ReadonlySet<string>;
	/** Fields not descended into when collecting bindings; `*` applies to every node type. */
	skipFields: Readonly<Record<string, readonly string[]>>;
	stopTypes?: ReadonlySet<string>;
	isBindingName?(name: string): boolean;
	refTypes: ReadonlySet<string>;
	/** Child fields that never hold references, keyed by parent type; `*` for any parent. */
	nonRefFields?: Readonly<Record<string, readonly string[]>>;
	nonRefParents?: ReadonlySet<string>;
	isRef?(node: Node, parent: Node | null): boolean;
	member?(node: Node): MemberAccess | undefined;
	/** Node types that are members or globals on their own (Ruby `@x`, `$x`). */
	direct?: Readonly<Record<string, DefKind>>;
	/** Bare names inside methods can refer to fields (C++, Java, C#). */
	implicitMembers: boolean;
	/** Class constants are visible from methods without qualification (Ruby). */
	classConstantsVisible?: boolean;
	/** A local is visible in its whole function (Python, PHP). */
	localsHoisted?: boolean;
	/** Re-declaring a name in the same function is idiomatic (Rust `let x = x`). */
	allowRebinding?: boolean;
}
