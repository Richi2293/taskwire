import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import type { ProjectConfig } from '../src/config.ts';
import type { RawList, RawTask } from '../src/clickup-types.ts';
import { createClient } from '../src/client.ts';
import type { Client, FetchFn } from '../src/client.ts';

export interface FakeCall {
  method: string;
  path: string;
  url: URL;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Route = FakeReply | ((call: FakeCall) => FakeReply);

export function fakeFetch(routes: Record<string, Route>): { fetch: FetchFn; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v2/, '');
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: FakeCall = { method, path, url, body };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      return new Response(JSON.stringify({ err: `No fake route for ${method} ${path}` }), { status: 500 });
    }
    const reply = typeof route === 'function' ? route(call) : route;
    // Statuses like 204 must have a null body, so an empty reply maps to null.
    const text = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status ?? 200, headers: reply.headers });
  };
  return { fetch, calls };
}

export function sequence(...replies: FakeReply[]): (call: FakeCall) => FakeReply {
  let index = 0;
  return () => replies[Math.min(index++, replies.length - 1)];
}

export function testClient(routes: Record<string, Route>): { client: Client; calls: FakeCall[]; sleeps: number[] } {
  const { fetch, calls } = fakeFetch(routes);
  const sleeps: number[] = [];
  const client = createClient({
    token: 'pk_test_token',
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => 1_000_000,
  });
  return { client, calls, sleeps };
}

export const WORKSPACE_ID = '1';
export const FOLDER_ID = '900';
export const OTHER_FOLDER_ID = '901';
export const LIST_ID = '800';

export function rawTask(overrides: Partial<RawTask> = {}): RawTask {
  return {
    id: 't1',
    name: 'Task one',
    url: 'https://app.clickup.com/t/t1',
    status: { status: 'to do', type: 'open' },
    priority: null,
    tags: [],
    assignees: [],
    due_date: null,
    date_updated: '1767225600000',
    parent: null,
    list: { id: LIST_ID, name: 'Backlog' },
    folder: { id: FOLDER_ID, name: 'Project' },
    ...overrides,
  };
}

export function rawList(overrides: Partial<RawList> = {}): RawList {
  return {
    id: LIST_ID,
    name: 'Backlog',
    folder: { id: FOLDER_ID, name: 'Project' },
    statuses: [
      { status: 'to do', type: 'open' },
      { status: 'in progress', type: 'custom' },
      { status: 'complete', type: 'closed' },
    ],
    ...overrides,
  };
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  calls: FakeCall[];
  cwd: string;
  json: () => unknown;
}

export async function runCli(
  argv: string[],
  options: { routes?: Record<string, Route>; cwd?: string; config?: ProjectConfig | null; keychain?: string | null } = {},
): Promise<CliRun> {
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), 'taskwire-cli-'));
  const config: ProjectConfig | null =
    options.config === undefined
      ? { provider: 'clickup', workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, defaultListId: LIST_ID }
      : options.config;
  if (options.cwd === undefined && config !== null) {
    writeFileSync(join(cwd, '.taskwire.json'), JSON.stringify(config));
  }
  const { fetch, calls } = fakeFetch(options.routes ?? {});
  const out: string[] = [];
  const err: string[] = [];
  const keychain = options.keychain === undefined ? 'pk_test_token' : options.keychain;
  const code = await main({
    argv,
    env: {},
    cwd,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    fetch,
    sleep: async () => {},
    now: () => 0,
    readKeychain: () => keychain,
  });
  const stdout = out.join('');
  return { code, stdout, stderr: err.join(''), calls, cwd, json: () => JSON.parse(stdout) };
}
