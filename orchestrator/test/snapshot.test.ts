import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../src/dashboard/snapshot.ts';
import type { StoreDeps } from '../src/dashboard/snapshot.ts';

// Reads every project, then returns the state the page would get.
async function readState(deps: StoreDeps) {
  const store = createStore(deps);
  await store.refresh();
  return store.state();
}
import { fakeTaskwire, projectDir, task, tempDir } from './helpers.ts';

const NOW = Date.UTC(2026, 8, 27, 15, 32, 0);

function home(projects: string[]): string {
  const dir = tempDir('home');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ projects: projects.map((path) => ({ path })) }));
  return dir;
}

const lastComment = (text: string) => ({ ...task(), comments: [{ id: 'c1', author: 'jane', date: '2026-09-27T15:00:00.000Z', text }] });

test('lists the tasks waiting for a person in every project, decisions first, with the text for people of the last comment', async () => {
  const website = projectDir('website');
  const shop = projectDir('shop');
  const taskwire = fakeTaskwire({
    'task get': (args: string[]) =>
      lastComment(args[2] === 'd1'
        ? '> **Stato:** servono decisioni prima di scrivere codice.\n> **Prossimo:** rispondere alle domande.\n\n---\n\n### Dettagli\n\n- molte cose'
        : 'No quote here, only details.'),
  });
  const replies: Record<string, unknown> = {
    [website]: [task({ id: 'r1', name: 'Add a discount', needs: 'review', status: 'qa' })],
    [shop]: [task({ id: 'd1', name: 'Show prices in the customer currency', needs: 'decision', url: 'https://app.clickup.com/t/d1' })],
  };
  const run = async (args: string[], cwd: string) => (args[0] === 'tasks' ? replies[cwd] : taskwire.run(args, cwd));
  const state = await readState({ home: home([website, shop]), runTaskwire: run, now: () => NOW });

  assert.deepEqual(state.waiting.map((item) => [item.projectName, item.id, item.needs]), [['shop', 'd1', 'decision'], ['website', 'r1', 'review']]);
  assert.deepEqual(state.waiting[0].note, ['Stato: servono decisioni prima di scrivere codice.', 'Prossimo: rispondere alle domande.']);
  assert.equal(state.waiting[0].url, 'https://app.clickup.com/t/d1');
  assert.deepEqual(state.waiting[1].note, []);
  assert.equal(state.generatedAt, '2026-09-27T15:32:00.000Z');
});

test('shows the agents at work from the claims, and the history newest first', async () => {
  const dir = home([]);
  writeFileSync(join(dir, 'claims.json'), JSON.stringify({ t1: { project: '/code/website', name: 'Add a discount', worktree: '/wt', startedAt: '2026-09-27T15:20:00.000Z' } }));
  const run = (task: string, finishedAt: string) => JSON.stringify({ project: '/code/shop', task, name: `Task ${task}`, url: `u/${task}`, startedAt: finishedAt, finishedAt, durationMs: 1, costUsd: 0.4, needs: 'review', status: 'qa', summary: 's', tests: 'pass', verdict: 'pass', worktree: '/wt', log: '/log' });
  appendFileSync(join(dir, 'runs.jsonl'), `${run('old', '2026-09-26T10:00:00.000Z')}\n${run('new', '2026-09-27T11:00:00.000Z')}\n`);
  const state = await readState({ home: dir, runTaskwire: fakeTaskwire({}).run, now: () => NOW });
  assert.deepEqual(state.working, [{ project: '/code/website', projectName: 'website', task: 't1', name: 'Add a discount', startedAt: '2026-09-27T15:20:00.000Z' }]);
  assert.deepEqual(state.history.map((entry) => [entry.task, entry.projectName, entry.verdict]), [['new', 'shop', 'pass'], ['old', 'shop', 'pass']]);
});

test('a project whose tasks cannot be read shows up as a problem, and the others still show', async () => {
  const broken = projectDir('broken');
  const fine = projectDir('fine');
  const run = async (args: string[], cwd: string) => {
    if (cwd === broken) throw new Error('taskwire tasks: No ClickUp token found for account "acme"');
    return args[0] === 'tasks' ? [task({ id: 'f1', needs: 'test' })] : lastComment('> **Next:** open the page on a phone.');
  };
  const state = await readState({ home: home([broken, fine]), runTaskwire: run, now: () => NOW });
  assert.deepEqual(state.problems, [{ project: broken, projectName: 'broken', error: 'taskwire tasks: No ClickUp token found for account "acme"' }]);
  assert.deepEqual(state.waiting.map((item) => [item.id, item.note]), [['f1', ['Next: open the page on a phone.']]]);
});
