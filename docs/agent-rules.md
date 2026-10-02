# Agent rules

AI agents get the task management rules from taskwire itself: `taskwire rules` prints the rules of the installed version together with the project conventions. Updating taskwire updates the rules in every project, with no change to the project files.

The rules cover only task management (tasks, comments, checklists, dependencies, statuses). They do not change how agents write code, commits or pull requests. The default rules are in [rules/tasks.md](../rules/tasks.md).

## Project setup

The simplest way is to let an agent do it. From the project root, tell it:

```
Set up taskwire in this project: run `taskwire setup` and follow it.
```

`taskwire setup` prints a guide for the agent ([rules/setup.md](../rules/setup.md)) and the block for the project's `AGENTS.md`. The agent checks the token, asks which folder, lists and language to use, runs `taskwire init`, adds the block to `AGENTS.md` and asks whether to commit `.taskwire.json`.

To do it by hand, paste the block from [rules/agents-block.md](../rules/agents-block.md) into the `AGENTS.md` of the project. If the project also has a `CLAUDE.md`, make it reference `AGENTS.md`. The block is short on purpose and should not need updates.

Projects set up before `taskwire rules` existed have a longer block copied from this page, projects set up with taskwire 0.1.2 lack the install line, and projects set up with taskwire 0.1.6 or earlier lack the in-progress line: replace the block with the one in [rules/agents-block.md](../rules/agents-block.md).

## Project overrides

The defaults apply unless the project chooses otherwise, in the `conventions` of `.taskwire.json`:

- `language` and `instructions` are added on top of the default rules and win when they conflict. Use `instructions` for project habits, for example a status flow or a naming rule. `taskwire init --language <l> --instructions <text>` writes them.
- `rulesFile` replaces the default rules entirely with a markdown file, given as a path relative to `.taskwire.json`. The project then no longer gets rule updates from taskwire, so use it only when the defaults do not fit at all.

```json
{
  "conventions": {
    "language": "Italian",
    "instructions": "Move a task to complete only after the merge.",
    "rulesFile": "docs/task-rules.md"
  }
}
```

## Projects that share a task list

Several projects of one product (for example the backend, the frontend and the app) may share one task list. Each project then sets its `area` in `.taskwire.json`, a tag such as `be`, `fe` or `mobile`, with `taskwire area set <tag>` or `taskwire init --area <tag>`. The area is meant for projects in separate repositories: a monorepo with a single `.taskwire.json` leaves it out and sees every task.

With an area, `taskwire tasks` shows only the tasks with its tag, `taskwire task create` adds the tag, and `taskwire rules` ends with a section ([rules/areas.md](../rules/areas.md)) that tells agents how to reach the other areas and how to split a task that touches several of them. Writes are not limited to the area: an agent may comment on a task of another area or create its subtask there.

## Tasks waiting for a person

The rules ask agents to mark a task when the work stops because a person is needed, with `taskwire task update <id> --needs decision|test|review`, and to explain in a comment what the person must do. The mark is a tag, so it also shows and filters in the task system UI. Agents leave these tasks alone and never clear the mark: the person clears it (`--needs none`, or by removing the tag) as the go-ahead. The tag names can be changed with `needsTags` in `.taskwire.json`.

The comment opens its details with fixed English headings, whatever the project language, so tools can show them: `### Questions` and `### Proposal` for a decision, `### Checked` and `### By hand` for a test by hand.

## Sources of the writing rules

The writing rules follow plain language and web readability guidance: the [inverted pyramid](https://www.nngroup.com/articles/inverted-pyramid/) and [concise, scannable text](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/) (Nielsen Norman Group), the [GOV.UK style guide](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/) (sentences over 25 words, bullets, numbered steps) and the [Federal Plain Language Guidelines](https://wid.org/wp-content/uploads/2022/03/FederalPLGuidelines.pdf) (short sentences, active voice).
