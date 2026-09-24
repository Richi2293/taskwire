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
  "folderId": "901234567",
  "defaultListId": "901234890"
}
```

Commit it: it only holds ids, which are useless without the token. `provider` defaults to `clickup` when missing. The other fields depend on the provider (see its page).

Paste `AGENTS.md.snippet` into the project's `AGENTS.md` so every agent follows the same rules.

## Commands

Run `taskwire --help`. Output is compact JSON on stdout, errors are JSON on stderr; add `--pretty` for a human readable view.

Due dates (`--due YYYY-MM-DD`) are set to midnight in your system time zone. Set `TZ` to use another one.

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
