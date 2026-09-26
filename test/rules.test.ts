import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, runCli } from './helpers.ts';
import type { Route } from './helpers.ts';

const DEFAULT_RULES = readFileSync(new URL('../rules/tasks.md', import.meta.url), 'utf8');
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const VERSION = PACKAGE.version;
const DIST_TAGS = `GET /-/package/${PACKAGE.name.replace('/', '%2f')}/dist-tags`;

interface RulesOut {
  version: string;
  scope: string;
  rulesSource: string;
  rules: string;
  conventions: { language: string; instructions: string | null };
  update: { latest: string; command: string } | null;
}

// An environment with an empty cache folder, so rules asks the registry.
function cacheEnv(): Record<string, string> {
  return { XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'taskwire-cache-')) };
}

function latest(version: string): Record<string, Route> {
  return { [DIST_TAGS]: { body: { latest: version } } };
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
  assert.equal(out.update, null);
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

test('the default rules say who checks the acceptance criteria and when', () => {
  assert.match(DEFAULT_RULES, /check an acceptance criterion in the description \(`- \[x\]`\) once it is verified/);
  assert.match(DEFAULT_RULES, /Checking an acceptance criterion is not progress/);
  assert.match(DEFAULT_RULES, /Before moving a task to a closed status, check every verified acceptance criterion/);
});

test('the default rules ask to move a task to its in-progress status when the work starts', () => {
  assert.match(DEFAULT_RULES, /When you start the work a task asks for, move it to the status of its list that means work in progress/);
  assert.match(DEFAULT_RULES, /If the list has no such status, leave the status as it is/);
});

test('rules reports a newer version on npm with the command to install it', async () => {
  const run = await runCli(['rules'], { env: cacheEnv(), routes: latest('99.0.0') });
  assert.equal(run.code, 0);
  assert.deepEqual((run.json() as RulesOut).update, { latest: '99.0.0', command: `npm i -g ${PACKAGE.name}@latest` });
  assert.deepEqual(run.calls.map((call) => `${call.method} ${call.path}`), [DIST_TAGS]);
});

test('rules reports no update when the installed version is the latest', async () => {
  const run = await runCli(['rules'], { env: cacheEnv(), routes: latest(VERSION) });
  assert.equal((run.json() as RulesOut).update, null);
});

test('rules works as usual when the registry fails', async () => {
  const run = await runCli(['rules'], { env: cacheEnv(), routes: { [DIST_TAGS]: { status: 503 } } });
  assert.equal(run.code, 0);
  assert.equal((run.json() as RulesOut).update, null);
  assert.equal(run.stderr, '');
});

test('rules --pretty shows the update right after the title', async () => {
  const run = await runCli(['rules', '--pretty'], { env: cacheEnv(), routes: latest('99.0.0') });
  assert.ok(run.stdout.startsWith(
    `# taskwire rules (v${VERSION})\n\n` +
      `Update available: taskwire 99.0.0 (installed ${VERSION}). Tell the user and ask before running: npm i -g ${PACKAGE.name}@latest\n`,
  ));
});

test('the default rules say what to do with an update notice', () => {
  assert.match(DEFAULT_RULES, /If `taskwire rules` reports an `update`, tell the user and ask before running its `command`/);
});
