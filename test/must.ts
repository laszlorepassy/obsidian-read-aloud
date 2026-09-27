import assert from 'node:assert';

/** `value`, failing the test if it is null or undefined. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  assert.ok(value !== null && value !== undefined, `expected a ${what}`);
  return value;
}
