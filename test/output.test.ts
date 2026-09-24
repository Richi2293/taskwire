import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printError, printResult, printWarning, redact } from '../src/output.ts';
import { TaskwireError, EXIT, usageError } from '../src/errors.ts';

function memory() {
  const chunks: string[] = [];
  return { write: (c: string) => chunks.push(c), text: () => chunks.join('') };
}

test('printResult writes compact JSON with a trailing newline', () => {
  const out = memory();
  printResult(out, { id: '1', tags: ['a'] }, false);
  assert.equal(out.text(), '{"id":"1","tags":["a"]}\n');
});

test('printResult renders an array of flat objects as a table when pretty', () => {
  const out = memory();
  printResult(out, [{ id: '1', name: 'First', tags: ['a', 'b'] }, { id: '22', name: 'Second', tags: [] }], true);
  const lines = out.text().trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^id\s+name\s+tags$/);
  assert.match(lines[1], /^1\s+First\s+a, b$/);
  assert.match(lines[2], /^22\s+Second\s*$/);
});

test('printResult renders an object as indented JSON when pretty', () => {
  const out = memory();
  printResult(out, { id: '1' }, true);
  assert.equal(out.text(), '{\n  "id": "1"\n}\n');
});

test('redact replaces every secret occurrence', () => {
  assert.equal(redact('token pk_abc and pk_abc', ['pk_abc']), 'token *** and ***');
  assert.equal(redact('nothing here', []), 'nothing here');
});

test('printError writes JSON with error and hint, redacting secrets', () => {
  const err = memory();
  printError(err, usageError('bad pk_secret', 'try pk_secret again'), ['pk_secret']);
  assert.deepEqual(JSON.parse(err.text()), { error: 'bad ***', hint: 'try *** again' });
});

test('printError omits the hint when there is none', () => {
  const err = memory();
  printError(err, new TaskwireError('boom', EXIT.api), []);
  assert.deepEqual(JSON.parse(err.text()), { error: 'boom' });
});

test('printWarning writes a JSON line with warning and hint, redacting secrets', () => {
  const err = memory();
  printWarning(err, 'slow pk_secret', 'wait', ['pk_secret']);
  printWarning(err, 'no hint', undefined, []);
  assert.equal(err.text(), '{"warning":"slow ***","hint":"wait"}\n{"warning":"no hint"}\n');
});
