# Set up taskwire in this project

Follow these steps in order to connect this project to its place in the task system. Run every command from the project root. Output is JSON; run `taskwire --help` for every command.

Ask the user only for the real choices (folder, lists, language, commit of the config) and for the token. Do everything else yourself, and do not ask again for what the user already told you.

1. **Already configured.** If `configured` in the output of `taskwire setup` is not `null`, the project already has a `.taskwire.json`: do not run `init` again. Tell the user where it is (it may be in a parent folder, shared with other projects), check step 7, and ask whether they want to change anything before touching it.
2. **Token.** Run `taskwire whoami`. If it fails with exit code 3, there is no token: tell the user to store it themselves, then stop until they confirm.
   - On macOS, in the Keychain: `security add-generic-password -a "$USER" -s taskwire -w` (it asks for the token).
   - Elsewhere, in the `TASKWIRE_API_TOKEN` environment variable.
   - Where to create it: https://github.com/Richi2293/taskwire/blob/main/docs/providers/clickup.md#token
   - Never ask the user to paste the token in the chat, and never print, store or log it yourself.
   - **Several accounts.** If the user has more than one account of the task system (for example one per company), ask which one this project uses and a short name for it: lowercase letters, digits and dashes, such as `acme`. Its token goes in the Keychain service `taskwire:<name>` (`security add-generic-password -a "$USER" -s taskwire:<name> -w`) or in `TASKWIRE_API_TOKEN_<NAME>` (uppercase, `-` becomes `_`). Add `--account <name>` to every command until the end of the setup, `init` included.
3. **Folder.** Run `taskwire folders` and show the user the folders (name, space, workspace). Ask which one holds this project's tasks.
4. **Lists.** Ask whether the folder belongs to this project only, or is shared with other projects (for example one folder per company and one list per project).
   - If it is shared, run `taskwire lists --folder <id>`, show the lists and ask which ones belong to this project. These become `--scope-list`.
   - Ask which list new tasks go to by default (`--list`). With a single project list, that list is already the default.
   - Ask whether other projects (for example the backend, the frontend or the app of the same product) share this project's task list. If they do, ask the short tag of this project's tasks, such as `be`, `fe` or `mobile`: it becomes `--area`. Use the same tag the other projects already use for their tasks, if any. Skip it for a monorepo with a single `.taskwire.json`. Ask also where the other projects are on this machine and which kinds of work without code share the list (servers, marketing, customer feedback): you record them as a group in step 9.
5. **Conventions.** Ask the language of tasks and comments (default: English). Ask whether there are project habits for tasks, for example a stricter status flow such as "close a task only after a check in production". Skip `--instructions` when there are none.
6. **Init.** Run one command with every choice:

   ```
   taskwire init --folder <id> [--scope-list <id>]... [--list <id>] [--language <language>] [--instructions <text>] [--area <tag>] [--account <name>]
   ```

   If it fails with exit code 2 because the config exists and the user asked to replace it, add `--force`.
7. **AGENTS.md.** Put the `agentsBlock` of `taskwire setup` in the project's `AGENTS.md`, as it is.
   - If `AGENTS.md` does not exist, create it with the block.
   - If it already has a `## Project tasks (taskwire)` section, replace that section with the block.
   - If the project has a `CLAUDE.md` that does not reference `AGENTS.md`, add a line to it that does (for example `@AGENTS.md`).
8. **Commit of the config.** Ask the user whether to commit `.taskwire.json`. It holds only ids and conventions, no secrets, but in a public repository the user may prefer to keep the workspace ids out. If not, add `.taskwire.json` to `.git/info/exclude`, so it stays local without touching `.gitignore`.
9. **Group.** Only with an area. Run `taskwire group`. If it prints `null`, record the group of projects that share the list:
   - from this project, `taskwire group init <name> --description <text>`, with a short lowercase name for the group (the product or the client) and what this project's area covers;
   - for each other project, `taskwire area add <area> --path <dir> --description <text>`, with the area its `.taskwire.json` uses;
   - for each kind of work without code, `taskwire area add <area> --description <text>`, such as `infra`.

   If it prints a group, this project is already in it: check that its areas are still right.
10. **Check.** Run `taskwire rules`: it must succeed. Then tell the user in a few lines what was set up (folder, lists, default list, area, group, language, instructions, files changed) and that from now on agents follow `taskwire rules` for tasks.

If `update` in the output of `taskwire setup` is not `null`, tell the user before step 2 and ask whether to update first with its `command`. It updates taskwire for the whole machine.
