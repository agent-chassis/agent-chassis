

import { isPlainObject } from "./backend-review-identity.mjs";
import { managedRefusal, MANAGED_LIFECYCLE_REQUIRED } from "./backend-provisioning-state.mjs";

export function scopeAuthorityRefusal(blocker, detail = null) {
  return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, { blocker, ...detail });
}

export function firstOwnField(source, fields) {
  if (!isPlainObject(source)) return null;
  return fields.find((field) => Object.prototype.hasOwnProperty.call(source, field)) ?? null;
}

export function deepFreezeCanonicalSnapshot(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreezeCanonicalSnapshot(child);
  return Object.freeze(value);
}

export function sameStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index]);
}
