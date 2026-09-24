import type { TaskwireError } from './errors.ts';

export interface Writer {
  write(chunk: string): unknown;
}

export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((acc, secret) => acc.split(secret).join('***'), text);
}

export function printResult(out: Writer, value: unknown, pretty: boolean): void {
  out.write(pretty ? formatPretty(value) : `${JSON.stringify(value)}\n`);
}

export function printError(err: Writer, error: TaskwireError, secrets: string[]): void {
  const payload: { error: string; hint?: string } = { error: redact(error.message, secrets) };
  if (error.hint) payload.hint = redact(error.hint, secrets);
  err.write(`${JSON.stringify(payload)}\n`);
}

export function printWarning(err: Writer, message: string, hint: string | undefined, secrets: string[]): void {
  const payload: { warning: string; hint?: string } = { warning: redact(message, secrets) };
  if (hint) payload.hint = redact(hint, secrets);
  err.write(`${JSON.stringify(payload)}\n`);
}

function formatPretty(value: unknown): string {
  if (Array.isArray(value) && value.length > 0 && value.every(isFlatRecord)) {
    return formatTable(value);
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isFlatRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(formatCell).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.username === 'string') return record.username;
    return JSON.stringify(value);
  }
  return String(value);
}

function formatTable(rows: Record<string, unknown>[]): string {
  const columns = Object.keys(rows[0]);
  const cells = rows.map((row) => columns.map((column) => formatCell(row[column])));
  const widths = columns.map((column, i) => Math.max(column.length, ...cells.map((r) => r[i].length)));
  const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return `${[line(columns), ...cells.map(line)].join('\n')}\n`;
}
