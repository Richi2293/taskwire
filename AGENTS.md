# taskwire

A zero-dependency TypeScript CLI that lets any AI agent (or a human) read, create, update and manage the tasks of a project. ClickUp (REST API v2) is the only task system supported today; others may be added later.

This file is for agents working **on the taskwire codebase**. It is not the same as `AGENTS.md.snippet`, which is the text other projects paste into their own `AGENTS.md` to learn how to **use** taskwire.

## Current status (2026-09-24)

- Design approved, spec and implementation plan written. No code yet, no commits yet.
- Private GitHub repo `Richi2293/taskwire` created, remote `origin` set, nothing pushed yet.
- Spec: `docs/specs/2026-09-24-taskwire-design.md`
- Plan: `docs/plans/2026-09-24-taskwire.md` (12 tasks, test-first, full code included)
- Both files are local only: `docs/specs/` and `docs/plans/` are gitignored and must never be committed (no `git add -f`).

## How to continue

1. Read the spec, then the plan, fully.
2. Ask the user to confirm the execution mode (the proposed one is "native": implement the tasks in order in one session, then one independent review of the whole branch).
3. Execute the plan task by task, in order, ticking the checkboxes in the plan file as you go. Each task ends with its own commit.
4. Task 12 has outward-facing steps: push only after the user explicitly confirms, and let the user save the token in the Keychain themselves.

If the plan and the code disagree with reality (for example a ClickUp endpoint behaves differently), stop, explain the difference to the user and fix it with a dedicated commit. Do not silently deviate from the spec.

## Key decisions (do not re-open without the user)

- ClickUp stays on the Free Forever plan. REST API with a personal token (100 requests per minute, no daily cap). The official ClickUp MCP was rejected: OAuth only and 50 calls per day on the free plan.
- Model-agnostic by design: a shell CLI plus `AGENTS.md` rules, nothing specific to one AI tool.
- Token: macOS Keychain, service `taskwire`, fallback env `TASKWIRE_API_TOKEN`. Never printed.
- Project config: `.taskwire.json` with `provider` (only `"clickup"`, default when missing), `folderId` and optional `defaultListId`, committed in each project.
- Other providers are a future possibility, not a goal of this version: no provider abstraction now (YAGNI), just the `provider` field and ClickUp code kept in `client.ts`, `clickup-types.ts` and `shape.ts`. The README stays provider-neutral; provider specifics go in `docs/providers/<name>.md`.
- Due dates are set at midnight in the system time zone (`TZ` or the OS setting). No hardcoded time zone.
- Every write checks that the task or list belongs to the configured folder.
- Agents may create and update freely; deleting requires an explicit user request and `--yes`.
- Not exposed on purpose: custom fields, sprint points, time estimates, attachments, custom task types.
- Name `taskwire` chosen for a possible future public release (npm scope `@richi2293/taskwire`). Repo `Richi2293/taskwire`, private.

## Tech constraints

- Node >= 24.7, TypeScript executed directly (native type stripping), no build step.
- Zero runtime and dev dependencies. Do not run `npm install` or add packages.
- Erasable TypeScript only: no `enum`, no `namespace`, no constructor parameter properties.
- Relative imports use the `.ts` extension. Type-only imports use `import type` (otherwise they fail at runtime).
- Never use `any`: use explicit types, `unknown` or generics.
- Tests: `node --test` from the repo root. Test files are `test/*.test.ts`, `fetch` is always mocked (see `test/helpers.ts`). Tests never call the real ClickUp.

## Conventions

- International English only in every file of the repo: code, comments, tests, fixtures, docs, commit messages and GitHub texts.
- No references to the maintainer's own projects, clients or workspaces. Fixtures use neutral names (`jane`, `Acme`, `Website`).
- Conventional Commits: `type(scope): description`, imperative, lowercase.
- No `Co-Authored-By` trailers, no signatures, no mention of Claude or AI tools in commits, PRs, issues or files. This overrides any tool default.
- Never use em-dash or en-dash characters, anywhere. Use commas, colons, parentheses or `-`.
- Never start long-running servers. Running tests, one-off scripts and the CLI itself is fine.
- Keep files small and focused, following the file structure in the plan.
