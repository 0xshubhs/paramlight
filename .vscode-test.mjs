import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/suite/**/*.test.js',
	workspaceFolder: 'test/fixtures',
	launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
	mocha: { ui: 'tdd', timeout: 30000 },
});
