# taskwire

Rules for AI agents working on the taskwire codebase. The rules for agents that only use taskwire in other projects are served by `taskwire rules` from `rules/tasks.md`, the setup guide by `taskwire setup` from `rules/setup.md` and `rules/agents-block.md`, and `docs/agent-rules.md` explains how projects use them.

## Working on changes

- Agree on the design with the user before a new feature or a behavior change, then work test-first: write the test, watch it fail, then write the code.
- If the code disagrees with the real API (for example a ClickUp endpoint behaves differently than expected), stop, explain the difference to the user and fix it with a dedicated commit. Record real API facts in the provider page under `docs/providers/`.
- Do not re-open these design decisions without the user:
  - Model-agnostic: a shell CLI plus `AGENTS.md` rules, nothing specific to one AI tool.
  - The token lives in the macOS Keychain (service `taskwire`), with `TASKWIRE_API_TOKEN` as fallback. A named account (`account` in `.taskwire.json`, or `--account`) uses its own service `taskwire:<account>` and `TASKWIRE_API_TOKEN_<ACCOUNT>`, never the default token. It is never printed or logged.
  - Every write checks that the task or list belongs to the project configured in `.taskwire.json`.
  - Deleting requires `--yes`. Everything else may be created and updated freely.
  - Only free-plan features are exposed: no custom fields, sprint points, time estimates, attachments or custom task types.
  - Due dates use midnight in the system time zone. No hardcoded time zone.
  - ClickUp is the only provider. Do not build a provider abstraction until a second provider is actually planned; keep ClickUp code in `client.ts`, `clickup-types.ts` and `shape.ts`.
- `docs/specs/` and `docs/plans/` are local working notes: they are gitignored and must never be committed (no `git add -f`).
- Branches: `dev` is for development and testing, `main` holds only what the user has tested, and releases are tagged only on `main`. Both are protected and never deleted.
  - Each task gets its own branch from the latest `dev`, and its pull request goes to `dev`, merged with squash once CI passes. The PR title becomes the commit on `dev`, so it follows Conventional Commits.
  - When the user says `dev` is ready, a pull request from `dev` to `main` is merged with a merge commit, not squash, so the two branches keep the same history.
- The work on taskwire may be tracked with taskwire itself, through a local `.taskwire.json` that is never committed. When it exists, run `taskwire rules` before reading or writing tasks and follow its writing format, instead of copying the format of existing comments.

## Orchestrator

- `orchestrator/` holds an experimental, unpublished package (`taskwire-orchestrator`) that lets agents work on the tasks of several projects. It is not part of the taskwire npm package.
- It talks to taskwire only through the CLI and its JSON output, never by importing `src/`, so every taskwire check applies to it. When it needs something taskwire lacks, add it to the CLI.
- The tech constraints below apply to it too. Its tests live in `orchestrator/test/` and never run a real taskwire or a real agent.
- `orchestrator/README.md` explains how it works: the pass on a task, the project analysis, areas and groups, the dashboard, the config and the files it keeps. Read it before changing the orchestrator.
- To understand what happened in a real run (when the user tested something, or an agent did something unexpected), read the files in its folder, `~/.config/taskwire-orchestrator` (or `TASKWIRE_ORCHESTRATOR_HOME`), before asking the user. They are local to the user's Mac, never in the repo:
  1. `events.jsonl`, the diary: what the orchestrator did and when, one event per line. Filter it by `task` or `project`;
  2. `runs.jsonl` and `analyses.jsonl`: one line per run or analysis, with its sessions, outcome and the path of its `log`;
  3. that log in `logs/`: the whole output of every agent session of the run, under a heading with its role;
  4. `config.json` for the projects followed, and `claims.json` for the work in progress right now.
- These files hold real project data: quote from them only what is needed, and never copy them into the repo, a task or a pull request.

## Tech constraints

- Node >= 24.7, TypeScript executed directly (native type stripping), no build step during development. Only the release workflow compiles `src/` to `dist/` for the npm package (`tsconfig.build.json`), because Node does not strip types inside `node_modules`. Run the CLI from the repo with `./bin/taskwire`.
- Zero runtime and dev dependencies. Do not run `npm install` or add packages.
- Types are checked only in CI (`tsc` with `tsconfig.json`, installed by the `typecheck` job; the `package` job builds and installs the npm package with `scripts/check-package.sh`). Type errors do not show up in `node --test`, so keep the types correct by hand.
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
