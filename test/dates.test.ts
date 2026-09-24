import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMidnightMs, msToIso } from '../src/dates.ts';
import { TaskwireError } from '../src/errors.ts';

// Node applies a new process.env.TZ immediately, so each test pins the zone it checks.
function inTimeZone(timeZone: string, check: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    check();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

const iso = (date: string) => new Date(localMidnightMs(date)).toISOString();

test('msToIso converts ClickUp ms strings and keeps null', () => {
  assert.equal(msToIso('1767225600000'), '2026-01-01T00:00:00.000Z');
  assert.equal(msToIso(null), null);
  assert.equal(msToIso(''), null);
  assert.equal(msToIso('not a number'), null);
});

test('localMidnightMs follows the system time zone in winter and summer', () => {
  inTimeZone('Europe/Berlin', () => {
    assert.equal(iso('2026-01-15'), '2026-01-14T23:00:00.000Z');
    assert.equal(iso('2026-07-15'), '2026-07-14T22:00:00.000Z');
  });
  inTimeZone('America/New_York', () => {
    assert.equal(iso('2026-01-15'), '2026-01-15T05:00:00.000Z');
    assert.equal(iso('2026-07-15'), '2026-07-15T04:00:00.000Z');
  });
});

test('localMidnightMs handles the DST switch days', () => {
  inTimeZone('Europe/Berlin', () => {
    assert.equal(iso('2026-03-29'), '2026-03-28T23:00:00.000Z');
    assert.equal(iso('2026-10-25'), '2026-10-24T22:00:00.000Z');
  });
});

test('localMidnightMs rejects bad formats and impossible dates', () => {
  for (const bad of ['2026-1-5', '15/01/2026', '2026-02-30', '']) {
    assert.throws(() => localMidnightMs(bad), (e: unknown) => e instanceof TaskwireError && e.exitCode === 2, bad);
  }
});
