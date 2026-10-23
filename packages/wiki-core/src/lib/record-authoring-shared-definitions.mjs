

export const RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX = "#/$defs/";
export const RECORD_AUTHORING_SHARED_DEFINITION_CODES = Object.freeze({
  NAME_INVALID: "record_authoring_shared_definition_name_invalid",
  NAME_COLLISION: "record_authoring_shared_definition_name_collision",
  NODE_INVALID: "record_authoring_shared_definition_node_invalid",
  NODE_UNUSED: "record_authoring_shared_definition_node_unused",
  REFERENCE_UNSUPPORTED: "record_authoring_definition_reference_unsupported",
  REFERENCE_UNRESOLVED: "record_authoring_definition_reference_unresolved"
});
const CODES = RECORD_AUTHORING_SHARED_DEFINITION_CODES;
const refuse = (code, name, message) => {
  throw Object.assign(new TypeError(`${code}: ${name}: ${message}`), { code, definition: name });
};
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const NAME = /^[a-z][a-z0-9_]*$/u;

export const recordAuthoringDefinitionReference = name => ({ $ref: `${RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX}${name}` });

export function recordAuthoringDefinitionName(node) {
  if (!isObject(node) || !Object.hasOwn(node, "$ref")) return null;
  const reference = node.$ref;
  if (typeof reference !== "string" || !reference.startsWith(RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX) ||
      !NAME.test(reference.slice(RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX.length))) {
    refuse(CODES.REFERENCE_UNSUPPORTED, String(reference),
      `only ${RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX}<name> references to this schema's own definitions are supported`);
  }
  return reference.slice(RECORD_AUTHORING_DEFINITION_REFERENCE_PREFIX.length);
}

export function resolveRecordAuthoringDefinition(schema, node) {
  const name = recordAuthoringDefinitionName(node);
  if (name === null) return node;
  const definition = schema?.$defs?.[name];
  if (definition === undefined) {
    refuse(CODES.REFERENCE_UNRESOLVED, name, "the schema declares no definition of this name");
  }
  if (isObject(definition) && Object.hasOwn(definition, "$ref")) {
    refuse(CODES.REFERENCE_UNSUPPORTED, name, "a definition that is itself a reference is not followed");
  }
  return definition;
}

function referenced(value, node, reference, counted, equivalent = null) {
  if (value === node || (equivalent !== null && isObject(value) && JSON.stringify(value) === equivalent)) { counted.uses += 1; return reference; }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => { const next = referenced(item, node, reference, counted, equivalent); changed ||= next !== item; return next; });
    return changed ? items : value;
  }
  if (!isObject(value)) return value;
  let changed = false;
  const entries = Object.entries(value).map(([key, member]) => {
    const next = referenced(member, node, reference, counted, equivalent);
    changed ||= next !== member;
    return [key, next];
  });
  return changed ? Object.fromEntries(entries) : value;
}

export function shareRecordAuthoringDefinitions({ properties, definitions = {}, shared }) {
  const names = new Set(Object.keys(definitions));
  const bodies = new Map();
  let result = properties;
  let retained = definitions;
  for (const [name, node, options] of shared) {
    if (typeof name !== "string" || !NAME.test(name)) refuse(CODES.NAME_INVALID, String(name), "a definition name is a lower-case identifier");
    if (names.has(name)) refuse(CODES.NAME_COLLISION, name, "the schema already declares a definition of this name");
    if (!isObject(node) || Object.hasOwn(node, "$ref")) {
      refuse(CODES.NODE_INVALID, name, "a shared definition is an object schema that is not itself a reference");
    }
    names.add(name);
    const counted = { uses: 0 };
    const reference = recordAuthoringDefinitionReference(name);
    const equivalent = options?.equivalent === true ? JSON.stringify(node) : null;
    result = referenced(result, node, reference, counted, equivalent);

    if (equivalent !== null) retained = Object.fromEntries(Object.entries(retained).map(([key, body]) =>
      [key, isObject(body) && JSON.stringify(body) === equivalent ? body
        : referenced(body, node, reference, counted, equivalent)]));
    for (const [earlier, body] of bodies) bodies.set(earlier,
      equivalent !== null && isObject(body) && JSON.stringify(body) === equivalent ? body
        : referenced(body, node, reference, counted, equivalent));
    if (counted.uses === 0) refuse(CODES.NODE_UNUSED, name, "no position of the schema holds this node");
    bodies.set(name, node);
  }
  return { properties: result, $defs: { ...retained, ...Object.fromEntries(bodies) } };
}
