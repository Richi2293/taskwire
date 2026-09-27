// Same exit codes as taskwire: 1 external failure, 2 wrong usage, 3 configuration problem.
export const EXIT = { ok: 0, external: 1, usage: 2, config: 3 } as const;

export class OrchestratorError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: number, hint?: string) {
    super(message);
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export function usageError(message: string, hint?: string): OrchestratorError {
  return new OrchestratorError(message, EXIT.usage, hint);
}

export function configError(message: string, hint?: string): OrchestratorError {
  return new OrchestratorError(message, EXIT.config, hint);
}
