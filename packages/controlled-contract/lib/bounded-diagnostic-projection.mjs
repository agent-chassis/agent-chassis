import { createHash } from "node:crypto";

import { canonicalJsonBytes } from "./deterministic-projection-primitives.mjs";

const DIAGNOSTIC_PROJECTION_VERSION =
  "controlled-contract.bounded-diagnostic-projection.v1";
const MAX_DIAGNOSTIC_COUNT = 64;
const MAX_PROJECTION_BYTES = 65536;
const MAX_DIAGNOSTIC_FIELD_BYTES = 4096;

const text = (value) => value === undefined || value === null ? "" : String(value);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function encodedStringBytes(value) {
  return Buffer.byteLength(JSON.stringify(text(value)), "utf8");
}

function boundedTextProjection(value) {
  const source = text(value);
  if (encodedStringBytes(source) <= MAX_DIAGNOSTIC_FIELD_BYTES) return {
    value: source,
    truncated: false
  };
  const marker = "…";
  const contentBudget = MAX_DIAGNOSTIC_FIELD_BYTES - 2 -
    Buffer.byteLength(marker, "utf8");
  const selected = [];
  let used = 0;
  for (const character of source) {
    const encodedBytes = encodedStringBytes(character) - 2;
    if (used > contentBudget - encodedBytes) break;
    selected.push(character);
    used += encodedBytes;
  }
  return {
    value: `${selected.join("")}${marker}`,
    truncated: true
  };
}

const boundedText = (value) => boundedTextProjection(value).value;

function boundedIdentity(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return boundedText(value);
  return boundedText(JSON.stringify(value));
}

function boundedClaimIdentity(value) {
  if (value === undefined || value === null) return null;
  const source = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  if (encodedStringBytes(source) <= MAX_DIAGNOSTIC_FIELD_BYTES) return source;

  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  const suffix = `-sha256-${digest}`;
  const contentBudget = MAX_DIAGNOSTIC_FIELD_BYTES - 2 -
    Buffer.byteLength(suffix, "utf8");
  const selected = [];
  let used = 0;
  for (const character of source) {
    const encodedBytes = encodedStringBytes(character) - 2;
    if (used > contentBudget - encodedBytes) break;
    selected.push(character);
    used += encodedBytes;
  }
  const prefix = selected.join("").replace(/-+$/u, "");
  return `${prefix}${suffix}`;
}

function diagnosticFieldText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

function normalizeDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new TypeError("each diagnostic must be an object");
  }
  if (diagnostic.reasons !== undefined && !Array.isArray(diagnostic.reasons)) {
    throw new TypeError("diagnostic reasons must be an array");
  }
  const rawFields = [diagnostic.code || diagnostic.reason_code ||
    "stable_validation_error", diagnostic.pointer || diagnostic.instancePath || "/",
  diagnostic.claim_id, diagnostic.keyword, diagnostic.reason_code, diagnostic.reason, diagnostic.message,
  diagnostic.expected_identity ?? diagnostic.expected ?? null,
  diagnostic.actual_identity ?? diagnostic.actual ?? null];
  const singularReason = boundedTextProjection(diagnostic.reason);
  const reasonCandidates = (diagnostic.reasons ?? []).map((reason) =>
    boundedTextProjection(diagnosticFieldText(reason))
  ).sort((left, right) =>
    compare(left.value, right.value) || Number(left.truncated) - Number(right.truncated)
  );
  return Object.freeze({
    diagnostic: Object.freeze({
      code: boundedText(diagnostic.code || diagnostic.reason_code ||
        "stable_validation_error"),
      pointer: boundedText(diagnostic.pointer || diagnostic.instancePath || "/") || "/",
      claim_id: boundedClaimIdentity(diagnostic.claim_id),
      keyword: boundedText(diagnostic.keyword),
      reason_code: boundedText(diagnostic.reason_code),
      reason: singularReason.value,
      reason_truncated: singularReason.truncated,
      expected_identity: boundedIdentity(
        diagnostic.expected_identity ?? diagnostic.expected ?? null
      ),
      actual_identity: boundedIdentity(
        diagnostic.actual_identity ?? diagnostic.actual ?? null
      ),
      message: boundedText(diagnostic.message),
      base_content_truncated: rawFields.some((value) =>
        encodedStringBytes(diagnosticFieldText(value)) > MAX_DIAGNOSTIC_FIELD_BYTES)
    }),
    reason_candidates: Object.freeze(reasonCandidates.map((entry) => Object.freeze(entry)))
  });
}

function compareDiagnostics(left, right) {
  const leftDiagnostic = left.diagnostic ?? left;
  const rightDiagnostic = right.diagnostic ?? right;
  for (const field of [
    "pointer", "claim_id", "keyword", "reason_code", "reason", "expected_identity",
    "actual_identity", "code", "message"
  ]) {
    const order = compare(text(leftDiagnostic[field]), text(rightDiagnostic[field]));
    if (order !== 0) return order;
  }
  const leftReasons = left.reason_candidates?.map(({ value }) => value) ??
    leftDiagnostic.reasons ?? [];
  const rightReasons = right.reason_candidates?.map(({ value }) => value) ??
    rightDiagnostic.reasons ?? [];
  return compare(JSON.stringify(leftReasons), JSON.stringify(rightReasons));
}

function materializeDiagnostic(normalized, returnedReasonCount) {
  const { diagnostic, reason_candidates: reasonCandidates } = normalized;
  const selectedReasons = reasonCandidates.slice(0, returnedReasonCount);
  const omittedReasonCount = reasonCandidates.length - selectedReasons.length;
  const reasonsTruncated = omittedReasonCount > 0 || selectedReasons.some(
    ({ truncated }) => truncated
  );
  return Object.freeze({
    code: diagnostic.code,
    pointer: diagnostic.pointer,
    claim_id: diagnostic.claim_id,
    keyword: diagnostic.keyword,
    reason_code: diagnostic.reason_code,
    reason: diagnostic.reason,
    reason_truncated: diagnostic.reason_truncated,
    reasons: Object.freeze(selectedReasons.map(({ value }) => value)),
    total_reason_count: reasonCandidates.length,
    returned_reason_count: selectedReasons.length,
    omitted_reason_count: omittedReasonCount,
    reasons_truncated: reasonsTruncated,
    expected_identity: diagnostic.expected_identity,
    actual_identity: diagnostic.actual_identity,
    message: diagnostic.message,
    content_truncated: diagnostic.base_content_truncated || reasonsTruncated
  });
}

function projectionEnvelope(states, totalCount) {
  const projected = states.map(({ normalized, returnedReasonCount }) =>
    materializeDiagnostic(normalized, returnedReasonCount));
  return {
    diagnostic_projection_version: DIAGNOSTIC_PROJECTION_VERSION,
    total_count: totalCount,
    returned_count: projected.length,
    omitted_count: totalCount - projected.length,
    truncated: projected.length < totalCount ||
      projected.some(({ content_truncated: truncated }) => truncated),
    diagnostics: projected
  };
}

const CAUSAL_ONE_OF = "oneOf";
const CAUSAL_DISCRIMINATOR_KEYWORDS = new Set(["const", "enum"]);

const pointerWithin = (container, pointer) =>
  pointer === container || pointer.startsWith(`${container}/`);

function causalIdentity(row) {
  return canonicalJsonBytes({
    instance_path: row.instancePath,
    schema_path: row.schemaPath,
    keyword: row.keyword,
    message: row.message,
    params: row.params
  }).toString("utf8");
}

function normalizeRawSchemaError(error) {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    throw new TypeError("each raw schema error must be an object");
  }
  return {
    source: error,
    instancePath: text(error.instancePath),
    schemaPath: text(error.schemaPath),
    keyword: text(error.keyword),
    message: text(error.message),
    params: error.params ?? null
  };
}

function normalizeBranchFamily(family) {
  if (!family || typeof family !== "object" || Array.isArray(family)) {
    throw new TypeError("each declared branch family must be an object");
  }
  return {
    pointer: text(family.pointer),
    keyword: text(family.keyword),
    branchCount: family.branch_count
  };
}

function resolveBranchCount(declared, pointer) {
  const matches = declared.filter((family) =>
    family.keyword === CAUSAL_ONE_OF && family.pointer === pointer);
  if (matches.length !== 1) return null;
  const [{ branchCount }] = matches;
  return Number.isInteger(branchCount) && branchCount >= 2 ? branchCount : null;
}

function branchIndexUnder(familySchemaPath, branchCount, schemaPath) {
  for (let index = 0; index < branchCount; index += 1) {
    const prefix = `${familySchemaPath}/${index}`;
    if (schemaPath === prefix || schemaPath.startsWith(`${prefix}/`)) return index;
  }
  return null;
}

const familyDepth = ({ row }) => [row.instancePath.length, row.schemaPath.length];

function attributeBranchMembers(rows, families) {
  const membership = new Map();
  const ambiguous = new Set();
  for (const row of rows) {
    const candidates = [];
    for (const family of families) {
      if (family.row === row) continue;
      if (!pointerWithin(family.row.instancePath, row.instancePath)) continue;
      const branch = branchIndexUnder(
        family.row.schemaPath, family.branchCount, row.schemaPath
      );
      if (branch !== null) candidates.push({ family, branch });
    }
    if (candidates.length === 0) continue;
    const deepest = candidates.reduce((best, candidate) => {
      const [instanceDepth, schemaDepth] = familyDepth(candidate.family);
      const [bestInstance, bestSchema] = familyDepth(best.family);
      return instanceDepth > bestInstance ||
        instanceDepth === bestInstance && schemaDepth > bestSchema ? candidate : best;
    });
    const [deepestInstance, deepestSchema] = familyDepth(deepest.family);
    const tied = candidates.filter((candidate) => {
      const [instanceDepth, schemaDepth] = familyDepth(candidate.family);
      return instanceDepth === deepestInstance && schemaDepth === deepestSchema;
    });

    if (tied.length > 1) for (const { family } of tied) ambiguous.add(family);
    else membership.set(row, deepest);
  }
  return { membership, ambiguous };
}

function proveBranchSelection(family, members) {
  const mismatchedByPointer = new Map();
  for (const { row, branch } of members) {
    if (!CAUSAL_DISCRIMINATOR_KEYWORDS.has(row.keyword)) continue;
    const branches = mismatchedByPointer.get(row.instancePath) ?? new Set();
    branches.add(branch);
    mismatchedByPointer.set(row.instancePath, branches);
  }
  let selected = null;
  for (const branches of mismatchedByPointer.values()) {
    if (branches.size !== family.branchCount - 1) continue;
    const standing = [];
    for (let index = 0; index < family.branchCount; index += 1) {
      if (!branches.has(index)) standing.push(index);
    }
    if (standing.length !== 1) continue;
    if (selected === null) selected = standing[0];
    else if (selected !== standing[0]) return null;
  }
  return selected;
}

function eliminatedRows(families, membersByFamily, selections) {
  const eliminated = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const family of families) {
      const dead = eliminated.has(family.row);
      const selected = selections.get(family);
      if (!dead && selected === undefined) continue;
      for (const { row, branch } of membersByFamily.get(family)) {
        if (!dead && branch === selected) continue;
        if (eliminated.has(row)) continue;
        eliminated.add(row);
        changed = true;
      }
    }
  }
  return eliminated;
}

function selectCausalSchemaDiagnostics({ errors, branch_families: branchFamilies } = {}) {
  if (!Array.isArray(errors)) throw new TypeError("errors must be an array");
  if (!Array.isArray(branchFamilies)) {
    throw new TypeError("branch_families must be an array");
  }
  const rows = errors.map(normalizeRawSchemaError);
  const declared = branchFamilies.map(normalizeBranchFamily);
  const families = [];
  for (const row of rows) {
    if (row.keyword !== CAUSAL_ONE_OF) continue;
    const branchCount = resolveBranchCount(declared, row.instancePath);
    if (branchCount !== null) families.push({ row, branchCount });
  }
  if (families.length === 0) return rows.map(({ source }) => source);

  const { membership, ambiguous } = attributeBranchMembers(rows, families);
  const membersByFamily = new Map(families.map((family) => [family, []]));
  for (const [row, { family, branch }] of membership) {
    membersByFamily.get(family).push({ row, branch });
  }
  const selections = new Map();
  for (const family of families) {
    if (ambiguous.has(family)) continue;
    const selected = proveBranchSelection(family, membersByFamily.get(family));
    if (selected !== null) selections.set(family, selected);
  }
  const eliminated = eliminatedRows(families, membersByFamily, selections);
  const resolvedFamilies = [...selections.keys()].filter(
    (family) => !eliminated.has(family.row)
  );
  const resolvedFamilyRows = new Set(resolvedFamilies.map(({ row }) => row));
  const provenScopes = resolvedFamilies.map(({ row }) => row.instancePath);

  const seen = new Set();
  const selected = [];
  for (const row of rows) {
    if (eliminated.has(row) || resolvedFamilyRows.has(row)) continue;
    if (!provenScopes.some((pointer) => pointerWithin(pointer, row.instancePath))) {
      selected.push(row);
      continue;
    }
    const identity = causalIdentity(row);
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(row);
  }
  return selected.map(({ source }) => source);
}

function projectBoundedDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) throw new TypeError("diagnostics must be an array");
  const sorted = diagnostics.map(normalizeDiagnostic).sort(compareDiagnostics);
  const states = [];
  for (const normalized of sorted.slice(0, MAX_DIAGNOSTIC_COUNT)) {
    const state = {
      normalized,
      returnedReasonCount: Math.min(1, normalized.reason_candidates.length)
    };
    const candidate = [...states, state];
    if (canonicalJsonBytes(projectionEnvelope(candidate, sorted.length)).byteLength >
        MAX_PROJECTION_BYTES) {
      if (states.length === 0) throw new RangeError(
        "bounded diagnostic projection cannot retain its mandatory cause"
      );
      break;
    }
    states.push(state);
  }

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    let lower = state.returnedReasonCount;
    let upper = state.normalized.reason_candidates.length;
    while (lower < upper) {
      const candidateCount = Math.ceil((lower + upper) / 2);
      const candidateStates = states.map((entry, candidateIndex) =>
        candidateIndex === index
          ? { ...entry, returnedReasonCount: candidateCount }
          : entry);
      if (canonicalJsonBytes(projectionEnvelope(candidateStates, sorted.length)).byteLength <=
          MAX_PROJECTION_BYTES) lower = candidateCount;
      else upper = candidateCount - 1;
    }
    state.returnedReasonCount = lower;
  }

  const envelope = projectionEnvelope(states, sorted.length);
  return Object.freeze({
    ...envelope,
    diagnostics: Object.freeze(envelope.diagnostics)
  });
}

export {
  DIAGNOSTIC_PROJECTION_VERSION,
  MAX_DIAGNOSTIC_COUNT,
  MAX_DIAGNOSTIC_FIELD_BYTES,
  MAX_PROJECTION_BYTES,
  compareDiagnostics,
  projectBoundedDiagnostics,
  selectCausalSchemaDiagnostics
};
