# taskwire-orchestrator (experimental)

Lets AI agents work on the tasks of your projects on their own, through taskwire, and leaves you only the decisions, the reviews and the checks a machine cannot make.

It is at an early stage and not published: run it from a clone of this repository. It follows only the projects you add, and talks to taskwire through its CLI, like any agent, so every taskwire check applies to it too.

## Commands

```
orchestrator/bin/taskwire-orchestrator add <folder> [--test-command <command>]
orchestrator/bin/taskwire-orchestrator list
orchestrator/bin/taskwire-orchestrator next
orchestrator/bin/taskwire-orchestrator run-once
```

- `add` follows a project already set up with taskwire (it has a `.taskwire.json`). `--test-command` is the command that runs the project tests, from the project folder.
- `list` shows the projects it follows.
- `next` shows, for each project, the task an agent would work on next. It changes nothing.
- `run-once` makes one pass: for each project, an agent works on the next task (see below).

## One pass

For each project, `run-once`:

1. picks the next task and moves it to `in progress` (`workStatus`);
2. creates a git worktree for it, outside the project, in `~/.config/taskwire-orchestrator/worktrees/`, on the latest remote default branch (or the current `HEAD` without a remote), and copies `.taskwire.json` into it;
3. runs Claude Code there without interaction (`claude -p`), with instructions to work only on that task, follow `taskwire rules` and the project's `AGENTS.md`, mark the task with `needs` for a person, and never merge or close it;
4. reads the task again: if the agent did not mark it, asks it once in the same session;
5. when the agent marked the work as done (`needs-review` or `needs-test`), checks it without trusting it:
   - runs the project `testCommand` in the worktree; if the tests fail, sends the output to the author once and runs them again;
   - starts a separate verifier agent that checks each acceptance criterion as a person would, keeps checked only what it verified, and marks the task `needs-review` (all verified) or `needs-test` (with steps for the criteria only a person can check);
   - if the verifier finds a problem, sends it to the author once, then runs the tests and the verifier again;
6. marks the task `needs-review` itself, with a comment, when something could not end well: no mark from the agent, a failed run, tests that still fail, a verifier with no verdict or still finding problems;
7. appends the run to `runs.jsonl` (task, times, cost of every agent session, tests, verdict, outcome, worktree, log) and keeps the output in `logs/`.

Before the first project, tasks left `in progress` by a pass that was cut short are marked `needs-review`. The worktrees stay after the run, so you can look at the work; the agent's branch lives in the project repository.

The orchestrator needs a taskwire with `needs` (newer than 0.1.6): set `taskwireCommand` to a clone until it is released. The agent gets the same taskwire: the orchestrator links it in `~/.config/taskwire-orchestrator/bin/` and puts that folder first on the agent's `PATH`.

## Permissions and sandbox

By default the agent runs with every permission (`--dangerously-skip-permissions`) inside its worktree, so it can push and open pull requests when the project rules ask for it.

With `"sandbox": true` the agent runs in the Claude Code sandbox (`--permission-mode auto`, no prompts): it cannot write outside the worktree and reaches only the task system API and the `allowedDomains` of the project. Checked on 2026-09-27 with Claude Code 2.1.283 on macOS:

- taskwire works in the sandbox, Keychain included, because the orchestrator sets `NODE_USE_ENV_PROXY=1`: the sandbox routes the network through a proxy, and Node's `fetch` uses it only with that variable;
- tests, branches and commits work;
- `git` over SSH and `gh` do not reach GitHub, even with `github.com` allowed or with `excludedCommands`: a sandboxed agent can only commit locally.

## Which task comes next

A task is picked when:

- its status is one of the start statuses of the project (`backlog` and `to do` by default);
- it does not wait for a person (no `needs` mark, see `taskwire task update --needs`);
- it does not have the block tag (`no-agent` by default), which keeps agents away from a task;
- it has no open subtasks, since the work is in the subtasks.

Among those, the highest priority comes first, then the oldest task.

## Configuration

The config lives in `~/.config/taskwire-orchestrator/config.json` (set `TASKWIRE_ORCHESTRATOR_HOME` to use another folder). `add` writes it; you can also edit it by hand.

```json
{
  "taskwireCommand": "/path/to/taskwire/bin/taskwire",
  "projects": [
    { "path": "/Users/jane/code/website", "testCommand": "npm test", "startStatuses": ["to do"], "blockTag": "manual" }
  ]
}
```

| Field | Meaning |
|---|---|
| `taskwireCommand` | the taskwire command to run; defaults to `taskwire` on the PATH. Point it to a clone to try an unreleased taskwire |
| `projects[].path` | absolute path of the project folder |
| `projects[].testCommand` | command that runs the project tests |
| `projects[].startStatuses` | statuses tasks are picked from |
| `projects[].blockTag` | tag that keeps agents away from a task |
| `projects[].workStatus` | status a task moves to when an agent takes it (default `in progress`) |
| `projects[].sandbox` | `true` to run agents in the Claude Code sandbox |
| `projects[].allowedDomains` | extra domains a sandboxed agent may reach |

## Development

Same rules as taskwire (see [AGENTS.md](../AGENTS.md)): Node 24.7 or later, TypeScript run directly, no dependencies, `node --test` from the repository root runs these tests too.
