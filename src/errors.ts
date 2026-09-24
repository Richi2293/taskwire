export const EXIT = { ok: 0, api: 1, usage: 2, config: 3 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class TaskwireError extends Error {
  readonly exitCode: ExitCode;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: ExitCode, hint?: string) {
    super(message);
    this.name = 'TaskwireError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export function apiError(message: string, hint?: string): TaskwireError {
  return new TaskwireError(message, EXIT.api, hint);
}

export function usageError(message: string, hint?: string): TaskwireError {
  return new TaskwireError(message, EXIT.usage, hint);
}

export function configError(message: string, hint?: string): TaskwireError {
  return new TaskwireError(message, EXIT.config, hint);
}
