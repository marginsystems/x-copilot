export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

export function hasOptional<K extends string, T>(
  value: unknown,
  key: K,
  guard: (item: unknown) => item is T,
): value is Record<K, T | undefined> {
  return isRecord(value) && (value[key] === undefined || guard(value[key]));
}

export function hasStrings<K extends string>(
  value: unknown,
  ...keys: K[]
): value is Record<K, string> {
  return isRecord(value) && keys.every((key) => isString(value[key]));
}

export function hasNullableStrings<K extends string>(
  value: unknown,
  ...keys: K[]
): value is Record<K, string | null> {
  return isRecord(value) && keys.every((key) => value[key] === null || isString(value[key]));
}

export function stringRow<K extends string>(value: unknown, ...keys: K[]): Record<K, string> {
  if (!hasStrings(value, ...keys)) throw new TypeError("Invalid database row");
  return value;
}

export function optionalStringRow<K extends string>(value: unknown, ...keys: K[]): Record<K, string> | undefined {
  if (value === undefined) return undefined;
  return stringRow(value, ...keys);
}

export function optionalNullableStringRow<K extends string>(value: unknown, ...keys: K[]): Record<K, string | null> | undefined {
  if (value === undefined) return undefined;
  if (!hasNullableStrings(value, ...keys)) throw new TypeError("Invalid database row");
  return value;
}

export function hasOptionalStrings<K extends string>(value: unknown, ...keys: K[]): value is Partial<Record<K, string>> {
  return isRecord(value) && keys.every((key) => value[key] === undefined || isString(value[key]));
}
