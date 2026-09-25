import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { configError } from '../errors.ts';
import { conventions } from './setup.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';

export const RULES_SCOPE =
  'These rules apply only to task management with taskwire (tasks, comments, checklists, dependencies, statuses). ' +
  'They do not change how you write code, commits or pull requests.';

export interface RulesOut {
  version: string;
  scope: string;
  // "default", or the path of the project rules file that replaces the defaults.
  rulesSource: string;
  rules: string;
  conventions: { language: string; instructions: string | null };
}

// The rules ship with taskwire, so every project reads the ones of the installed version.
const DEFAULT_RULES_URL = new URL('../../rules/tasks.md', import.meta.url);
const PACKAGE_URL = new URL('../../package.json', import.meta.url);

export function rules(ctx: Context): RulesOut {
  const config = projectConfig(ctx);
  const rulesFile = config.conventions?.rulesFile;
  let rulesSource = 'default';
  let text: string;
  if (rulesFile === undefined || ctx.configPath === null) {
    text = readFileSync(DEFAULT_RULES_URL, 'utf8');
  } else {
    rulesSource = resolve(dirname(ctx.configPath), rulesFile);
    try {
      text = readFileSync(rulesSource, 'utf8');
    } catch {
      throw configError(`Cannot read the rules file ${rulesSource}`, 'Fix "conventions.rulesFile" in .taskwire.json, or remove it to use the default rules');
    }
  }
  return { version: packageVersion(), scope: RULES_SCOPE, rulesSource, rules: text, conventions: conventions(ctx) };
}

function packageVersion(): string {
  const data = JSON.parse(readFileSync(PACKAGE_URL, 'utf8')) as { version?: unknown };
  return typeof data.version === 'string' ? data.version : 'unknown';
}

// --pretty shows the rules as plain markdown, which reads better than escaped JSON.
export function formatRules(out: RulesOut): string {
  const { language, instructions } = out.conventions;
  const rulesText = out.rules.endsWith('\n') ? out.rules : `${out.rules}\n`;
  return [
    `# taskwire rules (v${out.version})\n`,
    `${out.scope}\n`,
    rulesText,
    '## Project conventions\n',
    `- Language: ${language}\n- Instructions: ${instructions ?? 'none'}\n`,
  ].join('\n');
}
