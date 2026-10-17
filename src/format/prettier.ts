// Built as a separate bundle (dist/prettier.js) and loaded on first use, so
// Prettier never slows down activation.
import type { Plugin } from 'prettier';
import * as prettier from 'prettier/standalone';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as typescript from 'prettier/plugins/typescript';
import * as php from '@prettier/plugin-php/standalone';
import type { PrettierParser } from './tools';

const plugins = [babel, estree, typescript, php] as Plugin[];

export function format(text: string, parser: PrettierParser, options: Record<string, unknown>): Promise<string> {
	return prettier.format(text, { ...options, parser, plugins });
}
