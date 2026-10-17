import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist/**', 'out/**', '.vscode-test/**'] },
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			'@typescript-eslint/naming-convention': ['warn', { selector: 'import', format: ['camelCase', 'PascalCase'] }],
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
);
