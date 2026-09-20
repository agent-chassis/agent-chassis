

import { declaredRequestConstraints } from "./zod-request-constraint-declarations.mjs";

const MAX_DEPTH = 64;

export const ZOD_REQUEST_CONTRACT_SCHEMA_VERSION = "zod-request-contract.v1";

const MODELLED_STRING_CHECKS = new Set(["min", "max", "length", "regex", "trim"]);
const MODELLED_NUMBER_CHECKS = new Set(["int", "min", "max"]);

function typeNameOf(schema) {
  return schema?._def?.typeName ?? null;
}

function unwrap(schema) {
  let current = schema;
  let optional = false;
  let nullable = false;
  let description;
  let defaultValue;
  const refinements = [];
  for (let depth = 0; depth < MAX_DEPTH && current?._def; depth += 1) {
    if (description === undefined && typeof current._def.description === "string") {
      description = current._def.description;
    }
    const typeName = typeNameOf(current);
    if (typeName === "ZodOptional") { optional = true; current = current._def.innerType; continue; }
    if (typeName === "ZodNullable") { nullable = true; current = current._def.innerType; continue; }
    if (typeName === "ZodDefault") {
      optional = true;
      if (defaultValue === undefined && typeof current._def.defaultValue === "function") {
        defaultValue = current._def.defaultValue();
      }
      current = current._def.innerType;
      continue;
    }
    if (typeName === "ZodEffects") {
      refinements.push({
        effect: current._def.effect?.type ?? "refinement",
        declared: declaredRequestConstraints(current)
      });
      current = current._def.schema;
      continue;
    }
    if (typeName === "ZodBranded" || typeName === "ZodReadonly") { current = current._def.type; continue; }
    break;
  }
  return { schema: current, optional, nullable, description, defaultValue, refinements };
}

function objectShape(schema) {
  const shape = schema?._def?.shape;
  return typeof shape === "function" ? shape() : (schema?.shape ?? {});
}

function unionOptions(schema) {
  const typeName = typeNameOf(schema);
  if (typeName === "ZodUnion") return schema._def.options ?? [];
  if (typeName === "ZodDiscriminatedUnion") {
    const options = schema._def.options;
    return Array.isArray(options) ? options : [...(options?.values() ?? [])];
  }
  return null;
}

function stringConstraints(schema, report) {
  const projected = { type: "string" };
  for (const check of schema._def.checks ?? []) {
    if (check.kind === "min") projected.minLength = check.value;
    else if (check.kind === "max") projected.maxLength = check.value;
    else if (check.kind === "length") { projected.minLength = check.value; projected.maxLength = check.value; }
    else if (check.kind === "regex") projected.pattern = check.regex.source;
    else if (check.kind === "trim") projected.trimmed = true;
    else if (!MODELLED_STRING_CHECKS.has(check.kind)) {
      report(projected, { reason: "unsupported_check", check: check.kind });
    }
  }
  return projected;
}

function numberConstraints(schema, report) {
  const checks = schema._def.checks ?? [];
  const projected = { type: checks.some((check) => check.kind === "int") ? "integer" : "number" };
  const tighten = (keyword, value, stronger) => {
    if (projected[keyword] === undefined || stronger(value, projected[keyword])) projected[keyword] = value;
  };
  for (const check of checks) {
    if (check.kind === "min") {
      tighten(check.inclusive ? "minimum" : "exclusiveMinimum", check.value, (next, held) => next > held);
    } else if (check.kind === "max") {
      tighten(check.inclusive ? "maximum" : "exclusiveMaximum", check.value, (next, held) => next < held);
    } else if (!MODELLED_NUMBER_CHECKS.has(check.kind)) {
      report(projected, { reason: "unsupported_check", check: check.kind });
    }
  }
  return projected;
}

function arrayConstraints(schema, emit) {
  const projected = { type: "array" };
  emit(schema._def.type, (value) => { projected.items = value; });
  const { minLength, maxLength, exactLength } = schema._def;
  if (exactLength !== null && exactLength !== undefined) {
    projected.minItems = exactLength.value;
    projected.maxItems = exactLength.value;
    return projected;
  }
  if (minLength !== null && minLength !== undefined) projected.minItems = minLength.value;
  if (maxLength !== null && maxLength !== undefined) projected.maxItems = maxLength.value;
  return projected;
}

function objectContract(schema, emit) {
  const shape = objectShape(schema);
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(shape)) {
    emit(value, key, (projected) => { properties[key] = projected; });
    if (typeof value?.isOptional === "function" ? !value.isOptional() : true) required.push(key);
  }
  const projected = { type: "object", properties };
  if (required.length > 0) projected.required = required;

  const unknownKeys = schema._def.unknownKeys;
  projected.additionalProperties = unknownKeys === "passthrough" ? true
    : unknownKeys === "strict" ? false : { stripped: true };
  return projected;
}

function assignDefinitionName(used, hint, index) {
  const base = typeof hint === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(hint)
    ? hint : `def${index}`;
  if (!used.has(base)) { used.add(base); return base; }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

export function projectZodRequestContract(schema, { nameHints = new Map() } = {}) {
  if (schema?._def === undefined) return null;
  const definitions = {};
  const usedNames = new Set();
  const omissions = [];
  const occurrences = [];
  let definitionIndex = 1;

  const omit = (node, path, entry) => {
    omissions.push({ path, ...entry });
    node.unprojected = [...(node.unprojected ?? []), entry];
    return node;
  };

  const project = (node, keyHint, depth, path) => {
    if (node?._def === undefined) return {};
    if (depth > MAX_DEPTH) {
      return omit({}, path, { reason: "max_depth_exceeded", max_depth: MAX_DEPTH });
    }
    const { schema: inner, nullable, description, defaultValue, refinements } = unwrap(node);
    const body = projectInner(inner, keyHint, depth, path);
    const constraints = [];
    for (const refinement of refinements) {
      if (refinement.declared === null) {
        const guidance = description ?? inner?._def?.description;
        omit(body, path, {
          reason: "undeclared_refinement",
          effect: refinement.effect,
          ...(typeof guidance === "string" ? { guidance } : {})
        });
        continue;
      }
      constraints.push(...refinement.declared);
    }

    const restated = description !== undefined &&
      constraints.some((constraint) => constraint.statement === description);
    return {
      ...(nullable ? { nullable: true } : {}),
      ...body,
      ...(constraints.length > 0 ? { constraints } : {}),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(description === undefined || restated ? {} : { description })
    };
  };

  const projectInner = (inner, keyHint, depth, path) => {
    const typeName = typeNameOf(inner);
    const report = (node, entry) => omit(node, path, entry);
    switch (typeName) {
      case "ZodString": return stringConstraints(inner, report);
      case "ZodNumber": return numberConstraints(inner, report);
      case "ZodBoolean": return { type: "boolean" };
      case "ZodNull": return { type: "null" };
      case "ZodLiteral": return { const: inner._def.value };
      case "ZodEnum": return { type: "string", enum: [...inner._def.values] };
      case "ZodNativeEnum": return { enum: [...new Set(Object.values(inner._def.values))] };
      case "ZodArray": return arrayConstraints(
        inner, (item, setValue) => emit(item, keyHint, depth + 1, `${path}[]`, setValue));
      case "ZodObject": return objectContract(
        inner, (value, key, setValue) => emit(value, key, depth + 1, `${path}.${key}`, setValue));
      case "ZodRecord": {
        const record = { type: "object" };
        emit(inner._def.valueType, keyHint, depth + 1, `${path}{}`,
          (value) => { record.additionalProperties = value; });
        return record;
      }

      case "ZodUnknown": case "ZodAny": return {};
      case "ZodDiscriminatedUnion": {
        const oneOf = [];
        unionOptions(inner).forEach((option, index) => emit(
          option, keyHint, depth + 1, `${path}|${index}`, (value) => { oneOf[index] = value; }
        ));
        return { discriminator: inner._def.discriminator, oneOf };
      }
      case "ZodUnion": {
        const anyOf = [];
        unionOptions(inner).forEach((option, index) => emit(
          option, keyHint, depth + 1, `${path}|${index}`, (value) => { anyOf[index] = value; }
        ));
        return { anyOf };
      }
      default: return report({}, {
        reason: "unsupported_schema_construct",
        construct: typeName ?? "unknown"
      });
    }
  };

  const MINIMUM_HOISTED_BYTES = 96;
  const emit = (node, keyHint, depth, path, setValue = () => {}) => {
    if (node?._def === undefined) return {};
    const omissionsBefore = omissions.length;
    const projected = project(node, keyHint, depth, path);
    let current = projected;
    const set = (value) => { current = value; setValue(value); };
    set(projected);
    occurrences.push({ node, keyHint, depth, complete: omissions.length === omissionsBefore,
      get: () => current, set });
    return projected;
  };

  let contract;
  emit(schema, undefined, 0, "$", (value) => { contract = value; });
  const result = {
    schema_version: ZOD_REQUEST_CONTRACT_SCHEMA_VERSION,
    contract,
    ...(omissions.length > 0 ? { unprojected: omissions } : {})
  };

  const reachableObjects = () => {
    const reached = new Set();
    const visit = (value) => {
      if (value === null || typeof value !== "object" || reached.has(value)) return;
      reached.add(value);
      for (const child of Object.values(value)) visit(child);
    };
    visit(result.contract);
    visit(definitions);
    return reached;
  };
  const groups = [];
  const byIdentity = new Map();
  for (const occurrence of occurrences) {
    if (!occurrence.complete) continue;
    let depths = byIdentity.get(occurrence.node);
    if (depths === undefined) { depths = new Map(); byIdentity.set(occurrence.node, depths); }
    let group = depths.get(occurrence.depth);
    if (group === undefined) {
      group = { node: occurrence.node, depth: occurrence.depth, occurrences: [] };
      depths.set(occurrence.depth, group);
      groups.push(group);
    }
    group.occurrences.push(occurrence);
  }

  groups.sort((left, right) => left.depth - right.depth);
  for (const group of groups) {
    const reachable = reachableObjects();
    const sites = group.occurrences.filter((occurrence) => reachable.has(occurrence.get()));
    if (sites.length < 2) continue;
    const body = sites[0].get();
    if (Buffer.byteLength(JSON.stringify(body), "utf8") < MINIMUM_HOISTED_BYTES) continue;

    const trialNames = new Set(usedNames);
    const name = assignDefinitionName(trialNames,
      nameHints.get(group.node) ?? sites[0].keyHint, definitionIndex);
    const reference = { $ref: `#/$defs/${name}` };
    const inlineBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    const originals = sites.map((site) => site.get());
    definitions[name] = body;
    result.$defs = definitions;
    for (const site of sites) site.set(reference);
    const referencedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (referencedBytes <= inlineBytes) {
      usedNames.add(name);
      definitionIndex += 1;
      continue;
    }
    for (let index = 0; index < sites.length; index += 1) sites[index].set(originals[index]);
    delete definitions[name];
    if (Object.keys(definitions).length === 0) delete result.$defs;
  }
  return result;
}

export function zodDiscriminatedUnionDiscriminatorValues(union) {
  const { schema: inner } = unwrap(union);
  if (typeNameOf(inner) !== "ZodDiscriminatedUnion") return null;
  const discriminator = inner._def.discriminator;
  return unionOptions(inner).map(
    (option) => objectShape(option)[discriminator]?._def?.value
  );
}

export function projectZodDiscriminatedUnionMembers(union, discriminatorValues, options = {}) {
  const { schema: inner } = unwrap(union);
  if (typeNameOf(inner) !== "ZodDiscriminatedUnion") return null;
  const discriminator = inner._def.discriminator;
  const wanted = new Set(discriminatorValues);
  const selected = unionOptions(inner).filter((option) => {
    const value = objectShape(option)[discriminator]?._def?.value;
    return wanted.has(value);
  });
  if (selected.length === 0) return null;

  const carrier = { _def: { typeName: "ZodDiscriminatedUnion", discriminator, options: selected } };
  const projected = projectZodRequestContract(carrier, options);
  if (projected === null) return null;
  const members = {};
  const oneOf = projected.contract.oneOf ?? [];
  selected.forEach((option, index) => {
    const value = objectShape(option)[discriminator]?._def?.value;
    members[value] = oneOf[index];
  });
  return {
    schema_version: ZOD_REQUEST_CONTRACT_SCHEMA_VERSION,
    discriminator,
    members,
    ...(projected.$defs === undefined ? {} : { $defs: projected.$defs }),
    ...(projected.unprojected === undefined ? {} : { unprojected: projected.unprojected })
  };
}
