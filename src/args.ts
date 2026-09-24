import { usageError } from './errors.ts';

export type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

export interface CommandInput {
  positionals: string[];
  values: Values;
}

export function optString(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

export function reqString(values: Values, key: string): string {
  const value = optString(values, key);
  if (value === undefined || value.trim() === '') throw usageError(`Missing --${key}`);
  return value;
}

export function optStrings(values: Values, key: string): string[] {
  const value = values[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

export function flag(values: Values, key: string): boolean {
  return values[key] === true;
}

export function onePositional(input: CommandInput, name: string): string {
  if (input.positionals.length !== 1) throw usageError(`Expected exactly one ${name}`);
  return input.positionals[0];
}
