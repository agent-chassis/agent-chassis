

import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

export function resolveServedNode(inputContract, node) {
  const seen = new Set();
  while (node?.$ref) {
    assert.ok(!seen.has(node.$ref), `nonproductive served reference cycle ${node.$ref}`);
    seen.add(node.$ref);
    const reference = node.$ref;
    const { $ref: _reference, ...siblings } = node;
    let target;
    if (reference.startsWith('#/')) target = reference.slice(2).split("/").reduce((value_, segment) =>
      value_?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], inputContract);
    else {

      const matches = [];
      const visit = value => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value !== null && typeof value === 'object') {
          if (value.$id === reference) matches.push(value);
          for (const [key, child] of Object.entries(value)) {
            if (!['const', 'enum', 'default', 'examples'].includes(key)) visit(child);
          }
        }
      };
      visit(inputContract);
      assert.equal(matches.length, 1, `served reference ${reference} must identify one held resource`);
      [target] = matches;
    }
    assert.ok(target !== undefined, `unresolved served reference ${reference}`);
    for (const [key, value] of Object.entries(siblings)) {
      if (key in target && !['description', 'title', 'default', 'examples'].includes(key)) assert.deepEqual(value, target[key], `reference siblings agree on ${key}`);
    }
    node = { ...target, ...siblings };
  }
  return node;
}

export function servedProperty(inputContract, node, name) {
  const resolved = resolveServedNode(inputContract, node);
  assert.equal(resolved.type, "object");
  assert.ok(Object.hasOwn(resolved.properties ?? {}, name),
    `served contract must declare ${name}`);
  return resolveServedNode(inputContract, resolved.properties[name]);
}

export function servedObject(inputContract, node, values) {
  const resolved = resolveServedNode(inputContract, node);
  assert.equal(resolved.type, "object");
  assert.equal(resolved.additionalProperties, false,
    "corrected nested objects are derived from closed served declarations");
  for (const name of Object.keys(values)) {
    assert.ok(Object.hasOwn(resolved.properties ?? {}, name),
      `corrected field ${name} must be served`);
  }
  for (const name of resolved.required ?? []) {
    assert.ok(Object.hasOwn(values, name), `corrected object must supply served required field ${name}`);
  }
  return values;
}

function joinedAlternative(closed, alternative) {
  const forbidden = alternative.not?.required ?? [];
  assert.ok(alternative.not === undefined || (Object.keys(alternative.not).length === 1 && forbidden.length === 1),
    "a served alternative forbids at most one named member");
  for (const [name, declared] of Object.entries(alternative.properties ?? {})) {
    assert.deepEqual(declared, closed.properties[name], `joined alternatives agree on served field ${name}`);
  }
  const properties = Object.fromEntries(Object.entries(closed.properties)
    .filter(([name]) => !forbidden.includes(name)));
  const required = [...new Set([...(closed.required ?? []), ...(alternative.required ?? [])])];
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false };
}

export function servedAlternatives(inputContract, node) {
  const resolved = resolveServedNode(inputContract, node);
  if (resolved.allOf !== undefined) {
    assert.equal(resolved.allOf.length, 2, "a served intersection joins one closed object with its alternatives");
    const [closed, choices] = resolved.allOf.map((member) => resolveServedNode(inputContract, member));
    assert.equal(closed.type, "object");
    assert.equal(closed.additionalProperties, false, "the joined object is served closed");
    return servedAlternatives(inputContract, choices).map((alternative) => joinedAlternative(closed, alternative));
  }
  const members = resolved.anyOf ?? resolved.oneOf;
  return members === undefined ? [resolved]
    : members.flatMap((member) => servedAlternatives(inputContract, member));
}

export function servedAccepts(inputContract, node, value_) {
  if (node === false) return false;
  if (node === undefined || node === true) return true;
  const schema = resolveServedNode(inputContract, node);
  if ((schema.minItems !== undefined || schema.maxItems !== undefined) &&
      (!Array.isArray(value_) || value_.length < (schema.minItems ?? 0) || value_.length > (schema.maxItems ?? Infinity))) return false;
  if (schema.allOf !== undefined &&
      !schema.allOf.every((member) => servedAccepts(inputContract, member, value_))) return false;
  if (schema.not !== undefined && servedAccepts(inputContract, schema.not, value_)) return false;
  if (Array.isArray(schema.type)) {
    return schema.type.some((type) => servedAccepts(inputContract, { ...schema, type }, value_));
  }
  const members = schema.anyOf ?? schema.oneOf;
  if (members !== undefined) {
    const accepted = members.filter((member) =>
      servedAccepts(inputContract, member, value_)).length;
    return schema.oneOf === undefined ? accepted > 0 : accepted === 1;
  }
  if (Object.hasOwn(schema, "const")) return isDeepStrictEqual(schema.const, value_);
  if (schema.enum !== undefined &&
      !schema.enum.some((entry) => isDeepStrictEqual(entry, value_))) return false;
  const within = (size, minimum, maximum) =>
    size >= (minimum ?? 0) && size <= (maximum ?? Number.POSITIVE_INFINITY);
  switch (schema.type) {
    case "object": {
      if (value_ === null || typeof value_ !== "object" || Array.isArray(value_)) return false;
      const properties = schema.properties ?? {};

      const additional = schema.additionalProperties;
      return (schema.required ?? []).every((name) => Object.hasOwn(value_, name)) &&
        (schema.propertyNames === undefined ||
          Object.keys(value_).every((name) => servedAccepts(inputContract, schema.propertyNames, name))) &&
        Object.entries(value_).every(([name, member]) => Object.hasOwn(properties, name)
          ? servedAccepts(inputContract, properties[name], member)
          : additional !== null && typeof additional === "object"
            ? servedAccepts(inputContract, additional, member) : additional !== false);
    }
    case "array":
      return Array.isArray(value_) && within(value_.length, schema.minItems, schema.maxItems) &&
        value_.every((item, index) => servedAccepts(inputContract, schema.prefixItems?.[index] ?? schema.items, item));
    case "string":
      return typeof value_ === "string" &&
        within(value_.length, schema.minLength, schema.maxLength) &&
        (schema.pattern === undefined || new RegExp(schema.pattern).test(value_));
    case "integer":
    case "number":
      return typeof value_ === "number" &&
        (schema.type === "number" || Number.isInteger(value_)) &&
        within(value_, schema.minimum, schema.maximum);
    case "boolean":
      return typeof value_ === "boolean";
    case "null":
      return value_ === null;
    default:

      assert.equal(schema.type, undefined, `unsupported served type ${schema.type}`);
      return value_ === null || typeof value_ !== "object" || Array.isArray(value_) ||
        (schema.required ?? []).every((name) => Object.hasOwn(value_, name));
  }
}

export function servedBranch(inputContract, node, discriminators, fields, admits = () => true) {
  const matching = servedAlternatives(inputContract, node).filter((candidate) =>
    candidate.type === "object" &&
    fields.every((name) => Object.hasOwn(candidate.properties ?? {}, name)) &&
    (candidate.required ?? []).every((name) => fields.includes(name)) &&
    Object.entries(discriminators).every(([name, member]) =>
      servedAccepts(inputContract, candidate.properties[name], member)) &&
    admits(candidate));
  assert.ok(matching.length > 0,
    `served contract must admit ${JSON.stringify(discriminators)} with fields ${fields}`);
  for (const candidate of matching.slice(1)) {
    for (const name of fields) {
      assert.deepEqual(resolveServedNode(inputContract, candidate.properties[name]),
        resolveServedNode(inputContract, matching[0].properties[name]),
        `admitted alternatives must agree on served field ${name}`);
    }
  }
  return matching[0];
}

const LOCAL_DEFINITIONS = "#/$defs/";

function referencesOf(value, found = []) {
  if (Array.isArray(value)) value.forEach(item => referencesOf(item, found));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") found.push(child);
      else referencesOf(child, found);
    }
  }
  return found;
}

export function servedInputContractDefect(payload, { tool, unit, members }) {
  const contract = payload?.input_contract;
  if (contract === null || typeof contract !== "object") return { missing: "selected_detail" };
  if (payload.complete !== true) return { missing: "complete_answer" };
  if (contract.tool !== tool) return { missing: "addressed_tool", delivered: contract.tool ?? null };
  if (contract.unit !== unit) return { missing: "addressed_unit", delivered: contract.unit ?? null };
  const schema = contract.schema;
  if (schema === null || typeof schema !== "object" || !Array.isArray(contract.members)) return { missing: "selected_schema" };
  for (const member of members) {
    if (!contract.members.includes(member) || schema.properties?.[member] === undefined) {
      return { missing: "selected_member", member };
    }
  }
  for (const reference of referencesOf(schema)) {
    if (!reference.startsWith(LOCAL_DEFINITIONS) || schema.$defs?.[reference.slice(LOCAL_DEFINITIONS.length)] === undefined) {
      return { missing: "referenced_definition", reference };
    }
  }
  return null;
}
