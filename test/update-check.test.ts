import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, isNewer } from '../src/update-check.ts';
import type { FetchFn } from '../src/client.ts';

const PKG = { name: '@acme/taskwire', version: '1.2.3' };
const DAY = 24 * 60 * 60 * 1000;
const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@acme%2ftaskwire/dist-tags';

function registry(reply: () => Response): { fetch: FetchFn; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchFn = async (url) => {
    urls.push(url);
    return reply();
  };
  return { fetch, urls };
}

function latestIs(version: string): () => Response {
  return () => new Response(JSON.stringify({ latest: version }), { status: 200 });
}

function cacheEnv(): { env: Record<string, string>; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-cache-'));
  return { env: { XDG_CACHE_HOME: dir }, file: join(dir, 'taskwire', 'update-check.json') };
}

test('a newer version on npm gives the version and the command to install it', async () => {
  const { env } = cacheEnv();
  const { fetch, urls } = registry(latestIs('1.3.0'));
  const notice = await checkForUpdate({ fetch, now: () => 0, env }, PKG);
  assert.deepEqual(notice, { latest: '1.3.0', command: 'npm i -g @acme/taskwire@latest' });
  assert.deepEqual(urls, [DIST_TAGS_URL]);
});

test('the same or an older version on npm gives no notice', async () => {
  for (const latest of ['1.2.3', '1.2.0', '0.9.9']) {
    const { env } = cacheEnv();
    assert.equal(await checkForUpdate({ fetch: registry(latestIs(latest)).fetch, now: () => 0, env }, PKG), null);
  }
});

test('the answer is cached for a day, then asked again', async () => {
  const { env, file } = cacheEnv();
  const { fetch, urls } = registry(latestIs('1.3.0'));
  await checkForUpdate({ fetch, now: () => 1000, env }, PKG);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { checkedAt: 1000, latest: '1.3.0' });

  const cached = await checkForUpdate({ fetch, now: () => 1000 + DAY - 1, env }, PKG);
  assert.deepEqual(cached, { latest: '1.3.0', command: 'npm i -g @acme/taskwire@latest' });
  assert.equal(urls.length, 1);

  await checkForUpdate({ fetch, now: () => 1000 + DAY, env }, PKG);
  assert.equal(urls.length, 2);
});

test('a cached version compares with the installed one, so an update clears the notice', async () => {
  const { env, file } = cacheEnv();
  mkdirSync(join(env.XDG_CACHE_HOME, 'taskwire'));
  writeFileSync(file, JSON.stringify({ checkedAt: 0, latest: '1.2.3' }));
  const { fetch, urls } = registry(latestIs('9.9.9'));
  assert.equal(await checkForUpdate({ fetch, now: () => 10, env }, PKG), null);
  assert.equal(urls.length, 0);
});

test('network and registry errors give no notice and are not retried until the next day', async () => {
  const failures: (() => Response)[] = [
    () => {
      throw new TypeError('fetch failed');
    },
    () => new Response('{}', { status: 404 }),
    () => new Response('not json', { status: 200 }),
    () => new Response(JSON.stringify({ latest: 42 }), { status: 200 }),
  ];
  for (const failure of failures) {
    const { env } = cacheEnv();
    const { fetch, urls } = registry(failure);
    assert.equal(await checkForUpdate({ fetch, now: () => 0, env }, PKG), null);
    assert.equal(await checkForUpdate({ fetch, now: () => 1, env }, PKG), null);
    assert.equal(urls.length, 1);
  }
});

test('an unreadable cache is ignored and rewritten', async () => {
  const { env, file } = cacheEnv();
  mkdirSync(join(env.XDG_CACHE_HOME, 'taskwire'));
  writeFileSync(file, 'garbage');
  const notice = await checkForUpdate({ fetch: registry(latestIs('2.0.0')).fetch, now: () => 5, env }, PKG);
  assert.equal(notice?.latest, '2.0.0');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { checkedAt: 5, latest: '2.0.0' });
});

test('the cache falls back to ~/.cache when XDG_CACHE_HOME is not set', async () => {
  const home = mkdtempSync(join(tmpdir(), 'taskwire-home-'));
  await checkForUpdate({ fetch: registry(latestIs('1.3.0')).fetch, now: () => 7, env: { HOME: home } }, PKG);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.cache', 'taskwire', 'update-check.json'), 'utf8')), { checkedAt: 7, latest: '1.3.0' });
});

test('no check without a place for the cache, or when TASKWIRE_NO_UPDATE_CHECK is set', async () => {
  const { fetch, urls } = registry(latestIs('9.0.0'));
  assert.equal(await checkForUpdate({ fetch, now: () => 0, env: {} }, PKG), null);
  assert.equal(await checkForUpdate({ fetch, now: () => 0, env: { ...cacheEnv().env, TASKWIRE_NO_UPDATE_CHECK: '1' } }, PKG), null);
  assert.equal(urls.length, 0);
});

test('isNewer compares plain x.y.z versions and ignores anything else', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer('1.2.4', '1.2.3'), true);
  assert.equal(isNewer('1.2.3', '1.2.3'), false);
  assert.equal(isNewer('1.2.2', '1.2.3'), false);
  assert.equal(isNewer('2.0.0-beta.1', '1.0.0'), false);
  assert.equal(isNewer('latest', '1.0.0'), false);
});
