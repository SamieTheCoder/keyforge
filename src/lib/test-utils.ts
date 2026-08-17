/** Narrow a nullable value in tests; fails loudly if it is missing. */
export function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a value, got null/undefined');
  return value;
}
