import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { RunControl } from '../control.ts';
import { EXIT, OrchestratorError } from '../errors.ts';
import type { DashboardState } from './snapshot.ts';
import { renderPage } from './page.ts';

export interface DashboardRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface DashboardResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Handler = (request: DashboardRequest) => Promise<DashboardResponse>;

export interface HandlerDeps {
  snapshot: () => Promise<DashboardState>;
  // Changes at every start; the page gets it and must send it back with every action.
  token: string;
  // Runs an action sent by the page; missing when the dashboard only shows.
  act?: (body: unknown) => Promise<void>;
  // Play and pause of the agents.
  control?: RunControl;
}

// The dashboard listens on the loopback only; a page from another site that resolves its own name to
// 127.0.0.1 (DNS rebinding) still sends its own Host, so anything but a local host is refused.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function createHandler(deps: HandlerDeps): Handler {
  return async (request) => {
    const host = (request.headers.host ?? '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) return text(403, 'Forbidden: open the dashboard at http://127.0.0.1');
    const path = request.url.split('?')[0];
    if (request.method === 'GET' && path === '/') {
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderPage(await deps.snapshot(), deps.token) };
    }
    if (request.method === 'GET' && path === '/api/state') {
      return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS }, body: JSON.stringify(await deps.snapshot()) };
    }
    if (request.method === 'POST' && path === '/api/action' && deps.act !== undefined) {
      return runAction(deps.act, deps.token, request);
    }
    if (request.method === 'POST' && path === '/api/control' && deps.control !== undefined) {
      return switchControl(deps.control, deps.token, request);
    }
    return text(404, 'Not found');
  };
}

async function runAction(act: (body: unknown) => Promise<void>, token: string, request: DashboardRequest): Promise<DashboardResponse> {
  const sent = request.headers['x-action-token'] ?? '';
  if (!sameSecret(sent, token)) return json(403, { error: 'Reload the dashboard: this page is from an earlier start' });
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    return json(400, { error: 'The action is not valid JSON' });
  }
  try {
    await act(body);
    return json(200, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A refused action is the page's problem; anything else is taskwire or the task system failing.
    const refused = error instanceof OrchestratorError && error.exitCode === EXIT.usage;
    return json(refused ? 400 : 502, { error: message });
  }
}

function switchControl(control: RunControl, token: string, request: DashboardRequest): DashboardResponse {
  if (!sameSecret(request.headers['x-action-token'] ?? '', token)) return json(403, { error: 'Reload the dashboard: this page is from an earlier start' });
  let action: unknown;
  try {
    action = (JSON.parse(request.body) as { action?: unknown }).action;
  } catch {
    return json(400, { error: 'The request is not valid JSON' });
  }
  if (action === 'play') control.play();
  else if (action === 'pause') control.pause();
  else return json(400, { error: 'Use "play" or "pause"' });
  return json(200, { ok: true, mode: control.working() ? 'working' : 'paused' });
}

// Compares in constant time, so the token cannot be guessed one character at a time.
function sameSecret(sent: string, token: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(status: number, value: unknown): DashboardResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS }, body: JSON.stringify(value) };
}

// Inline style and script only, no framing by other pages, no referrer to the task system links.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function text(status: number, body: string): DashboardResponse {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }, body };
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

// Serves the handler on 127.0.0.1 only.
export function serveDashboard(handler: Handler, port: number): Promise<RunningServer> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      // Actions carry a short text: anything bigger is not from the dashboard.
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value.join(', ') : value;
      handler({ method: req.method ?? 'GET', url: req.url ?? '/', headers, body })
        .then((response) => {
          res.writeHead(response.status, response.headers);
          res.end(response.body);
        })
        .catch((error: unknown) => {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(error instanceof Error ? error.message : String(error));
        });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
