# Agent rules

AI agents get the task management rules from taskwire itself: `taskwire rules` prints the rules of the installed version together with the project conventions. Updating taskwire updates the rules in every project, with no change to the project files.

The rules cover only task management (tasks, comments, checklists, dependencies, statuses). They do not change how agents write code, commits or pull requests. The default rules are in [rules/tasks.md](../rules/tasks.md).

## Project setup

Paste the block below into the `AGENTS.md` of every project that uses taskwire. If the project also has a `CLAUDE.md`, make it reference `AGENTS.md`. The block is short on purpose and should not need updates.

```markdown
## Project tasks (taskwire)

This project's tasks are managed with the `taskwire` CLI. Before reading or writing tasks, run `taskwire rules` and follow it: those rules apply only to task management (tasks, comments, checklists, statuses), not to the code.

- Before starting a piece of work, look for a related task with `taskwire tasks --search <words>`.
- Never put secrets, tokens or personal data in tasks or comments.
```

Projects set up before `taskwire rules` existed have a longer block copied from this page: replace it with the one above.

## Project overrides

The defaults apply unless the project chooses otherwise, in the `conventions` of `.taskwire.json`:

- `language` and `instructions` are added on top of the default rules and win when they conflict. Use `instructions` for project habits, for example a status flow or a naming rule.
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

## Sources of the writing rules

The writing rules follow plain language and web readability guidance: the [inverted pyramid](https://www.nngroup.com/articles/inverted-pyramid/) and [concise, scannable text](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/) (Nielsen Norman Group), the [GOV.UK style guide](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/) (sentences over 25 words, bullets, numbered steps) and the [Federal Plain Language Guidelines](https://wid.org/wp-content/uploads/2022/03/FederalPLGuidelines.pdf) (short sentences, active voice).
