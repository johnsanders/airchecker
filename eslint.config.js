import eslintReact from '@eslint-react/eslint-plugin';
import perfectionist from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// React lives in each package's web view. Scope JSX-aware rules there only.
const reactFiles = ['packages/*/src/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'];

export default defineConfig(
	{
		// The simulator's graphics render scripts are standalone and predate the TS setup.
		ignores: [
			'**/node_modules/',
			'**/dist/',
			'packages/*/recordings/',
			'coverage/',
			'packages/simulator/*.mjs',
		],
	},
	...tseslint.configs.recommended,
	{
		files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
		...perfectionist.configs['recommended-alphabetical'],
	},
	{
		files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
		plugins: {
			prettier: prettierPlugin,
		},
		rules: {
			...prettierPlugin.configs.recommended.rules,
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'capitalized-comments': 'off',
			'max-params': 'off',
			'no-promise-executor-return': 'off',
			radix: 'off',
		},
	},
	{
		files: reactFiles,
		...eslintReact.configs['recommended-typescript'],
	},
);
