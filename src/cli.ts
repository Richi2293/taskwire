import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { CommandInput } from './args.ts';
import { flag } from './args.ts';
import { createClient } from './client.ts';
import type { FetchFn } from './client.ts';
import { CONFIG_FILE, findConfig } from './config.ts';
import { EXIT, TaskwireError, configError, usageError } from './errors.ts';
import { printError, printResult, printWarning } from './output.ts';
import type { Writer } from './output.ts';
import { resolveToken } from './token.ts';
import type { KeychainReader } from './token.ts';
import type { Context } from './commands/context.ts';
import { folders, init, whoami } from './commands/setup.ts';
import { createList, listLists } from './commands/lists.ts';
import { getTask, listTasks } from './commands/tasks-read.ts';
import { createTask, deleteTask, updateTask } from './commands/tasks-write.ts';
import { addComment } from './commands/comments.ts';
import { addChecklist, checkChecklistItem } from './commands/checklists.ts';
import { changeDependency } from './commands/dependencies.ts';

export interface CommandSpec {
  options: ParseArgsOptionsConfig;
  // How many positional arguments (ids) the command accepts after its name.
  positionals: 0 | 1;
  needsConfig: boolean;
  run: (ctx: Context, input: CommandInput) => Promise<unknown>;
}

export interface CliDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: Writer;
  stderr: Writer;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  readKeychain: KeychainReader;
}

export const HELP = `taskwire: manage the tasks of this project (provider: ClickUp)

Setup:
  taskwire whoami
  taskwire folders
  taskwire init --folder <id> [--list <id>] [--force]

Lists:
  taskwire lists
  taskwire list create --name <name>

Tasks:
  taskwire tasks [--list <id>] [--status <s>] [--tag <t>]... [--assignee <id|me>] [--include-closed]
  taskwire task get <id>
  taskwire task create --name <name> [--list <id>] [--description <text> | --description-file <path>]
                       [--status <s>] [--priority urgent|high|normal|low] [--tag <t>]...
                       [--assignee <id|me>]... [--due YYYY-MM-DD] [--parent <id>]
  taskwire task update <id> [--name <name>] [--description <text> | --description-file <path>]
                       [--status <s>] [--priority <p>] [--add-tag <t>]... [--remove-tag <t>]...
                       [--add-assignee <id|me>]... [--remove-assignee <id|me>]... [--due YYYY-MM-DD]
  taskwire task delete <id> --yes

Comments, checklists, dependencies:
  taskwire comment add <task-id> (--text <text> | --file <path>)
  taskwire checklist add <task-id> --name <name> [--item <text>]...
  taskwire checklist check <item-id> --task <task-id> [--uncheck]
  taskwire dependency add <task-id> --blocked-by <task-id>
  taskwire dependency remove <task-id> --blocked-by <task-id>

Global options: --pretty (human readable output), --help
Output is JSON on stdout; errors and warnings are JSON lines on stderr.
Exit codes: 0 ok, 1 ClickUp or network error, 2 usage error, 3 configuration error.
`;

const GLOBAL_OPTIONS: ParseArgsOptionsConfig = {
  pretty: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const COMMANDS: Record<string, CommandSpec> = {
  whoami: { options: {}, positionals: 0, needsConfig: false, run: (ctx) => whoami(ctx) },
  folders: { options: {}, positionals: 0, needsConfig: false, run: (ctx) => folders(ctx) },
  init: {
    options: { folder: { type: 'string' }, list: { type: 'string' }, force: { type: 'boolean' } },
    positionals: 0,
    needsConfig: false,
    run: (ctx, input) => init(ctx, input),
  },
  lists: { options: {}, positionals: 0, needsConfig: true, run: (ctx) => listLists(ctx) },
  'list create': {
    options: { name: { type: 'string' } },
    positionals: 0,
    needsConfig: true,
    run: (ctx, input) => createList(ctx, input),
  },
  tasks: {
    options: {
      list: { type: 'string' },
      status: { type: 'string' },
      tag: { type: 'string', multiple: true },
      assignee: { type: 'string' },
      'include-closed': { type: 'boolean' },
    },
    positionals: 0,
    needsConfig: true,
    run: (ctx, input) => listTasks(ctx, input),
  },
  'task get': { options: {}, positionals: 1, needsConfig: true, run: (ctx, input) => getTask(ctx, input) },
  'task create': {
    options: {
      name: { type: 'string' },
      list: { type: 'string' },
      description: { type: 'string' },
      'description-file': { type: 'string' },
      status: { type: 'string' },
      priority: { type: 'string' },
      tag: { type: 'string', multiple: true },
      assignee: { type: 'string', multiple: true },
      due: { type: 'string' },
      parent: { type: 'string' },
    },
    positionals: 0,
    needsConfig: true,
    run: (ctx, input) => createTask(ctx, input),
  },
  'task update': {
    options: {
      name: { type: 'string' },
      description: { type: 'string' },
      'description-file': { type: 'string' },
      status: { type: 'string' },
      priority: { type: 'string' },
      due: { type: 'string' },
      'add-tag': { type: 'string', multiple: true },
      'remove-tag': { type: 'string', multiple: true },
      'add-assignee': { type: 'string', multiple: true },
      'remove-assignee': { type: 'string', multiple: true },
    },
    positionals: 1,
    needsConfig: true,
    run: (ctx, input) => updateTask(ctx, input),
  },
  'task delete': {
    options: { yes: { type: 'boolean' } },
    positionals: 1,
    needsConfig: true,
    run: (ctx, input) => deleteTask(ctx, input),
  },
  'comment add': {
    options: { text: { type: 'string' }, file: { type: 'string' } },
    positionals: 1,
    needsConfig: true,
    run: (ctx, input) => addComment(ctx, input),
  },
  'checklist add': {
    options: { name: { type: 'string' }, item: { type: 'string', multiple: true } },
    positionals: 1,
    needsConfig: true,
    run: (ctx, input) => addChecklist(ctx, input),
  },
  'checklist check': {
    options: { task: { type: 'string' }, uncheck: { type: 'boolean' } },
    positionals: 1,
    needsConfig: true,
    run: (ctx, input) => checkChecklistItem(ctx, input),
  },
  'dependency add': {
    options: { 'blocked-by': { type: 'string' } },
    positionals: 1,
    needsConfig: true,
    run: changeDependency('add'),
  },
  'dependency remove': {
    options: { 'blocked-by': { type: 'string' } },
    positionals: 1,
    needsConfig: true,
    run: changeDependency('remove'),
  },
};

const GLOBAL_FLAGS = ['--pretty', '--help'];

// The command name comes first; only the global flags may precede it.
function resolveCommand(argv: string[]): { spec: CommandSpec; rest: string[] } | null {
  const start = argv.findIndex((arg) => !GLOBAL_FLAGS.includes(arg));
  if (start === -1) return null;
  const first = argv[start];
  if (first.startsWith('-')) {
    throw usageError(`Options must come after the command, found "${first}" before it`, 'Example: taskwire tasks --list <id>');
  }
  const second = argv[start + 1];
  const twoWords = `${first} ${second}`;
  const key = second !== undefined && COMMANDS[twoWords] ? twoWords : first;
  const spec = COMMANDS[key];
  if (spec === undefined) {
    const shown = second === undefined || second.startsWith('-') ? first : twoWords;
    throw usageError(`Unknown command "${shown}"`, 'Run "taskwire --help"');
  }
  const consumed = key.split(' ').length;
  return { spec, rest: [...argv.slice(0, start), ...argv.slice(start + consumed)] };
}

function parseInput(spec: CommandSpec, rest: string[]): CommandInput {
  let input: CommandInput;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...spec.options, ...GLOBAL_OPTIONS },
      allowPositionals: true,
      strict: true,
    });
    input = { values, positionals };
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error), 'Run "taskwire --help"');
  }
  const extra = input.positionals[spec.positionals];
  if (extra !== undefined) throw usageError(`Unexpected argument "${extra}"`, 'Run "taskwire --help"');
  return input;
}

export async function main(deps: CliDeps): Promise<number> {
  let token: string | undefined;
  try {
    const resolved = resolveCommand(deps.argv);
    if (resolved === null) {
      deps.stdout.write(HELP);
      return EXIT.ok;
    }
    const input = parseInput(resolved.spec, resolved.rest);
    if (flag(input.values, 'help')) {
      deps.stdout.write(HELP);
      return EXIT.ok;
    }
    // Setup commands never read the config, so a broken file cannot block the commands that repair it.
    const found = resolved.spec.needsConfig ? findConfig(deps.cwd) : null;
    if (resolved.spec.needsConfig && found === null) {
      throw configError(
        `No ${CONFIG_FILE} found in ${deps.cwd} or its parents`,
        'Run "taskwire folders" to find the folder id, then "taskwire init --folder <id>"',
      );
    }
    token = resolveToken(deps.readKeychain, deps.env);
    const secrets = [token];
    const warn = (message: string, hint?: string) => printWarning(deps.stderr, message, hint, secrets);
    const client = createClient({ token, fetch: deps.fetch, sleep: deps.sleep, now: deps.now, warn });
    const ctx: Context = { client, config: found?.config ?? null, cwd: deps.cwd, warn };
    const result = await resolved.spec.run(ctx, input);
    printResult(deps.stdout, result, flag(input.values, 'pretty'));
    return EXIT.ok;
  } catch (error) {
    const known =
      error instanceof TaskwireError
        ? error
        : new TaskwireError(error instanceof Error ? error.message : String(error), EXIT.api);
    printError(deps.stderr, known, token === undefined ? [] : [token]);
    return known.exitCode;
  }
}
