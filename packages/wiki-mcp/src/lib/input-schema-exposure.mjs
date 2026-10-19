

export { compactInputSchemaAdvertisement, isScalarMemberDeclaration } from "./input-schema-compact-advertisement.mjs";

export const INPUT_SCHEMA_EXPOSURE_CODES = Object.freeze({
  DECLARATION_INVALID: "input_schema_exposure_declaration_invalid",
  SOURCE_INVALID: "input_schema_exposure_source_invalid",
  SOURCE_UNKNOWN: "input_schema_exposure_source_unknown",
  REFERENCE_UNSUPPORTED: "input_schema_exposure_reference_unsupported",
  REFERENCE_UNRESOLVED: "input_schema_exposure_reference_unresolved",
  GROUP_MEMBER_UNKNOWN: "input_schema_exposure_group_member_unknown",
  GROUP_MEMBER_DUPLICATE: "input_schema_exposure_group_member_duplicate",
  MEMBER_UNASSIGNED: "input_schema_exposure_member_unassigned",
  GUIDANCE_INVALID: "input_schema_exposure_guidance_invalid",
  SELECTION_INVALID: "input_schema_exposure_selection_invalid",
  SELECTION_EMPTY: "input_schema_exposure_selection_empty",
  SELECTION_MEMBER_UNKNOWN: "input_schema_exposure_selection_member_unknown",
  SELECTION_GROUP_UNKNOWN: "input_schema_exposure_selection_group_unknown"
});

export class InputSchemaExposureError extends TypeError {
  constructor(code, { source = null, path = null, cause }) {
    super(`${code}: ${source === null ? "" : `${source}${path === null ? "" : ` at ${path}`}: `}${cause}`);
    this.name = "InputSchemaExposureError";
    Object.assign(this, { code, source, path, cause_detail: cause });
  }
}
const refuse = (code, detail) => { throw new InputSchemaExposureError(code, detail); };

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const LOCAL_DEFINITIONS = "#/$defs/";

const DATA_KEYWORDS = new Set(["const", "enum", "default", "examples", "required", "dependentRequired"]);

const NAMED_SCHEMA_MAPS = new Set(["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"]);

const UNSUPPORTED_REFERENCE_KEYWORDS = new Set(["$dynamicRef", "$recursiveRef"]);

const MEMBER_CARRIERS = new Set(["properties", "$defs"]);

const pointerSegment = name => name.replaceAll("~1", "/").replaceAll("~0", "~");

function directReferences(node, definitions, source, at) {
  const found = new Set();
  (function walk(value, path) {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}/${index}`)); return; }
    if (!isObject(value)) return;
    for (const [keyword, child] of Object.entries(value)) {
      const childPath = `${path}/${keyword}`;
      if (UNSUPPORTED_REFERENCE_KEYWORDS.has(keyword)) {
        refuse(INPUT_SCHEMA_EXPOSURE_CODES.REFERENCE_UNSUPPORTED, { source, path: childPath,
          cause: `${keyword} is not a local definition reference` });
      }
      if (keyword === "$ref") {
        if (typeof child !== "string" || !child.startsWith(LOCAL_DEFINITIONS) ||
            child.slice(LOCAL_DEFINITIONS.length).includes("/")) {
          refuse(INPUT_SCHEMA_EXPOSURE_CODES.REFERENCE_UNSUPPORTED, { source, path: childPath,
            cause: `only ${LOCAL_DEFINITIONS}<name> references are supported; found ${JSON.stringify(child)}` });
        }
        const name = pointerSegment(child.slice(LOCAL_DEFINITIONS.length));
        if (!Object.hasOwn(definitions, name)) {
          refuse(INPUT_SCHEMA_EXPOSURE_CODES.REFERENCE_UNRESOLVED, { source, path: childPath,
            cause: `${child} names no definition of this source` });
        }
        found.add(name);
      } else if (DATA_KEYWORDS.has(keyword)) {
        continue;
      } else if (NAMED_SCHEMA_MAPS.has(keyword) && isObject(child)) {
        for (const [name, schema] of Object.entries(child)) walk(schema, `${childPath}/${name}`);
      } else walk(child, childPath);
    }
  })(node, at);
  return found;
}

function prepareSource(name, schema) {
  if (!isObject(schema) || !isObject(schema.properties) || Object.keys(schema.properties).length === 0) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.SOURCE_INVALID, { source: name, path: "/properties",
      cause: "a source is a JSON Schema object with at least one declared member" });
  }
  if (schema.$defs !== undefined && !isObject(schema.$defs)) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.SOURCE_INVALID, { source: name, path: "/$defs", cause: "$defs is not an object" });
  }
  const definitions = schema.$defs ?? {};
  const references = (nodes, at) => new Map(Object.entries(nodes).map(([member, node]) =>
    [member, directReferences(node, definitions, name, `${at}/${member}`)]));
  for (const keyword of Object.keys(schema)) {
    if (UNSUPPORTED_REFERENCE_KEYWORDS.has(keyword) || keyword === "$ref") {
      refuse(INPUT_SCHEMA_EXPOSURE_CODES.REFERENCE_UNSUPPORTED, { source: name, path: `/${keyword}`,
        cause: "the source object itself is a reference" });
    }
  }

  const constraints = Object.fromEntries(Object.entries(schema).filter(([keyword]) => !MEMBER_CARRIERS.has(keyword)));
  return { schema, members: Object.keys(schema.properties), definitions: Object.keys(definitions),
    constraintReferences: directReferences(constraints, definitions, name, ""),
    memberReferences: references(schema.properties, "/properties"), definitionReferences: references(definitions, "/$defs") };
}

function reachableDefinitions(prepared, members) {
  const reached = new Set();
  const pending = [...prepared.constraintReferences,
    ...members.flatMap(member => [...prepared.memberReferences.get(member)])];
  while (pending.length > 0) {
    const definition = pending.pop();
    if (reached.has(definition)) continue;
    reached.add(definition);
    pending.push(...prepared.definitionReferences.get(definition));
  }
  return prepared.definitions.filter(definition => reached.has(definition));
}

const stringList = value => Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0);

function prepareGroups(name, prepared, groups) {
  if (!Array.isArray(groups) || groups.length === 0 || groups.some(group => !isObject(group) ||
      typeof group.name !== "string" || group.name.length === 0 || !stringList(group.members) || group.members.length === 0)) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.DECLARATION_INVALID, { source: name, path: "/groups",
      cause: "groups is a non-empty list of { name, members } with at least one member each" });
  }
  const home = new Map();
  for (const group of groups) {
    if (groups.filter(other => other.name === group.name).length > 1) {
      refuse(INPUT_SCHEMA_EXPOSURE_CODES.DECLARATION_INVALID, { source: name, path: `/groups/${group.name}`,
        cause: "a group name is declared more than once" });
    }
    for (const member of group.members) {
      if (!prepared.memberReferences.has(member)) {
        refuse(INPUT_SCHEMA_EXPOSURE_CODES.GROUP_MEMBER_UNKNOWN, { source: name, path: `/groups/${group.name}/${member}`,
          cause: `${member} is not a member of this source` });
      }
      if (home.has(member)) {
        refuse(INPUT_SCHEMA_EXPOSURE_CODES.GROUP_MEMBER_DUPLICATE, { source: name, path: `/groups/${group.name}/${member}`,
          cause: `${member} is already assigned to ${home.get(member)}` });
      }
      home.set(member, group.name);
    }
  }
  const unassigned = prepared.members.filter(member => !home.has(member));
  if (unassigned.length > 0) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.MEMBER_UNASSIGNED, { source: name, path: "/groups",
      cause: `no group holds ${unassigned.join(", ")}` });
  }

  return groups.map(group => Object.freeze({ name: group.name,
    members: Object.freeze(prepared.members.filter(member => home.get(member) === group.name)) }));
}

function prepareGuidance(name, prepared, guidance = {}) {
  if (!isObject(guidance)) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.GUIDANCE_INVALID, { source: name, path: "/guidance", cause: "guidance is not an object" });
  }
  return new Map(Object.entries(guidance).map(([member, topics]) => {
    if (!prepared.memberReferences.has(member)) {
      refuse(INPUT_SCHEMA_EXPOSURE_CODES.GUIDANCE_INVALID, { source: name, path: `/guidance/${member}`,
        cause: `${member} is not a member of this source` });
    }
    if (!Array.isArray(topics) || topics.length === 0 || !topics.every(topic => stringList(topic) && topic.length > 0)) {
      refuse(INPUT_SCHEMA_EXPOSURE_CODES.GUIDANCE_INVALID, { source: name, path: `/guidance/${member}`,
        cause: "guidance is a non-empty list of topic paths" });
    }
    return [member, Object.freeze(topics.map(topic => Object.freeze([...topic])))];
  }));
}

function boundSource(name, declared, digestOf) {
  const prepared = prepareSource(name, declared.schema);
  const branches = declared.branches ?? {};
  if (!isObject(branches) || Object.entries(branches).some(([member, branch]) =>
      !prepared.members.includes(member) || !isObject(branch) || !isObject(branch.metadata) || typeof branch.select !== 'function' || typeof branch.validate !== 'function')) {
    refuse(INPUT_SCHEMA_EXPOSURE_CODES.DECLARATION_INVALID, { source: name, path: '/branches', cause: 'each branch binds a source member, metadata, owner validation and selection functions' });
  }
  for (const branch of Object.values(branches)) branch.validate(declared.schema);
  const groups = Object.freeze(prepareGroups(name, prepared, declared.groups));
  const guidance = prepareGuidance(name, prepared, declared.guidance);
  const groupMembers = new Map(groups.map(group => [group.name, group.members]));

  let digest = null;
  const sourceDigest = () => (digest ??= digestOf(Object.keys(branches).length ? { schema: prepared.schema, branches: Object.fromEntries(Object.entries(branches).map(([member, branch]) => [member, branch.metadata])), guidance: declared.guidance ?? {} } : prepared.schema));

  function select(selection) {
    const invalid = cause => refuse(INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_INVALID, { source: name, path: "/select", cause });
    if (!isObject(selection) || Object.keys(selection).some(key => key !== "members" && key !== "groups" && key !== "branches")) {
      invalid("a selection is { members, groups } with at least one of them");
    }
    const { members = [], groups: selectedGroups = [] } = selection;
    if (!stringList(members) || !stringList(selectedGroups)) invalid("members and groups are lists of names");
    for (const list of [members, selectedGroups]) {
      if (new Set(list).size !== list.length) invalid("a name is selected more than once");
    }
    if (members.length + selectedGroups.length === 0) {
      refuse(INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_EMPTY, { source: name, path: "/select", cause: "nothing is selected" });
    }
    const chosen = new Set();
    for (const group of selectedGroups) {
      if (!groupMembers.has(group)) {
        refuse(INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_GROUP_UNKNOWN, { source: name, path: `/select/groups/${group}`,
          cause: `${group} is not a group of this source; its groups are ${[...groupMembers.keys()].join(", ")}` });
      }
      for (const member of groupMembers.get(group)) chosen.add(member);
    }
    for (const member of members) {
      if (!prepared.memberReferences.has(member)) {
        refuse(INPUT_SCHEMA_EXPOSURE_CODES.SELECTION_MEMBER_UNKNOWN, { source: name, path: `/select/members/${member}`,
          cause: `${member} is not a member of this source` });
      }
      chosen.add(member);
    }
    const selected = prepared.members.filter(member => chosen.has(member));
    let scoped = prepared;
    const scopes = {}, scopedGuidance = new Map();
    if (selection.branches !== undefined) {
      if (!isObject(selection.branches) || !Object.keys(selection.branches).length) invalid("branches names selected members with published capabilities");
      for (const [member, requested] of Object.entries(selection.branches)) {
        if (!selected.includes(member) || !Object.hasOwn(branches, member)) invalid(`no selected capability owner for ${member}`);
        const result = branches[member].select(scoped.schema, requested);
        scoped = prepareSource(name, result.schema);

        if (result.scope !== null) {
          scopes[member] = result.scope;
          scopedGuidance.set(member, result.guidance);
        }
      }
    }
    const definitions = reachableDefinitions(scoped, selected);
    const { schema } = scoped;
    return Object.freeze({ source: name, digest: sourceDigest(), members: Object.freeze(selected),
      ...(Object.keys(scopes).length ? { branches: scopes } : {}),
      schema: Object.freeze({

        ...Object.fromEntries(Object.entries(schema).filter(([keyword]) => !MEMBER_CARRIERS.has(keyword))),
        ...(definitions.length === 0 ? {} : { $defs: Object.freeze(Object.fromEntries(definitions.map(definition =>
          [definition, schema.$defs[definition]]))) }),
        properties: Object.freeze(Object.fromEntries(selected.map(member => [member, schema.properties[member]])))
      }),
      guidance: Object.freeze(selected.filter(member => guidance.has(member)).map(member =>
        Object.freeze({ member, topics: scopedGuidance.has(member) ? scopedGuidance.get(member)(guidance.get(member)) : guidance.get(member) }))) });
  }

  return Object.freeze({ name, members: Object.freeze([...prepared.members]), groups, select, branches: Object.fromEntries(Object.entries(branches).map(([member, branch]) => [member, branch.metadata])),
    get digest() { return sourceDigest(); } });
}

const declarationInvalid = cause => refuse(INPUT_SCHEMA_EXPOSURE_CODES.DECLARATION_INVALID, { path: "/", cause });

export function bindInputSchemaExposure(declaration) {
  if (!isObject(declaration) || typeof declaration.digest !== "function" || !isObject(declaration.sources) ||
      Object.keys(declaration.sources).length === 0) {
    declarationInvalid("an exposure declares a digest function and at least one named source");
  }
  const sources = new Map(Object.entries(declaration.sources).map(([name, declared]) => {
    if (!isObject(declared)) declarationInvalid(`source ${name} is not an object`);
    return [name, boundSource(name, declared, declaration.digest)];
  }));
  return Object.freeze({
    sourceNames: Object.freeze([...sources.keys()]),

    source(name) {
      return sources.get(name) ?? refuse(INPUT_SCHEMA_EXPOSURE_CODES.SOURCE_UNKNOWN, { source: String(name), path: null,
        cause: `this exposure binds ${[...sources.keys()].join(", ")}` });
    }
  });
}

export function sameInputSchemaExposure(left, right) {
  if (left === right) return true;
  if (!isObject(left) || !isObject(right) || left.digest !== right.digest ||
      !isObject(left.sources) || !isObject(right.sources)) return false;
  const names = Object.keys(left.sources);
  return JSON.stringify(names) === JSON.stringify(Object.keys(right.sources)) && names.every(name =>
    left.sources[name]?.schema === right.sources[name]?.schema &&
    JSON.stringify([left.sources[name]?.groups, left.sources[name]?.guidance ?? {}, left.sources[name]?.branches ?? {}]) ===
      JSON.stringify([right.sources[name]?.groups, right.sources[name]?.guidance ?? {}, right.sources[name]?.branches ?? {}]));
}
