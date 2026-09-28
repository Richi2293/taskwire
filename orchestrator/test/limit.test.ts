import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitCalls } from '../src/limit.ts';

test('no more than the limit of taskwire calls run at once, and every call gets its own answer', async () => {
  let running = 0;
  let peak = 0;
  const run = async (args: string[]) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return args[0];
  };
  const limited = limitCalls(run, 3);
  const answers = await Promise.all(Array.from({ length: 10 }, (_, index) => limited([`call-${index}`], '/code')));
  assert.equal(peak, 3);
  assert.deepEqual(answers, Array.from({ length: 10 }, (_, index) => `call-${index}`));
});

test('a failed call frees its place for the next one', async () => {
  const limited = limitCalls(async (args: string[]) => {
    if (args[0] === 'fail') throw new Error('Network error');
    return 'ok';
  }, 1);
  await assert.rejects(limited(['fail'], '/code'), /Network error/);
  assert.equal(await limited(['next'], '/code'), 'ok');
});
