# taskwire

A small CLI for managing project tasks from any AI agent (or by hand). Zero dependencies, runs on Node 24.

Agents run plain shell commands and get compact JSON back, so it works with any model or tool. Each project points to one place in a task system, and taskwire refuses to touch anything outside it.

## Providers

| Provider | Status | Docs |
|---|---|---|
| ClickUp | supported | [docs/providers/clickup.md](docs/providers/clickup.md) |

ClickUp is the first provider. Others may be added later.

## Install

```
git clone git@github.com:Richi2293/taskwire.git
ln -s "$PWD/taskwire/bin/taskwire" ~/.local/bin/taskwire
```

`~/.local/bin` must be on your `PATH`. Requires Node >= 24.7.

## Token

taskwire reads the provider's API token from the macOS Keychain (service `taskwire`):

```
security add-generic-password -a "$USER" -s taskwire -w
```

`security` prompts for the value, so the token never lands in your shell history. On Linux or CI set `TASKWIRE_API_TOKEN` instead. The token is never printed.

See the provider page for how to create the token, then check it with `taskwire whoami`.

## Project setup

Each project has a `.taskwire.json` at its root, written by `taskwire init`:

```json
{
  "provider": "clickup",
  "workspaceId": "9012345",
  "folderId": "901234567",
  "defaultListId": "901234890"
}
```

Commit it: it only holds ids, which are useless without the token. `provider` defaults to `clickup` when missing. The other fields depend on the provider (see its page).

Several projects can share one container of the task system, each limited to some of its lists: see `listIds` in the provider page. taskwire then refuses to read or write the tasks of the other projects.

### Task conventions

Add an optional `conventions` object to adapt the agent rules to this project:

```json
{
  "provider": "clickup",
  "folderId": "901234567",
  "conventions": {
    "language": "Italian",
    "instructions": "Task names in the imperative, under 80 characters. Descriptions: context first, then acceptance criteria as a list."
  }
}
```

- `language`: the language of task names, descriptions, comments and checklist items. Defaults to English. Statuses and tags keep their existing names.
- `instructions`: any other rule for agents, as free text. It is added on top of the default rules and wins when they conflict.
- `rulesFile`: a markdown file, relative to `.taskwire.json`, that replaces the default rules entirely.

All fields are optional. They are guidance for agents: the CLI does not check the text of tasks. `taskwire init --force` keeps them.

### Agent rules

`taskwire rules` prints the task management rules for AI agents, with the project conventions: the default rules of the installed version, or the project `rulesFile`. Add `--pretty` to read them as markdown. `taskwire conventions` prints only the conventions.

Paste the short block in [docs/agent-rules.md](docs/agent-rules.md) into the project's `AGENTS.md`: it tells agents to run `taskwire rules`, so the rules stay up to date when taskwire is updated.

## Commands

Run `taskwire --help`. Output is compact JSON on stdout, errors and warnings are JSON lines on stderr; add `--pretty` for a human readable view.

`taskwire tasks --search <words>` keeps the tasks whose name or description contain every word, in any order, ignoring case and accents. taskwire does the search itself on the tasks it reads, so narrow large projects with `--list` or `--status`.

`taskwire tags` lists the tags used by the project's tasks, open and closed, with how many tasks use each one, most used first. It reads every task of the project, so it takes as many requests as `taskwire tasks --include-closed`.

Other filters of `taskwire tasks`: `--due-before YYYY-MM-DD` and `--due-after YYYY-MM-DD` (the given day excluded, tasks without a due date left out), `--top-level` to leave out subtasks, and `--limit <n>` to get only the n most recently created tasks.

`taskwire task get <id>` returns the task with its comments. Add `--comments <n>` to read only the n most recent ones, or `--comments 0` to skip them: reading every comment can take several requests.

Descriptions and comments are markdown. Comments can be added (`taskwire comment add`) and edited (`taskwire comment update <comment-id> --task <task-id>`), for example to rewrite them after the project's conventions change. Editing changes only the text: the comment must belong to the given task, and taskwire checks that the task is in the project. Comments cannot be deleted.

Due dates (`--due YYYY-MM-DD`) are set to midnight in your system time zone, and `due` in the output is shown in that zone with its offset (`2026-10-01T00:00:00+02:00`). Set `TZ` to use another zone. Other timestamps are UTC.

`taskwire task update <id> --due none` removes the due date, and `--priority none` removes the priority.

`taskwire task update <id> --list <list-id>` moves a task to another list of the project, together with its subtasks. `--parent <task-id>` makes it a subtask of another task of the project. A subtask cannot be moved to another list on its own, and some providers do not allow detaching a subtask from its parent (see the provider page).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | provider API or network error |
| 2 | wrong command usage |
| 3 | configuration: missing token, missing `.taskwire.json`, unsupported provider, resource outside the project |

## Tests

```
node --test
```

## License

[MIT](LICENSE)
