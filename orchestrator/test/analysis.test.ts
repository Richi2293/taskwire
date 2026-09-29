import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analysisDue, lastAnalysis, runAnalysis } from '../src/analysis.ts';
import { loadConfig } from '../src/config.ts';
import { OrchestratorError } from '../src/errors.ts';
import { analysisPrompt } from '../src/prompts.ts';
import { readClaims } from '../src/state.ts';
import { worktreePath } from '../src/worktree.ts';
import { claudeResult, fakeCommands, fakeTaskwire, projectDir, tempDir } from './helpers.ts';

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);
const HOUR = 3600_000;

function writeAnalyses(home: string, records: Record<string, unknown>[]): void {
  writeFileSync(join(home, 'analyses.jsonl'), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

function record(project: string, startedAt: number): Record<string, unknown> {
  return {
    project,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(startedAt + 60_000).toISOString(),
    ok: true,
    summary: 'All good.',
    costUsd: 0.3,
    durationMs: 60_000,
    log: '/l',
  };
}

test('a project never analysed is due at once', () => {
  const home = tempDir('home');
  assert.equal(lastAnalysis(home, '/p/a'), null);
  assert.equal(analysisDue(home, '/p/a', NOW, 1), true);
});

test('an analysis is due again only once the hours have passed since the last one started', () => {
  const home = tempDir('home');
  writeAnalyses(home, [record('/p/a', NOW - 5 * HOUR), record('/p/a', NOW - 30 * 60_000), record('/p/b', NOW - 2 * HOUR)]);
  assert.equal(lastAnalysis(home, '/p/a')?.startedAt, new Date(NOW - 30 * 60_000).toISOString());
  assert.equal(analysisDue(home, '/p/a', NOW, 1), false);
  assert.equal(analysisDue(home, '/p/a', NOW + 30 * 60_000, 1), true);
  assert.equal(analysisDue(home, '/p/b', NOW, 1), true);
  assert.equal(analysisDue(home, '/p/b', NOW, 24), false);
});

test('a broken line in the analyses file is skipped', () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'analyses.jsonl'), `${JSON.stringify(record('/p/a', NOW - 10 * 60_000))}\n{"project": "/p/a", "sta\n`);
  assert.equal(analysisDue(home, '/p/a', NOW, 1), false);
});

test('an analysis runs the agent in a fresh worktree of the project and records what it said', async () => {
  const home = tempDir('home');
  const project = projectDir('shop');
  const worktree = worktreePath(home, project, 'analysis');
  // A worktree left by the previous analysis is replaced, so the agent sees the latest code.
  mkdirSync(worktree, { recursive: true });
  let claimDuringRun: unknown = null;
  const commands = fakeCommands({
    'git rev-parse': () => ({ code: 0 }),
    claude: () => {
      claimDuringRun = readClaims(home)[`analysis:${project}`];
      return claudeResult({ result: 'Due task vaghi segnati, una proposta nuova.', total_cost_usd: 0.8, duration_ms: 120_000 });
    },
  });
  const result = await runAnalysis({ home, runTaskwire: fakeTaskwire({}).run, runCommand: commands.run, now: () => NOW }, { path: project, blockTag: 'manual' });

  const git = commands.calls.filter((call) => call.command === 'git').map((call) => call.args.slice(0, 3).join(' '));
  assert.deepEqual(git, ['worktree remove --force', 'worktree prune', 'fetch --quiet', 'rev-parse --verify --quiet', `worktree add --detach`]);
  const agent = commands.calls.find((call) => call.command === 'claude');
  assert.equal(agent?.cwd, worktree);
  assert.equal(agent?.args[agent.args.indexOf('-p') + 1], analysisPrompt({ path: project, blockTag: 'manual' }));
  assert.ok(existsSync(join(worktree, '.taskwire.json')));

  // While it runs, the dashboard shows the analysis as the agent at work on the project.
  assert.deepEqual(claimDuringRun, { project, name: 'Project analysis', worktree, startedAt: new Date(NOW).toISOString(), kind: 'analysis' });
  assert.deepEqual(readClaims(home), {});

  assert.equal(result.ok, true);
  assert.equal(result.summary, 'Due task vaghi segnati, una proposta nuova.');
  assert.equal(result.costUsd, 0.8);
  assert.deepEqual(lastAnalysis(home, project), result);
  assert.match(readFileSync(result.log, 'utf8'), /Due task vaghi/);
});

test('a failed analysis is recorded too, so it is tried again only after the hours', async () => {
  const home = tempDir('home');
  const project = projectDir('shop');
  const commands = fakeCommands({ claude: () => ({ code: 1, stdout: '', stderr: 'rate limited' }) });
  const result = await runAnalysis({ home, runTaskwire: fakeTaskwire({}).run, runCommand: commands.run, now: () => NOW }, { path: project });
  assert.equal(result.ok, false);
  assert.equal(result.summary, 'rate limited');
  assert.equal(analysisDue(home, project, NOW + 10 * 60_000, 1), false);
  assert.deepEqual(readClaims(home), {});
});

test('the analysis prompt names the block tag, the statuses and the limits', () => {
  const prompt = analysisPrompt({ path: '/p/shop', blockTag: 'manual', startStatuses: ['ready'], workStatus: 'doing' });
  assert.match(prompt, /`manual`/);
  assert.match(prompt, /ready/);
  assert.match(prompt, /doing/);
  assert.match(prompt, /at most 5 new tasks/);
  assert.match(prompt, /### Proposed task/);
  assert.match(prompt, /### Ready to close/);
  assert.match(prompt, /Never write code.*move a task to a closed status/);
  const defaults = analysisPrompt({ path: '/p/shop' });
  assert.match(defaults, /`no-agent`/);
  assert.match(defaults, /backlog, to do/);
});

test('the config takes analysisHours and a closedStatus per project, and refuses wrong values', () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ analysisHours: 0.5, projects: [{ path: '/p/a', closedStatus: 'done' }] }));
  const config = loadConfig(home);
  assert.equal(config.analysisHours, 0.5);
  assert.equal(config.projects[0].closedStatus, 'done');
  for (const broken of [{ analysisHours: 0, projects: [] }, { analysisHours: '1', projects: [] }, { projects: [{ path: '/p/a', closedStatus: '' }] }]) {
    writeFileSync(join(home, 'config.json'), JSON.stringify(broken));
    assert.throws(() => loadConfig(home), (error: unknown) => error instanceof OrchestratorError && error.exitCode === 3, JSON.stringify(broken));
  }
});
