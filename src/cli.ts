import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { CommandInput } from './args.ts';
import { flag } from './args.ts';
import { createClient } from './client.ts';
import type { FetchFn } from './client.ts';
import { CONFIG_FILE, findConfig } from './config.ts';
import { EXIT, TaskwireError, configError, usageError } from './errors.ts';
import { printError, printResult } from './output.ts';
import type { Writer } from './output.ts';
import { resolveToken } from './token.ts';
import type { KeychainReader } from './token.ts';
import type { Context } from './commands/context.ts';
import { folders, init, whoami } from './commands/setup.ts';

export interface CommandSpec {
  options: ParseArgsOptionsConfig;
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
Output is JSON on stdout; errors are JSON on stderr.
Exit codes: 0 ok, 1 ClickUp or network error, 2 usage error, 3 configuration error.
`;

const GLOBAL_OPTIONS: ParseArgsOptionsConfig = {
  pretty: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const COMMANDS: Record<string, CommandSpec> = {
  whoami: { options: {}, needsConfig: false, run: (ctx) => whoami(ctx) },
  folders: { options: {}, needsConfig: false, run: (ctx) => folders(ctx) },
  init: {
    options: { folder: { type: 'string' }, list: { type: 'string' }, force: { type: 'boolean' } },
    needsConfig: false,
    run: (ctx, input) => init(ctx, input),
  },
};

function resolveCommand(argv: string[]): { spec: CommandSpec; rest: string[] } | null {
  const words = argv.filter((arg) => !arg.startsWith('-')).slice(0, 2);
  if (words.length === 0) return null;
  const twoWords = words.length === 2 ? `${words[0]} ${words[1]}` : '';
  const key = twoWords !== '' && COMMANDS[twoWords] ? twoWords : words[0];
  const spec = COMMANDS[key];
  if (spec === undefined) throw usageError(`Unknown command "${words.join(' ')}"`, 'Run "taskwire --help"');
  const consumed = key.split(' ').length;
  const rest = [...argv];
  for (let removed = 0; removed < consumed; removed++) {
    rest.splice(rest.findIndex((arg) => !arg.startsWith('-')), 1);
  }
  return { spec, rest };
}

function parseInput(spec: CommandSpec, rest: string[]): CommandInput {
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...spec.options, ...GLOBAL_OPTIONS },
      allowPositionals: true,
      strict: true,
    });
    return { values, positionals };
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error), 'Run "taskwire --help"');
  }
}

export async function main(deps: CliDeps): Promise<number> {
  const pretty = deps.argv.includes('--pretty');
  let token: string | undefined;
  try {
    const resolved = resolveCommand(deps.argv);
    if (resolved === null || deps.argv.includes('--help')) {
      deps.stdout.write(HELP);
      return EXIT.ok;
    }
    const input = parseInput(resolved.spec, resolved.rest);
    const found = findConfig(deps.cwd);
    if (resolved.spec.needsConfig && found === null) {
      throw configError(
        `No ${CONFIG_FILE} found in ${deps.cwd} or its parents`,
        'Run "taskwire folders" to find the folder id, then "taskwire init --folder <id>"',
      );
    }
    token = resolveToken(deps.readKeychain, deps.env);
    const client = createClient({ token, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
    const ctx: Context = { client, config: found?.config ?? null, cwd: deps.cwd };
    const result = await resolved.spec.run(ctx, input);
    printResult(deps.stdout, result, pretty || flag(input.values, 'pretty'));
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
