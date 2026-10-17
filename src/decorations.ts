import * as vscode from 'vscode';
import type { Mark, MarkKind } from './analysis/types';
import type { DocumentSettings, StyleSettings } from './config';

type BoxKind = Exclude<MarkKind, 'param'>;

const BOX_COLORS: Readonly<Record<BoxKind, string>> = {
	field: 'allCodeVisual.fieldBorder',
	readonlyField: 'allCodeVisual.readonlyFieldBorder',
	constant: 'allCodeVisual.constantBorder',
	global: 'allCodeVisual.globalBorder',
	shadow: 'allCodeVisual.shadowBorder',
};

/** Owns every decoration type; recreated whenever the style settings change. */
export class DecorationStyles implements vscode.Disposable {
	private readonly params: vscode.TextEditorDecorationType[] = [];
	private readonly boxes = new Map<BoxKind, vscode.TextEditorDecorationType>();

	constructor(style: StyleSettings) {
		const background = style.argumentsMode !== 'symbol only';
		const suffix = style.argumentsMode !== 'color only' ? style.argumentsSuffix : undefined;
		for (let i = 0; i < style.paletteSize; i++) {
			// Golden-angle steps keep neighbouring parameters far apart on the color wheel.
			const hue = (215 + i * 137.508) % 360;
			this.params.push(
				vscode.window.createTextEditorDecorationType({
					rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
					dark: {
						backgroundColor: background ? hsl(hue, 0.9, 0.55, 0.19) : undefined,
						after: suffix ? { contentText: suffix, color: hsl(hue, 0.85, 0.75, 0.6) } : undefined,
					},
					light: {
						backgroundColor: background ? hsl(hue, 0.85, 0.72, 0.32) : undefined,
						after: suffix ? { contentText: suffix, color: hsl(hue, 0.75, 0.35, 0.8) } : undefined,
					},
				}),
			);
		}
		for (const kind of Object.keys(BOX_COLORS) as BoxKind[]) {
			const color = new vscode.ThemeColor(BOX_COLORS[kind]);
			this.boxes.set(
				kind,
				vscode.window.createTextEditorDecorationType({
					rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
					borderWidth: '1px',
					borderStyle: kind === 'shadow' ? 'solid' : 'dotted',
					borderColor: color,
					overviewRulerColor: style.overviewRuler ? color : undefined,
					overviewRulerLane: style.overviewRuler ? vscode.OverviewRulerLane.Right : undefined,
				}),
			);
		}
	}

	apply(editor: vscode.TextEditor, marks: readonly Mark[], settings: DocumentSettings): void {
		const doc = editor.document;
		const params: vscode.Range[][] = this.params.map(() => []);
		const boxes = new Map<BoxKind, vscode.Range[]>([...this.boxes.keys()].map((k) => [k, []]));
		for (const mark of marks) {
			if (!enabled(mark.kind, settings)) {
				continue;
			}
			const range = new vscode.Range(doc.positionAt(mark.start), doc.positionAt(mark.end));
			if (mark.kind === 'param') {
				params[(mark.colorIndex ?? 0) % params.length].push(range);
			} else {
				boxes.get(mark.kind)!.push(range);
			}
		}
		this.params.forEach((type, i) => editor.setDecorations(type, params[i]));
		for (const [kind, type] of this.boxes) {
			editor.setDecorations(type, boxes.get(kind)!);
		}
	}

	clear(editor: vscode.TextEditor): void {
		for (const type of [...this.params, ...this.boxes.values()]) {
			editor.setDecorations(type, []);
		}
	}

	dispose(): void {
		for (const type of [...this.params, ...this.boxes.values()]) {
			type.dispose();
		}
	}
}

export function enabled(kind: MarkKind, s: DocumentSettings): boolean {
	switch (kind) {
		case 'param':
			return s.arguments;
		case 'field':
		case 'readonlyField':
			return s.fields;
		case 'constant':
			return s.constants;
		case 'global':
			return s.globals;
		case 'shadow':
			return s.shadowing;
	}
}

/** `#rrggbbaa` from hue in degrees and saturation, lightness, alpha in 0..1. */
export function hsl(h: number, s: number, l: number, a: number): string {
	const k = (n: number): number => (n + h / 30) % 12;
	const m = s * Math.min(l, 1 - l);
	const channel = (n: number): number => l - m * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	const hex = (v: number): string =>
		Math.round(Math.min(1, Math.max(0, v)) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}${hex(a)}`;
}
