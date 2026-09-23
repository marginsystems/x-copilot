export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return values.some((candidate) => candidate === value);
}
