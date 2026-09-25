import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, runCli } from './helpers.ts';

const DEFAULT_RULES = readFileSync(new URL('../rules/tasks.md', import.meta.url), 'utf8');
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

interface RulesOut {
  version: string;
  scope: string;
  rulesSource: string;
  rules: string;
  conventions: { language: string; instructions: string | null };
}

// A project folder with its own .taskwire.json, for the cases that need files next to it.
function projectDir(conventions: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-rules-'));
  writeFileSync(join(dir, '.taskwire.json'), JSON.stringify({ provider: 'clickup', folderId: FOLDER_ID, conventions }));
  return dir;
}

test('rules prints the default rules, their scope and the project conventions without calling the provider', async () => {
  const run = await runCli(['rules']);
  assert.equal(run.code, 0);
  const out = run.json() as RulesOut;
  assert.equal(out.version, VERSION);
  assert.match(out.scope, /only to task management/);
  assert.equal(out.rulesSource, 'default');
  assert.equal(out.rules, DEFAULT_RULES);
  assert.deepEqual(out.conventions, { language: 'English', instructions: null });
  assert.equal(run.calls.length, 0);
});

test('rules includes the language and instructions of the project', async () => {
  const run = await runCli(['rules'], { config: {
    provider: 'clickup',
    folderId: FOLDER_ID,
    conventions: { language: 'Italian', instructions: 'Names in the imperative.' },
  } });
  assert.deepEqual((run.json() as RulesOut).conventions, { language: 'Italian', instructions: 'Names in the imperative.' });
});

test('rules uses the project rules file instead of the defaults, found next to .taskwire.json', async () => {
  const dir = projectDir({ rulesFile: 'docs/task-rules.md' });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'task-rules.md'), '# Our task rules\n');
  const nested = join(dir, 'src', 'deep');
  mkdirSync(nested, { recursive: true });

  const run = await runCli(['rules'], { cwd: nested });
  assert.equal(run.code, 0);
  const out = run.json() as RulesOut;
  assert.equal(out.rules, '# Our task rules\n');
  assert.equal(out.rulesSource, join(dir, 'docs', 'task-rules.md'));
});

test('rules with a missing rules file exits 3', async () => {
  const run = await runCli(['rules'], { cwd: projectDir({ rulesFile: 'missing.md' }) });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).error, /missing\.md/);
});

test('a rulesFile that is not a string is a configuration error', async () => {
  const run = await runCli(['rules'], { cwd: projectDir({ rulesFile: 42 }) });
  assert.equal(run.code, 3);
  assert.match(JSON.parse(run.stderr).error, /conventions\.rulesFile/);
});

test('rules --pretty prints the rules as markdown with the project conventions at the end', async () => {
  const run = await runCli(['rules', '--pretty'], { config: {
    provider: 'clickup',
    folderId: FOLDER_ID,
    conventions: { language: 'Italian' },
  } });
  assert.equal(run.code, 0);
  assert.ok(run.stdout.startsWith(`# taskwire rules (v${VERSION})\n`));
  assert.ok(run.stdout.includes(DEFAULT_RULES));
  assert.match(run.stdout, /## Project conventions\n\n- Language: Italian\n- Instructions: none\n$/);
});

test('rules needs a .taskwire.json', async () => {
  const run = await runCli(['rules'], { config: null });
  assert.equal(run.code, 3);
});
