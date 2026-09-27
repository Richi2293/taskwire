import { readFileSync } from 'node:fs';
import { findConfigPath } from '../config.ts';
import { packageInfo } from '../package-info.ts';
import type { UpdateNotice } from '../update-check.ts';
import type { Context } from './context.ts';

export interface SetupOut {
  version: string;
  // The .taskwire.json of the project (maybe in a parent folder), or null when the project is not set up yet.
  configured: string | null;
  guide: string;
  agentsBlock: string;
  update: UpdateNotice | null;
}

// Both ship with taskwire, so every project gets the guide and the block of the installed version.
const GUIDE_URL = new URL('../../rules/setup.md', import.meta.url);
const AGENTS_BLOCK_URL = new URL('../../rules/agents-block.md', import.meta.url);

// Needs no token and no provider call: it is what an agent runs in a project that is not set up yet.
export async function setup(ctx: Context): Promise<SetupOut> {
  return {
    version: packageInfo().version,
    configured: findConfigPath(ctx.cwd),
    guide: readFileSync(GUIDE_URL, 'utf8'),
    agentsBlock: readFileSync(AGENTS_BLOCK_URL, 'utf8'),
    update: await ctx.checkUpdate(),
  };
}

// --pretty shows the guide and the block as plain markdown, like "rules --pretty".
export function formatSetup(out: SetupOut): string {
  const update = out.update === null
    ? []
    : [`Update available: taskwire ${out.update.latest} (installed ${out.version}). Tell the user and ask before running: ${out.update.command}\n`];
  return [
    `# taskwire setup (v${out.version})\n`,
    ...update,
    `Configured: ${out.configured ?? 'no'}\n`,
    withNewline(out.guide),
    '## Block for AGENTS.md\n',
    withNewline(out.agentsBlock),
  ].join('\n');
}

function withNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
