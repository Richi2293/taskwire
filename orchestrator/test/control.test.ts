import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunControl } from '../src/control.ts';

test('the run control starts paused, and play and pause switch it, telling who waits', async () => {
  const changes: boolean[] = [];
  const control = createRunControl((working) => changes.push(working));
  assert.equal(control.working(), false);
  const waiting = control.changed();
  control.play();
  await waiting;
  assert.equal(control.working(), true);
  control.play();
  control.pause();
  assert.equal(control.working(), false);
  assert.deepEqual(changes, [true, false], 'a play while working changes nothing');
});
