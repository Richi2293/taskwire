import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent, pruneOld } from '../src/journal.ts';
import { tempDir } from './helpers.ts';

const NOW = Date.UTC(2026, 8, 29, 10, 0, 0);
const DAY = 86_400_000;

test('events are appended to events.jsonl, one per line', () => {
  const home = tempDir('home');
  appendEvent(home, { event: 'start', at: '2026-09-29T10:00:00.000Z' });
  appendEvent(home, { event: 'stop', at: '2026-09-29T10:05:00.000Z' });
  assert.equal(readFileSync(join(home, 'events.jsonl'), 'utf8'), '{"event":"start","at":"2026-09-29T10:00:00.000Z"}\n{"event":"stop","at":"2026-09-29T10:05:00.000Z"}\n');
});

test('logs and events older than 30 days are removed, the rest stays', () => {
  const home = tempDir('home');
  mkdirSync(join(home, 'logs'));
  const old = join(home, 'logs', 'old.log');
  const recent = join(home, 'logs', 'recent.log');
  writeFileSync(old, 'x');
  writeFileSync(recent, 'y');
  utimesSync(old, new Date(NOW - 31 * DAY), new Date(NOW - 31 * DAY));
  utimesSync(recent, new Date(NOW - 2 * DAY), new Date(NOW - 2 * DAY));
  const line = (daysAgo: number) => JSON.stringify({ event: 'start', at: new Date(NOW - daysAgo * DAY).toISOString() });
  writeFileSync(join(home, 'events.jsonl'), `${line(40)}\n${line(29)}\nbroken\n${line(1)}\n`);

  pruneOld(home, NOW);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(recent), true);
  assert.equal(readFileSync(join(home, 'events.jsonl'), 'utf8'), `${line(29)}\n${line(1)}\n`);
});

test('pruning a home with no logs and no events does nothing', () => {
  const home = tempDir('home');
  pruneOld(home, NOW);
  assert.equal(existsSync(join(home, 'events.jsonl')), false);
});
