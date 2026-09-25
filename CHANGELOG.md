# Changelog

All notable changes to taskwire are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `taskwire rules` prints the task management rules for agents with the project conventions, so projects always get the rules of the installed version. `conventions.rulesFile` replaces them with a project file.
- `listIds` in `.taskwire.json` limits a project to some lists of its folder, so several projects can share one folder: taskwire refuses the tasks and lists of the others. `init --scope-list <id>` writes it.

### Changed

- The block for the `AGENTS.md` of projects is now short and points to `taskwire rules`: replace the old, longer block once.

- Comments are sent as markdown, so ClickUp shows headings, lists and quotes formatted instead of raw.
- The agent rules describe how to write descriptions and comments: a short part for people first, then the details for agents.

## [0.1.1] - 2026-09-25

### Added

- `task get --comments <n>` reads only the n most recent comments, and `--comments 0` skips them.
- `tasks --due-before`, `--due-after`, `--top-level` and `--limit` filter and shorten the task list.
- `task update --due none` and `--priority none` remove the due date and the priority.
- `task update --list <id>` moves a task and its subtasks to another list of the project, `--parent <id>` makes a task a subtask of another one.
- `checklist add-item`, `checklist rename-item` and `checklist remove-item --yes` edit the items of an existing checklist.
- `tasks --search <words>` finds tasks by words in the name or description, ignoring case and accents.

## [0.1.0] - 2026-09-25

First release. ClickUp is the only provider.

### Added

- Setup commands: `whoami`, `folders`, `init` (saves the workspace of the folder, so accounts with several workspaces work) and `conventions`.
- Task conventions in `.taskwire.json` (`language`, `instructions`) that tell agents how to write tasks in the project.
- Lists: `lists` and `list create`.
- Tasks: `tasks` with filters by list, status, tag and assignee, `task get` with subtasks, checklists, dependencies and comments, `task create`, `task update` and `task delete --yes`.
- Comments (`comment add`, `comment update`), checklists (`checklist add`, `checklist check`) and dependencies (`dependency add`, `dependency remove`).
- Every write checks that the task or list belongs to the project folder.
- Token read from the macOS Keychain (service `taskwire`), with `TASKWIRE_API_TOKEN` as fallback. The token is never printed.
- Compact JSON output on stdout, `--pretty` for a human readable view, errors and warnings as JSON lines on stderr, documented exit codes.
- Warnings for rate limit waits and truncated results. On a 429 taskwire waits and retries once.
- Due dates at midnight in the system time zone.
- Provider-neutral agent rules in `docs/agent-rules.md`.

[Unreleased]: https://github.com/Richi2293/taskwire/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Richi2293/taskwire/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Richi2293/taskwire/releases/tag/v0.1.0
