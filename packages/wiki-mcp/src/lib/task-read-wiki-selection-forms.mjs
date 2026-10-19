

import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);

const RESOURCE_OWNED_VALUES = Object.freeze(["field"]);

function compactKey(name, declared) {
  if (!isObject(declared)) return {};
  if (RESOURCE_OWNED_VALUES.includes(name) && declared.type === "string") return { type: "string" };

  if (Object.hasOwn(declared, "const")) return {
    ...(Object.hasOwn(declared, "type") ? { type: declared.type } : {}), const: declared.const
  };
  const types = declared.type === undefined ? [] : [].concat(declared.type);
  if (types.length > 0 && types.every((type) => SCALAR_TYPES.has(type))) return declared;
  return typeof declared.description === "string" ? { description: declared.description } : {};
}

function selectAlternatives(converted) {
  const select = converted?.properties?.select;
  if (!isObject(select)) return null;
  const resolve = (node, seen = new Set()) => {
    if (Array.isArray(node)) return node.map((item) => resolve(item, seen));
    if (!isObject(node)) return node;
    if (typeof node.$ref === "string") {
      if (!node.$ref.startsWith("#/") || seen.has(node.$ref)) {
        throw new TypeError(`workspace_read_wiki publication: unsupported reference ${node.$ref}`);
      }
      const target = node.$ref.slice(2).split("/").reduce((value, part) =>
        value?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], converted);
      if (target === undefined) throw new TypeError(`workspace_read_wiki publication: ${node.$ref} names no declaration`);
      return resolve(target, new Set([...seen, node.$ref]));
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value, seen)]));
  };
  return { description: select.description, alternatives: (select.anyOf ?? [select]).map((alternative) => resolve(alternative)) };
}

function stringMap(node) {
  if (!isObject(node) || node.type !== "object" || !isObject(node.properties) || (node.required ?? []).length > 0) return node;
  const names = Object.keys(node.properties);
  if (names.length < 4 || !Object.values(node.properties).every((member) =>
    isObject(member) && Object.keys(member).length === 1 && member.type === "string")) return node;
  return { type: "object", additionalProperties: { type: "string" },

    description: node.description ?? `Keys: ${names.join(", ")}.` };
}

export function publishedReadWikiInputSchema(converted) {
  return compactSelect(converted);
}

function compactSelect(source) {
  const search = source?.properties?.search;
  const converted = !isObject(search?.properties?.where) ? source : { ...source, properties: { ...source.properties,
    search: { ...search, properties: { ...search.properties, where: stringMap(search.properties.where) } } } };
  const selected = selectAlternatives(converted);
  if (selected === null) return converted;
  const properties = {};
  for (const alternative of selected.alternatives) {
    for (const [name, declared] of Object.entries(alternative.properties ?? {})) {
      const next = compactKey(name, declared), previous = properties[name];
      if (previous === undefined) { properties[name] = next; continue; }
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;

      const values = node => Object.hasOwn(node, 'const') ? [node.const] : node.enum ?? null;
      const left = values(previous), right = values(next);
      const types = [...new Set([previous.type, next.type].flat().filter(Boolean))];
      properties[name] = left !== null && right !== null
        ? { ...(types.length === 1 ? { type: types[0] } : {}), enum: [...new Set([...left, ...right])] }
        : types.length > 0 ? { type: types.length === 1 ? types[0] : types } : {};
    }
  }
  return { ...converted, properties: { ...converted.properties, select: { type: "object", minProperties: 1,
    additionalProperties: false, ...(selected.description === undefined ? {} : { description: selected.description }),
    properties } } };
}

export function selectionForm(converted, name) {
  const selected = selectAlternatives(converted);
  if (selected === null) return [];
  return selected.alternatives.filter((alternative) => Object.keys(alternative.properties ?? {})[0] === name);
}

export function createReadWikiSelectionForms(requestObject) {
  let converted = null;
  const full = () => (converted ??= toJsonSchemaCompat(requestObject, { strictUnions: true, pipeStrategy: "input" }));
  return Object.freeze({ formOf: (name) => selectionForm(full(), name) });
}
