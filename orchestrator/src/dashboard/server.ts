import { createServer } from 'node:http';
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
    return text(404, 'Not found');
  };
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
