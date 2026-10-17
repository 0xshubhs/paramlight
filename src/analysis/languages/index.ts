import type { LanguageSpec } from '../types';
import { c, cpp } from './cpp';
import { csharp } from './csharp';
import { go } from './go';
import { java } from './java';
import { javascript, tsx, typescript } from './javascript';
import { php } from './php';
import { python } from './python';
import { ruby } from './ruby';
import { rust } from './rust';

/** VS Code language id to the spec that analyzes it. */
export const LANGUAGES: Readonly<Record<string, LanguageSpec>> = {
	javascript,
	javascriptreact: javascript,
	typescript,
	typescriptreact: tsx,
	python,
	rust,
	go,
	c,
	cpp,
	java,
	csharp,
	php,
	ruby,
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);

/** Every grammar file the extension ships. */
export const GRAMMARS = [...new Set(Object.values(LANGUAGES).map((spec) => spec.grammar))];
