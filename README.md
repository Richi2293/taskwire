<p align="center">
  <img src="https://raw.githubusercontent.com/Richi2293/taskwire/main/docs/assets/banner.svg" alt="taskwire. Agents forget. Tasks don't. A CLI-first task board for AI agents." width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@richi2293/taskwire"><img src="https://img.shields.io/npm/v/@richi2293/taskwire?style=flat-square&color=3dffa8&labelColor=07090d&label=npm" alt="npm version"></a>
  <a href="https://github.com/Richi2293/taskwire/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Richi2293/taskwire/test.yml?branch=main&style=flat-square&labelColor=07090d&label=tests" alt="tests"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24.7-6ad8ff?style=flat-square&labelColor=07090d" alt="Node 24.7 or later">
  <img src="https://img.shields.io/badge/dependencies-0-3dffa8?style=flat-square&labelColor=07090d" alt="zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6ad8ff?style=flat-square&labelColor=07090d" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> |
  <a href="#how-it-works">How it works</a> |
  <a href="#commands">Commands</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#roadmap">Roadmap</a>
</p>

## Why

AI coding agents are brilliant until the next morning. Every session starts from zero: the plan is in an old chat, the TODO file is stale, and the task board was never updated.

taskwire gives your agents the task board you already use. They find the task before they start, move it along while they work, and leave a comment for whoever comes next, human or agent.

<p align="center">
  <img src="https://raw.githubusercontent.com/Richi2293/taskwire/main/docs/assets/demo.svg" alt="Without taskwire, the agent does not remember yesterday. With taskwire, it reads the task in progress and its last comment, then picks up where you left off." width="100%">
</p>

## Quick start

**1. Install** (Node 24.7 or later):

```
npm install --global @richi2293/taskwire
```

**2. Store the API token** of your task system in the macOS Keychain. On Linux or CI, set `TASKWIRE_API_TOKEN` instead. [The provider page](docs/providers/clickup.md) says where to create the token.

```
security add-generic-password -a "$USER" -s taskwire -w
taskwire whoami
```

**3. Connect the project** to its place in the task system, from the project root:

```
taskwire folders
taskwire init --folder <id>
```

**4. Tell your agents.** Paste the short block from [docs/agent-rules.md](docs/agent-rules.md) into the project's `AGENTS.md`. It makes agents run `taskwire rules` first, so they always follow the rules of the installed version.

Next session, ask your agent: *"What was I doing yesterday?"*

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/Richi2293/taskwire/main/docs/assets/how-it-works.svg" alt="An AI agent runs taskwire as a shell command and gets compact JSON back. taskwire calls the task system API, only inside the project set in .taskwire.json." width="100%">
</p>

- **Any agent.** Agents run plain shell commands and read compact JSON. No server, no SDK, no plugin: if a model can run a command, it can use taskwire.
- **Rules built in.** `taskwire rules` tells agents how to handle tasks: search before starting, move the status as the work goes, write comments people can skim. Projects add their own language and habits on top.
- **Safe by default.** Every write is checked against the project in `.taskwire.json`, and anything outside it is refused. Deleting needs `--yes`.
- **Token stays secret.** It lives in the Keychain (or an environment variable) and is never printed.
- **Zero dependencies.** One small CLI on Node, nothing else to install or trust.

## Commands

| Area | Commands |
|---|---|
| Setup | `whoami`, `folders`, `init`, `rules`, `conventions` |
| Tasks | `tasks`, `task get`, `task create`, `task update`, `task delete --yes` |
| Lists and tags | `lists`, `list create`, `tags` |
| Comments | `comment add`, `comment update` |
| Checklists | `checklist add`, `check`, `add-item`, `rename-item`, `remove-item --yes` |
| Dependencies | `dependency add`, `dependency remove` |

Run `taskwire --help` for every option. A few things worth knowing:

- **Output** is compact JSON on stdout; errors and warnings are JSON lines on stderr. Add `--pretty` for a human view.
- **Search** (`taskwire tasks --search <words>`) matches every word in the name or description, ignoring case and accents.
- **Due dates** (`--due YYYY-MM-DD`) are midnight in your system time zone. Set `TZ` to use another one.
- **Descriptions and comments** are markdown.
- **Exit codes:** `0` success, `1` provider or network error, `2` wrong usage, `3` configuration problem.

## Configuration

Each project has a `.taskwire.json` at its root, written by `taskwire init`. Commit it: it holds only ids, useless without the token.

```json
{
  "provider": "clickup",
  "workspaceId": "9012345",
  "folderId": "901234567",
  "listIds": ["901234890"],
  "defaultListId": "901234890",
  "conventions": {
    "language": "English",
    "instructions": "Task names in the imperative, under 80 characters.",
    "rulesFile": "docs/task-rules.md"
  }
}
```

| Field | Meaning |
|---|---|
| `provider` | the task system; defaults to `clickup` |
| `workspaceId`, `folderId`, `listIds`, `defaultListId` | where the project lives in the task system, and its default list. `listIds` lets several projects share one container, each limited to its own lists. The exact fields depend on the provider: see [its page](docs/providers/clickup.md). |
| `conventions.language` | language of task names, descriptions, comments and checklists (default English) |
| `conventions.instructions` | any other rule for agents, added on top of the defaults and winning when they conflict |
| `conventions.rulesFile` | a markdown file, relative to `.taskwire.json`, that replaces the default rules entirely |

`taskwire init --force` rewrites the ids and keeps the conventions.

**Environment variables:** `TASKWIRE_API_TOKEN` (the token, when the Keychain is not available), `TASKWIRE_NO_UPDATE_CHECK=1` (turns off the update check), `TZ` (time zone for due dates).

### Updating

```
npm install --global @richi2293/taskwire@latest
```

`taskwire rules` checks npm for a newer version at most once a day and reports it in its `update` field, so your agent can tell you.

## Providers

| Provider | Status | Docs |
|---|---|---|
| ClickUp | supported | [docs/providers/clickup.md](docs/providers/clickup.md) |

Want another one? [Open an issue](https://github.com/Richi2293/taskwire/issues) and say which.

## Roadmap

Ideas, not promises:

- **More task systems**, driven by what people ask for.
- **An MCP server** as a second way in, next to the CLI.
- **Orchestration:** several agents sharing a backlog and handing work to each other.

## Development

Run the CLI from a clone with `./bin/taskwire`: it executes the TypeScript sources directly, with no build step. Run the tests with `node --test`. [AGENTS.md](AGENTS.md) has the rules for contributors, human or AI, and [docs/releasing.md](docs/releasing.md) explains releases.

## License

[MIT](LICENSE). The images use the JetBrains Mono font, under the [SIL Open Font License](docs/assets/fonts-license.txt).
