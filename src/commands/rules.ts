import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { configError } from '../errors.ts';
import { packageInfo } from '../package-info.ts';
import type { UpdateNotice } from '../update-check.ts';
import { conventions } from './setup.ts';
import { projectConfig } from './context.ts';
import type { Context } from './context.ts';
import { groupOut, shownGroup } from './group-context.ts';
import type { LocatedGroup } from './group-context.ts';

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
  // The area of the project in a shared task list, explained at the end of the rules; null when it has none.
  area: string | null;
  // The group of the project on this machine, whose areas the area section lists; null when it has none.
  group: string | null;
  // A newer taskwire on npm, or null when there is none or the check was skipped.
  update: UpdateNotice | null;
}

// The rules ship with taskwire, so every project reads the ones of the installed version.
const DEFAULT_RULES_URL = new URL('../../rules/tasks.md', import.meta.url);
const AREA_RULES_URL = new URL('../../rules/areas.md', import.meta.url);
const NO_GROUP_RULES_URL = new URL('../../rules/areas-no-group.md', import.meta.url);

export async function rules(ctx: Context): Promise<RulesOut> {
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
  // The area section explains taskwire's own options, so it is added to a project rules file too.
  const area = config.area ?? null;
  // The group matters only for the area section, so a project without an area never reads it.
  const located = area === null ? null : shownGroup(ctx);
  if (area !== null) text = `${text}\n${areaRules(area, located)}`;
  const update = await ctx.checkUpdate();
  return {
    version: packageInfo().version,
    scope: RULES_SCOPE,
    rulesSource,
    rules: text,
    conventions: conventions(ctx),
    area,
    group: located?.name ?? null,
    update,
  };
}

// The area section, with the areas of the group as a table, or how to record the group when there is none.
function areaRules(area: string, located: LocatedGroup | null): string {
  const group = located === null ? readFileSync(NO_GROUP_RULES_URL, 'utf8').trimEnd().replaceAll('{area}', area) : groupTable(located);
  // A function, so that a "$" in a description is not read as a replacement pattern.
  return readFileSync(AREA_RULES_URL, 'utf8').replaceAll('{area}', area).replace('{group}', () => group);
}

function groupTable(located: LocatedGroup): string {
  const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|');
  const rows = groupOut(located).areas.map((entry) => {
    const name = entry.own ? `\`${entry.name}\` (this project)` : `\`${entry.name}\``;
    const code = entry.path === null ? 'no code' : `\`${entry.path}\``;
    return `| ${name} | ${cell(entry.description)} | ${code} |`;
  });
  return [
    `The group \`${located.name}\` has these areas (\`taskwire group\`), with the folder of the code of each:`,
    '',
    '| Area | Description | Code |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
}

// --pretty shows the rules as plain markdown, which reads better than escaped JSON.
export function formatRules(out: RulesOut): string {
  const { language, instructions } = out.conventions;
  const rulesText = out.rules.endsWith('\n') ? out.rules : `${out.rules}\n`;
  const update = out.update === null
    ? []
    : [`Update available: taskwire ${out.update.latest} (installed ${out.version}). Tell the user and ask before running: ${out.update.command}\n`];
  return [
    `# taskwire rules (v${out.version})\n`,
    ...update,
    `${out.scope}\n`,
    rulesText,
    '## Project conventions\n',
    `- Language: ${language}\n- Instructions: ${instructions ?? 'none'}\n`,
  ].join('\n');
}
