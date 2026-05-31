import eslintReact from '@eslint-react/eslint-plugin';
import perfectionist from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// React lives in the (planned) Fastify web view. Scope JSX-aware rules there only.
const reactFiles = ['src/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'];

export default defineConfig(
	{
		ignores: ['node_modules/', 'dist/', 'recordings/', 'coverage/'],
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
