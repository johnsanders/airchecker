# CLAUDE.md

Election-night tooling, as an npm-workspaces monorepo. Greenfield TypeScript/Node.

- **[`packages/checker`](packages/checker/CLAUDE.md)**: Eagle Eye, the observer. It reconciles the DDHQ results API, the Chameleon graphics DB, and the on-air picture captured from a DirecTV player, and flags inconsistencies for human review. This is the product.
- **[`packages/simulator`](packages/simulator/CLAUDE.md)**: election night on demand. It records the DDHQ and Chameleon APIs and plays a recording back on mirror endpoints, or runs an invented night behind all three sources: the mirrors plus a simulated air feed (`/air/`) built from hand-built copies of the on-air graphics. The checker's **Sim** mode watches it. Formerly the sibling repo `elex_sim`.

Each package's CLAUDE.md has its architecture, layout and commands. This file covers what the two share.

## Quick start

```bash
npm install          # at the root; installs both packages (the web clients install themselves via frontend:build)
npm test             # both packages' suites, each run from its own directory
npx tsc --noEmit     # one root tsconfig covers both packages
npx eslint .         # one root config covers both packages
```

The repo-wide files live only at the root: `tsconfig.json`, `eslint.config.js`, `.prettierrc.js`, `.prettierignore`, `.gitignore`, `.vscode/`, `package-lock.json`, and the shared devDependencies (TypeScript, tsx, vitest, eslint, prettier, `@types/*`) in the root `package.json`. The package `package.json` files hold only runtime dependencies and scripts. Each web client (`packages/*/src/web/client`) is its own npm project with its own tsconfig and lockfile, and sits outside the workspaces.

**npm scripts are only for what a human types.** Run them from the package directory (`cd packages/checker && npm run backend`) or from the root with `-w` (`npm run backend -w checker`). Dev tools run directly from the package directory: `node --env-file-if-exists=../../.env --import tsx src/tools/<tool>.ts`. There are no lint or format scripts: `npx eslint --fix <changed files>`, hand-fix what's left, then `npx eslint .`. Don't add convenience scripts.

**One `.env`, at the root** (gitignored). The checker needs `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET` and `DDHQ_GRANT_TYPE`, plus `OPENROUTER_API_KEY` for model trials. The simulator needs the same three DDHQ vars. Each package's scripts load it with `--env-file-if-exists=../../.env`.

**Runtime data stays inside its package**, resolved relative to the package directory: `packages/checker/recordings/` (sessions, `settings.sqlite`, and the committed goldens and reference frames) and `packages/simulator/recordings/` + `settings.json`. That's why tests and servers run with cwd = their package.

## Coding style

Carried over from the user's other TS/React work; defaults until said otherwise.

- **Arrow functions always.** `const foo = () => {}`, not `function foo() {}`. Exceptions: generators, hoisting required.
- **Named exports; `export default foo` only when a file exports a single value.** Never anonymous default exports.
- **No `any`.** Find the right type. Ask before resorting to `any`.
- **No lint / prettier / TS disables** without asking first.
- **Functional iteration** (`map`/`filter`/`reduce`/`find`) over `for...of` or `forEach + push`.
- **Don't destructure imports or props/objects unnecessarily.** `props.foo` and `React.useEffect` preferred — keeps origin visible.
- **Descriptive variable names.** `time` not `t`, `target` not `tgt`.
- **Omit braces** for single-statement functions and loops; **omit `return`** for immediate-return arrows.
- **Never JSX boolean shorthand.** Always `booleanProp={true}`.
- **Always type React components**: `const MyComponent: React.FC<Props> = (props) => ...`.
- **Don't worry about import sorting.** ESLint auto-fixes.

## Working style

- **Surface clever or complicated approaches before implementing them.** If a request seems to require a non-obvious abstraction, a clever state machine, or a tricky concurrency pattern, pause and lay out the tradeoff with a simpler alternative. The user prefers simple.
- **Pause at meaningful slice boundaries.** Don't drive ten modules in one go without checking back; ask "want me to push on or pause?" after a complete, testable slice.
- **Don't bombard with questions** during exploration — make reasonable calls and keep moving. Stop only when genuinely blocked (missing input, decision only the user can make).

## TypeScript conventions

- `tsconfig.json` is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Write code that respects these from the start.
- ESM (`"type": "module"`). Imports use `.js` extensions even for `.ts` source (Node ESM resolution).
- **Zod only at source boundaries.** Provider/vendor JSON gets parsed through a zod schema; everything past that is pure typed TS. Internal modules don't validate; they trust types.
- **Packages don't import each other yet.** The simulator carries its own copy of the DDHQ auth and HTTP helpers. Ask before introducing cross-package imports or a shared package.

## Don't

- **Don't add features, refactors, or abstractions beyond what the task requires.** A bug fix doesn't need surrounding cleanup.
- **Don't add error handling, fallbacks, or validation for scenarios that can't happen.** Trust internal code and framework guarantees. Only validate at boundaries.
- **Don't add backwards-compat shims or `// removed` comments.** If something is unused, delete it.
- **Don't write comments that explain WHAT the code does** — well-named identifiers do that. Comment only WHY (hidden constraints, invariants, surprising behavior).

## References

- **Sibling project** for general TS/React/Puppeteer patterns (orthogonal domain — don't import its content): `/Users/jsanders/Developer/nn-toolbox` _(external, not in this repo)_
