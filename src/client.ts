import { apiError } from './errors.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
// Reports a non-fatal problem to the user without changing the command result.
export type Warn = (message: string, hint?: string) => void;
export type QueryValue = string | number | boolean | Array<string | number>;

export interface RequestOptions {
  query?: Record<string, QueryValue | undefined>;
  body?: unknown;
}

export interface Client {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
}

export interface ClientDeps {
  token: string;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  warn: Warn;
  baseUrl?: string;
}

export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const DEFAULT_BASE_URL = 'https://api.clickup.com/api/v2';

export function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function createClient(deps: ClientDeps): Client {
  const base = deps.baseUrl ?? DEFAULT_BASE_URL;

  async function send(method: HttpMethod, url: string, body: unknown): Promise<Response> {
    try {
      return await deps.fetch(url, {
        method,
        headers: { Authorization: deps.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw apiError(`Network error calling ClickUp: ${reason}`, 'Check the connection and retry');
    }
  }

  return {
    async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
      const url = buildUrl(base, path, options.query);
      let response = await send(method, url, options.body);

      if (response.status === 429) {
        const waitMs = rateLimitWaitMs(response, deps.now());
        if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
          throw apiError('ClickUp rate limit reached', `Retry in ${Math.ceil(waitMs / 1000)} seconds`);
        }
        deps.warn(`ClickUp rate limit reached, waiting ${Math.ceil(waitMs / 1000)} seconds`);
        await deps.sleep(waitMs);
        response = await send(method, url, options.body);
        if (response.status === 429) {
          throw apiError('ClickUp rate limit reached again after waiting', 'Retry in a minute');
        }
      }

      const text = await response.text();
      const data = text ? parseBody(text) : {};
      if (!response.ok) {
        throw apiError(describeFailure(response.status, data), hintFor(response.status));
      }
      return data as T;
    },
  };
}

function rateLimitWaitMs(response: Response, nowMs: number): number {
  const resetSeconds = Number(response.headers.get('X-RateLimit-Reset'));
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) return MAX_RATE_LIMIT_WAIT_MS;
  return Math.max(0, resetSeconds * 1000 - nowMs);
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function describeFailure(status: number, data: unknown): string {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const message = typeof record.err === 'string' ? record.err : 'request failed';
  const code = typeof record.ECODE === 'string' ? ` (${record.ECODE})` : '';
  return `ClickUp API ${status}: ${message}${code}`;
}

function hintFor(status: number): string | undefined {
  if (status === 401) return 'The token was rejected: regenerate it in ClickUp (Settings > Apps) and save it again in the Keychain';
  if (status === 404) return 'Check the id: it may be wrong or deleted';
  return undefined;
}
