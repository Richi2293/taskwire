import type { RunCommand } from './commands.ts';

export interface AgentOptions {
  // Runs the agent in the Claude Code sandbox: no writes outside the worktree, network only to allowed domains.
  sandbox: boolean;
  // Extra domains the sandbox lets the agent reach.
  allowedDomains: string[];
  // Environment for the agent, on top of the orchestrator's (for example a PATH with the right taskwire).
  env: Record<string, string>;
}

export interface AgentResult {
  ok: boolean;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  // The agent's final message, or the reason the run failed.
  summary: string;
  // The raw output, kept in the run log.
  output: string;
}

// taskwire calls the task system API, so the sandbox must let it through.
const SANDBOX_DOMAINS = ['api.clickup.com'];

// In the sandbox the network goes through a proxy, and Node's fetch uses it only with NODE_USE_ENV_PROXY.
const SANDBOX_ENV = { NODE_USE_ENV_PROXY: '1' };

// Runs Claude Code without interaction in the worktree. With resume, it continues the same session.
export async function runClaude(
  run: RunCommand,
  request: { prompt: string; cwd: string; resume?: string },
  options: AgentOptions,
): Promise<AgentResult> {
  const args = [...(request.resume === undefined ? [] : ['--resume', request.resume]), '-p', request.prompt, '--output-format', 'json'];
  if (options.sandbox) {
    const settings = {
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
        network: { allowedDomains: [...SANDBOX_DOMAINS, ...options.allowedDomains] },
      },
    };
    args.push('--permission-mode', 'auto', '--permission-prompts', 'none', '--settings', JSON.stringify(settings));
  } else {
    args.push('--dangerously-skip-permissions');
  }
  const result = await run('claude', args, { cwd: request.cwd, env: { ...options.env, ...(options.sandbox ? SANDBOX_ENV : {}) } });
  const output = `${result.stdout}${result.stderr === '' ? '' : `\n[stderr]\n${result.stderr}`}`;
  const parsed = parseResult(result.stdout);
  if (result.code !== 0 || parsed === null || parsed.is_error === true) {
    const reason = (typeof parsed?.result === 'string' ? parsed.result : '') || result.stderr.trim() || `claude exited with code ${result.code}`;
    return { ok: false, sessionId: text(parsed?.session_id), costUsd: number(parsed?.total_cost_usd), durationMs: number(parsed?.duration_ms), summary: reason, output };
  }
  return {
    ok: true,
    sessionId: text(parsed.session_id),
    costUsd: number(parsed.total_cost_usd),
    durationMs: number(parsed.duration_ms),
    summary: text(parsed.result) ?? '',
    output,
  };
}

function parseResult(stdout: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(stdout);
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
