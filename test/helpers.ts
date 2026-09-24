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
