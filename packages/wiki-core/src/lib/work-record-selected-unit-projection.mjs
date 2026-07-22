import { types as utilTypes } from "node:util";
import {
  SLICE_ID_PATTERN,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_RECORD_REVIEW_PURPOSE_VALUES
} from "./work-record-schema-constants.mjs";

const MAX_PROJECTED_NODES = 10000;
const MAX_PROJECTED_DEPTH = 64;
const WORK_RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
const INVALID = Symbol("invalid-selected-unit-projection");

function isObject(value) {
  return value !== null && typeof value === "object" && !utilTypes.isProxy(value);
}

function ownDataValue(value, field) {
  if (value !== null && typeof value === "object" && utilTypes.isProxy(value)) {
    return { present: true, value: INVALID };
  }
  if (!isObject(value)) return { present: false, value: undefined };
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.hasOwn(descriptor, "value")) {
    return { present: true, value: INVALID };
  }
  return { present: true, value: descriptor.value };
}

function cloneData(value, state, depth = 0) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return undefined;
  if (!isObject(value) || depth > MAX_PROJECTED_DEPTH) return INVALID;
  if (state.seen.has(value) || state.nodes >= MAX_PROJECTED_NODES) return INVALID;
  state.seen.add(value);
  state.nodes += 1;

  let result;
  if (Array.isArray(value)) {
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return INVALID;
      const cloned = cloneData(descriptor.value, state, depth + 1);
      if (cloned === INVALID) return INVALID;
      result.push(cloned);
    }
  } else {
    result = {};
    for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) return INVALID;
      const cloned = cloneData(descriptor.value, state, depth + 1);
      if (cloned === INVALID) return INVALID;
      if (cloned !== undefined) result[field] = cloned;
    }
  }

  state.seen.delete(value);
  return result;
}

function cloneAuthored(value) {
  return cloneData(value, { seen: new WeakSet(), nodes: 0 });
}

function copyAuthored(projected, source, field, transform = cloneAuthored) {
  const authored = ownDataValue(source, field);
  if (!authored.present) return true;
  if (authored.value === INVALID) return false;
  const value = transform(authored.value);
  if (value === INVALID) return false;
  projected[field] = value;
  return true;
}

function isCanonicalString(value) {
  return typeof value === "string";
}

function copyCanonicalScalar(projected, source, field, predicate) {
  const authored = ownDataValue(source, field);
  if (!authored.present) return true;
  if (authored.value === INVALID || !predicate(authored.value)) return false;
  projected[field] = authored.value;
  return true;
}

function projectStringList(value) {
  if (!isObject(value) || !Array.isArray(value)) return INVALID;
  const projected = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      return INVALID;
    }
    projected.push(descriptor.value);
  }
  return projected;
}

function projectAgentNotes(value) {
  if (typeof value === "string") return value;
  return projectStringList(value);
}

function projectReadScope(value) {
  const refs = [];
  const seen = new Set();
  let authored = false;
  for (const field of ["read_scope", "docs"]) {
    const source = ownDataValue(value, field);
    if (!source.present) continue;
    authored = true;
    const entries = projectStringList(source.value);
    if (entries === INVALID) return INVALID;
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      refs.push(entry);
    }
  }
  return authored ? refs : undefined;
}

function projectAcceptance(value) {
  const source = ownDataValue(value, "acceptance");
  const legacyValidation = ownDataValue(value, "validation");
  if (!source.present && !legacyValidation.present) return undefined;
  if (source.value === INVALID || legacyValidation.value === INVALID) return INVALID;

  const acceptance = {};
  if (source.present) {
    if (!isObject(source.value) || Array.isArray(source.value)) {
      return INVALID;
    }
    const criteria = ownDataValue(source.value, "criteria");
    const validation = ownDataValue(source.value, "validation");
    if (criteria.present) {
      acceptance.criteria = projectStringList(criteria.value);
      if (acceptance.criteria === INVALID) return INVALID;
    }
    if (validation.present) {
      acceptance.validation = projectStringList(validation.value);
      if (acceptance.validation === INVALID) return INVALID;
    }
  }
  if (!Object.hasOwn(acceptance, "validation") && legacyValidation.present) {
    acceptance.validation = projectStringList(legacyValidation.value);
    if (acceptance.validation === INVALID) return INVALID;
  }
  return acceptance;
}

export function projectSelectedWorkRecordUnit(value) {
  if (!isObject(value) || Array.isArray(value)) return null;

  const projected = {};
  if (!copyCanonicalScalar(projected, value, "id", (entry) =>
    isCanonicalString(entry) &&
    (WORK_RECORD_ID_PATTERN.test(entry) || SLICE_ID_PATTERN.test(entry))
  )) return null;
  if (!copyCanonicalScalar(projected, value, "title", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "status", (entry) =>
    WORK_RECORD_STATUS_VALUES.includes(entry)
  )) return null;
  if (!copyCanonicalScalar(projected, value, "priority", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "owner", isCanonicalString)) return null;
  if (!copyCanonicalScalar(projected, value, "work_kind", (entry) =>
    WORK_RECORD_WORK_KIND_VALUES.includes(entry)
  )) return null;
  if (!copyCanonicalScalar(projected, value, "review_purpose", (entry) =>
    WORK_RECORD_REVIEW_PURPOSE_VALUES.includes(entry)
  )) return null;
  if (Object.hasOwn(projected, "review_purpose") && projected.work_kind !== "review") return null;
  if (projected.work_kind === "review" && !Object.hasOwn(projected, "review_purpose")) {
    projected.review_purpose = "standalone";
  }

  const acceptance = projectAcceptance(value);
  if (acceptance === INVALID) return null;
  if (acceptance !== undefined) projected.acceptance = acceptance;

  const topLevelValidation = ownDataValue(value, "validation");
  const acceptanceValidation = acceptance && Object.hasOwn(acceptance, "validation")
    ? acceptance.validation
    : undefined;
  if (topLevelValidation.present || acceptanceValidation !== undefined) {
    const validation = topLevelValidation.present
      ? projectStringList(topLevelValidation.value)
      : cloneAuthored(acceptanceValidation);
    if (validation === INVALID) return null;
    projected.validation = validation;
  }

  const readScope = projectReadScope(value);
  if (readScope === INVALID) return null;
  if (readScope !== undefined) projected.read_scope = readScope;

  for (const field of ["repo_paths", "write_scope", "depends_on"]) {
    if (!copyAuthored(projected, value, field, projectStringList)) return null;
  }
  for (const field of [
    "dispatch_intent",
    "activity_artifact_targets",
    "scenarios",
    "expected_edit_targets",
    "expected",
    "closure"
  ]) {
    if (!copyAuthored(projected, value, field)) return null;
  }
  if (!copyCanonicalScalar(
    projected,
    value,
    "expected_changed_line_budget",
    (entry) => entry === null || (Number.isInteger(entry) && entry >= 0)
  )) return null;

  const sectionsSource = ownDataValue(value, "sections");
  if (sectionsSource.present) {
    if (!isObject(sectionsSource.value) || Array.isArray(sectionsSource.value)) return null;
    const sections = {};
    if (!copyAuthored(sections, sectionsSource.value, "agent_notes", projectAgentNotes)) return null;
    projected.sections = sections;
  }

  const directAgentNotes = ownDataValue(value, "agent_notes");
  const sectionAgentNotes = sectionsSource.present && isObject(sectionsSource.value) &&
      !Array.isArray(sectionsSource.value)
    ? ownDataValue(sectionsSource.value, "agent_notes")
    : { present: false, value: undefined };
  if (directAgentNotes.present || sectionAgentNotes.present) {
    const source = directAgentNotes.present ? directAgentNotes.value : sectionAgentNotes.value;
    const agentNotes = projectAgentNotes(source);
    if (agentNotes === INVALID) return null;
    projected.agent_notes = agentNotes;
  }

  return projected;
}
