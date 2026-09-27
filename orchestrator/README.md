# taskwire-orchestrator (experimental)

Lets AI agents work on the tasks of your projects on their own, through taskwire, and leaves you only the decisions, the reviews and the checks a machine cannot make.

It is at an early stage and not published: run it from a clone of this repository. It follows only the projects you add, and talks to taskwire through its CLI, like any agent, so every taskwire check applies to it too.

## Commands

```
orchestrator/bin/taskwire-orchestrator add <folder> [--test-command <command>]
orchestrator/bin/taskwire-orchestrator list
orchestrator/bin/taskwire-orchestrator next
orchestrator/bin/taskwire-orchestrator run-once
orchestrator/bin/taskwire-orchestrator start
```

- `add` follows a project already set up with taskwire (it has a `.taskwire.json`). `--test-command` is the command that runs the project tests, from the project folder.
- `list` shows the projects it follows.
- `next` shows, for each project, the task an agent would work on next. It changes nothing.
- `run-once` makes one pass: for each project, an agent works on the next task (see below).
- `start` opens the dashboard and runs until you press Ctrl+C. It starts **paused**: no agent takes a task until you press **Start working** on the dashboard, and **Pause** stops new work while agents already at work finish their task. Every start begins paused. While working, every `intervalMinutes` (5 by default) it starts a pass on each project that is free, with at most `maxAgents` agents at once (2 by default) and never two on the same project; pressing Start working starts the first pass at once. Projects take turns, so each gets its chance. It reads the config at every tick, so a project added with `add` joins without a restart. It prints one JSON event per line (`dashboard`, `start`, `interrupted`, `play`, `pause`, `run`, `error`, `stop`); an error in a project is logged and the others go on. After Ctrl+C it starts nothing new and waits for the running passes.

## Dashboard

Open http://127.0.0.1:4777 (`dashboardPort` to change it) while `start` runs. One page, refreshed every 30 seconds:

- **Control bar:** paused or working, with Start agents or Pause. "What happens when I start" (or "What is happening") opens the details: which task an agent takes first, when the next check for new tasks is, and how many agents are in use out of `maxAgents`.
- **Projects:** one row per project with what waits for you (to decide, to try, to review), the agent at work and how many tasks ended today, or why the project could not be read.
- **Waiting for you:** a compact queue grouped by kind, with filters. Select a task to see its detail next to the queue: the questions and the proposal of the agent for a decision, what the agents already checked and the steps by hand for a test, or the agent's note. These come from the fixed sections of the agent's comment (see `taskwire rules`); without them the page shows the part for people of the comment.
- **Done recently:** the runs of `runs.jsonl`, by day.

Each task waiting for you has its actions, all done through taskwire:

- **Send answer** (a decision): adds your answer as a comment and clears the mark, so an agent takes the task up again; **Accept the proposal** does the same with "Go ahead with your proposal.";
- **It works** (a test by hand) or **Approve** (a review): clears the mark; merging and closing the task stay with you;
- **Something is wrong** or **Request changes**: adds what the agent should fix as a comment, clears the mark and moves the task back to a start status; the agent continues in the same worktree and branch;
- **Keep agents away from this task**, under More: adds the block tag (`no-agent`).

Your comments start with "Answer from the person, via the dashboard:", since they come from the same account as the agents. Before any action the dashboard reads the task again and refuses the action if the task no longer waits for that. The page does not refresh while you type.

It reads the task system at most once a minute per query, to stay under the rate limit of the free ClickUp plan. It listens on 127.0.0.1 only and refuses requests for any other host name. Actions need a token that changes at every start and is only in the page. Task names and comments are shown as text, never as HTML.

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
  "maxAgents": 2,
  "intervalMinutes": 5,
  "projects": [
    { "path": "/Users/jane/code/website", "testCommand": "npm test", "startStatuses": ["to do"], "blockTag": "manual" }
  ]
}
```

| Field | Meaning |
|---|---|
| `maxAgents` | how many agents may work at once, across projects (default 2) |
| `intervalMinutes` | minutes between two looks at the projects in `start` (default 5) |
| `dashboardPort` | port of the dashboard on 127.0.0.1 (default 4777) |
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
