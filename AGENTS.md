# taskwire

Rules for AI agents working on the taskwire codebase. The rules for agents that only use taskwire in other projects are in `docs/agent-rules.md`.

## Working on changes

- Agree on the design with the user before a new feature or a behavior change, then work test-first: write the test, watch it fail, then write the code.
- If the code disagrees with the real API (for example a ClickUp endpoint behaves differently than expected), stop, explain the difference to the user and fix it with a dedicated commit. Record real API facts in the provider page under `docs/providers/`.
- Do not re-open these design decisions without the user:
  - Model-agnostic: a shell CLI plus `AGENTS.md` rules, nothing specific to one AI tool.
  - The token lives in the macOS Keychain (service `taskwire`), with `TASKWIRE_API_TOKEN` as fallback. It is never printed or logged.
  - Every write checks that the task or list belongs to the project configured in `.taskwire.json`.
  - Deleting requires `--yes`. Everything else may be created and updated freely.
  - Only free-plan features are exposed: no custom fields, sprint points, time estimates, attachments or custom task types.
  - Due dates use midnight in the system time zone. No hardcoded time zone.
  - ClickUp is the only provider. Do not build a provider abstraction until a second provider is actually planned; keep ClickUp code in `client.ts`, `clickup-types.ts` and `shape.ts`.
- `docs/specs/` and `docs/plans/` are local working notes: they are gitignored and must never be committed (no `git add -f`).

## Tech constraints

- Node >= 24.7, TypeScript executed directly (native type stripping), no build step.
- Zero runtime and dev dependencies. Do not run `npm install` or add packages.
- Erasable TypeScript only: no `enum`, no `namespace`, no constructor parameter properties.
- Relative imports use the `.ts` extension. Type-only imports use `import type` (otherwise they fail at runtime).
- Never use `any`: use explicit types, `unknown` or generics.
- Tests: `node --test` from the repo root. Test files are `test/*.test.ts` and `fetch` is always mocked (see `test/helpers.ts`). Tests never call a real provider API.
- Keep files small and focused, following the existing structure.

## Writing

- International English only in every file: code, comments, tests, fixtures, docs, commit messages and GitHub texts.
- No references to real people, projects, clients or workspaces. Fixtures use neutral names (`jane`, `Acme`, `Website`).
- The README stays provider-neutral. Provider specifics go in `docs/providers/<name>.md`.
- Never use em-dash or en-dash characters. Use commas, colons, parentheses or `-`.
- Conventional Commits: `type(scope): description`, imperative, lowercase.
- No `Co-Authored-By` trailers, signatures or mentions of AI tools in commits, PRs, issues or files.

## Running things

- Never start long-running servers. Running tests, one-off scripts and the CLI itself is fine.
- Commands that write to a real task system create real data: ask the user before running them outside tests.
