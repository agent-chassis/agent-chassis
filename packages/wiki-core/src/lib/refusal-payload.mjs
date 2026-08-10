

import { isDeepStrictEqual } from "node:util";

const definitionsByCode = new Map();

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndFreeze(value, seen = new Set()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("refusal definitions must not contain cycles");
    }
    seen.add(value);
    const copy = value.map((entry) => cloneAndFreeze(entry, seen));
    seen.delete(value);
    return Object.freeze(copy);
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      throw new TypeError("refusal definitions must not contain cycles");
    }
    seen.add(value);
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry, seen)])
    );
    seen.delete(value);
    return Object.freeze(copy);
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new TypeError("refusal definitions must contain only controlled data values");
}

function assertStableString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`refusal definition ${field} must be a non-empty stable string`);
  }
}

function assertPayloadFields(fields) {
  if (!isPlainObject(fields)) {
    throw new TypeError("refusal payload fields must be a plain object");
  }
  if (Object.hasOwn(fields, "code")) {
    throw new TypeError("refusal payload code comes from its registered definition");
  }
  if (Object.hasOwn(fields, "next_action")) {
    throw new TypeError("next_action belongs beside the refusal payload in its envelope");
  }
}

function payloadFor(definition, fields) {
  assertPayloadFields(fields);
  return { code: definition.code, ...fields };
}

export function defineRefusalCode(definition) {
  if (!isPlainObject(definition)) {
    throw new TypeError("refusal definition must be a plain object");
  }
  assertStableString(definition.code, "code");
  assertStableString(definition.namespace, "namespace");

  const candidate = cloneAndFreeze(definition);
  const existing = definitionsByCode.get(candidate.code);
  if (existing) {
    if (isDeepStrictEqual(existing, candidate)) return existing;
    throw new TypeError(
      `divergent refusal definition for registered code ${JSON.stringify(candidate.code)}`
    );
  }

  definitionsByCode.set(candidate.code, candidate);
  return candidate;
}

export function buildRefusal(definition, fields = {}) {
  const registered = isPlainObject(definition)
    ? definitionsByCode.get(definition.code)
    : undefined;
  if (registered !== definition) {
    throw new TypeError("buildRefusal requires a registered refusal definition");
  }
  return payloadFor(registered, fields);
}

export function forwardRefusal(code, fields = {}) {
  const registered = definitionsByCode.get(code);
  if (!registered) {
    throw new TypeError("forwardRefusal requires a registered refusal code");
  }
  return payloadFor(registered, fields);
}
