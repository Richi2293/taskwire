# Changelog

All notable changes to taskwire are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.3] - 2026-09-26

### Added

- taskwire is published on npm as `@richi2293/taskwire`: install it with `npm install --global @richi2293/taskwire`. A release workflow compiles it to JavaScript and publishes it when a version tag is pushed.
- `taskwire --version` prints the installed version.
- `taskwire rules` checks npm for a newer version at most once a day and reports it in the `update` field, with the command to install it. The agent rules ask agents to tell the user and ask before updating. `TASKWIRE_NO_UPDATE_CHECK=1` turns the check off.

### Changed

- The block for the `AGENTS.md` of projects tells agents how to install taskwire when it is missing: replace the block once.

## [0.1.2] - 2026-09-26

### Added

- `taskwire rules` prints the task management rules for agents with the project conventions, so projects always get the rules of the installed version. `conventions.rulesFile` replaces them with a project file.
- `listIds` in `.taskwire.json` limits a project to some lists of its folder, so several projects can share one folder: taskwire refuses the tasks and lists of the others. `init --scope-list <id>` writes it.
- `taskwire tags` lists the tags used in the project, with their number of tasks, so agents can reuse them.

### Changed

- The block for the `AGENTS.md` of projects is now short and points to `taskwire rules`: replace the old, longer block once.
- Comments are sent as markdown, so ClickUp shows headings, lists and quotes formatted instead of raw.
- The agent rules ask agents to assign to the user (`me`) the tasks they create and the unassigned tasks they start working on.
- The agent rules describe how to write descriptions and comments: a short part for people first, then the details for agents.
- The agent rules ask agents to move a task to the in-progress status of its list when they start working on it, instead of changing the status only at the end.
- The agent rules point to `taskwire tags` to find the tags to reuse.
- The agent rules ask agents to check the acceptance criteria in the description once verified, and before closing a task. Criteria left unchecked are listed in the closing comment, and skipped ones are struck through with the reason.

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

[Unreleased]: https://github.com/Richi2293/taskwire/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Richi2293/taskwire/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Richi2293/taskwire/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Richi2293/taskwire/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Richi2293/taskwire/releases/tag/v0.1.0
