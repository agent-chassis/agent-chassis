import { valueFailure } from './controlled-values-v1.mjs';
export const DURATION_UNITS = Object.freeze({
  s: Object.freeze({ milliseconds: 1000, basis: 'UCUM 2.2 base unit second' }),
  ms: Object.freeze({ milliseconds: 1, basis: 'UCUM 2.2 prefix m (10^-3) applied to s' })
});
export const MAX_DURATION_MILLISECONDS = 315_576_000_000_000;
export function normalizeDuration(quantity, field = 'duration', {
  refuse = (at, cause) => valueFailure('value_duration_invalid', at, cause), feedback = {}
} = {}) {
  if (quantity === null || typeof quantity !== 'object' || Array.isArray(quantity)) refuse(field, 'must be a duration quantity');
  for (const key of Object.keys(quantity)) if (!['value', 'unit'].includes(key)) refuse(`${field}.${key}`, 'is not a duration field');
  const units = Object.keys(DURATION_UNITS);
  if (!Object.hasOwn(quantity, 'value')) refuse(`${field}.value`, 'is required', 'a nonnegative safe integer', null, feedback.value);
  if (!Object.hasOwn(quantity, 'unit')) refuse(`${field}.unit`, 'is required', units, null, feedback.unit);
  if (typeof quantity.unit !== 'string' || !Object.hasOwn(DURATION_UNITS, quantity.unit)) refuse(`${field}.unit`,
    `${JSON.stringify(quantity.unit)} is not an accepted UCUM code`, units,
    'use the case-sensitive UCUM code "s" or "ms"', feedback.unit);
  if (!Number.isSafeInteger(quantity.value) || quantity.value < 0) refuse(`${field}.value`,
    'must be a nonnegative safe integer', 'a nonnegative safe integer',
    'give a whole number; express fractions of a second in ms', feedback.value);
  const milliseconds = quantity.value * DURATION_UNITS[quantity.unit].milliseconds;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > MAX_DURATION_MILLISECONDS) refuse(`${field}.value`,
    'overflows the supported duration range', `at most ${MAX_DURATION_MILLISECONDS} ms`, null, feedback.quantity);
  return { quantity: 'duration', milliseconds, unit: 'ms' };
}
