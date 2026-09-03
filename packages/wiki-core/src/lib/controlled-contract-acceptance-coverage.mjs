import { createHash } from "node:crypto";

import {
  compareCriterionIdentitySets,
  deriveCriterionIdentitySet
} from "../../../controlled-contract/lib/acceptance-coverage-identity.mjs";
import {
  ACCEPTANCE_COVERAGE_STATES,
  evaluateAcceptanceCoverage
} from "../../../controlled-contract/lib/acceptance-coverage.mjs";
import {
  ACCEPTANCE_COVERAGE_AXES,
  projectAcceptanceCoverage
} from "../../../controlled-contract/lib/acceptance-coverage-projection.mjs";

const CURSOR_VERSION = "wiki-core-acceptance-coverage-cursor.v1";
const MAX_NEXT_CALL_BYTES = 4096;
const MAX_QUERY_BYTES = 4096;
const ABSENT_SCOPE = Object.freeze({
  status: "absent",
  source: "WK-2025",
  facts: null
});

class ControlledContractAcceptanceCoverageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ControlledContractAcceptanceCoverageError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ControlledContractAcceptanceCoverageError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closed(value, keys, name) {
  if (!isObject(value)) fail("acceptance_coverage_request_invalid", `${name} must be an object`);
  const unsupported = Object.keys(value).filter((key) => !keys.includes(key));
  if (unsupported.length) fail("acceptance_coverage_field_forbidden",
    `${name} contains unsupported fields`, { name, fields: unsupported.sort() });
}

function string(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail("acceptance_coverage_request_invalid", `${name} must be a non-empty string`, { name });
  }
  return value;
}

function unitIdentity(unit) {
  closed(unit, ["id", "kind", "digest"], "unit");
  return Object.freeze({
    id: string(unit.id, "unit.id"),
    kind: string(unit.kind, "unit.kind"),
    digest: string(unit.digest, "unit.digest")
  });
}

function unitDigest(unit) {
  return unit.digest ?? `sha256:${createHash("sha256").update(
    JSON.stringify({ id: unit.id, kind: unit.kind }), "utf8"
  ).digest("hex")}`;
}

function scopeFacts(value) {
  if (value === undefined || value === null) return ABSENT_SCOPE;
  closed(value, ["status", "source", "facts"], "scopeFacts");
  if (!["available", "absent", "stale"].includes(value.status)) {
    fail("acceptance_coverage_scope_facts_invalid", "scopeFacts.status is unsupported");
  }
  if (value.status === "available" && !isObject(value.facts)) {
    fail("acceptance_coverage_scope_facts_invalid", "available scope facts must be an object");
  }
  return Object.freeze({
    status: value.status,
    source: value.source === undefined ? "WK-2025" : string(value.source, "scopeFacts.source"),
    facts: value.status === "absent" ? null : structuredClone(value.facts ?? null)
  });
}

function losslessFacts(value, allowed, name) {
  if (value === undefined || value === null) return null;
  closed(value, allowed, name);
  return structuredClone(value);
}

function proofCoverage(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) fail("acceptance_coverage_proof_facts_invalid",
    "proofCoverage must be an array");
  return Object.freeze(value.map((entry, index) => {
    closed(entry, [
      "criterionIdentity", "nodeId", "state", "intent", "pack", "reason",
      "coveredIntent", "coveredPack", "partial", "attribution"
    ], `proofCoverage[${index}]`);
    if (typeof entry.state !== "string" || entry.state.length === 0) {
      fail("acceptance_coverage_proof_facts_invalid",
        `proofCoverage[${index}].state must be a non-empty string`);
    }
    return Object.freeze(structuredClone(entry));
  }));
}

function resultFacts(value) {
  return losslessFacts(value, [
    "resultPopulation", "forbiddenPopulation", "operation", "result", "schema",
    "memberPopulation", "shapePopulation", "attribution"
  ], "resultFacts");
}

function packageInputs(input) {
  closed(input, [
    "unit", "criteria", "bindings", "priorCriterionIdentities", "mappings",
    "contractNodes", "selectedPackNodeIds", "criterionAxes", "scopeFacts",
    "proofCoverage", "resultFacts"
  ], "input");
  const unit = unitIdentity(input.unit);
  if (!Array.isArray(input.criteria)) fail("acceptance_coverage_request_invalid", "criteria must be an array");
  if (!isObject(input.bindings)) fail("acceptance_coverage_request_invalid", "bindings must be an object");
  if (!Array.isArray(input.mappings)) fail("acceptance_coverage_request_invalid", "mappings must be an array");
  if (!Array.isArray(input.contractNodes)) fail("acceptance_coverage_request_invalid", "contractNodes must be an array");
  if (!Array.isArray(input.selectedPackNodeIds)) fail("acceptance_coverage_request_invalid", "selectedPackNodeIds must be an array");
  if (!Array.isArray(input.criterionAxes)) fail("acceptance_coverage_request_invalid", "criterionAxes must be an array");
  const bindings = structuredClone(input.bindings);
  const identitiesInput = {
    criteria: structuredClone(input.criteria),
    selectedUnitDigest: unitDigest(unit),
    bindings
  };
  const criterionIdentities = deriveCriterionIdentitySet(identitiesInput);
  const prior = input.priorCriterionIdentities === undefined
    ? undefined : structuredClone(input.priorCriterionIdentities);
  const evaluation = evaluateAcceptanceCoverage({
    criteria: criterionIdentities,
    ...(prior === undefined ? {} : { priorCriterionIdentities: prior }),
    mappings: structuredClone(input.mappings),
    contractNodes: structuredClone(input.contractNodes),
    selectedPackNodeIds: structuredClone(input.selectedPackNodeIds)
  });
  const projection = projectAcceptanceCoverage({
    criterionIdentities,
    evaluation,
    criterionAxes: structuredClone(input.criterionAxes)
  });
  return Object.freeze({
    unit,
    unit_digest: unitDigest(unit),
    criterion_identities: criterionIdentities,
    evaluation,
    projection,
    scope_facts: scopeFacts(input.scopeFacts),
    proof_coverage: proofCoverage(input.proofCoverage),
    result_facts: resultFacts(input.resultFacts)
  });
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("acceptance_coverage_cursor_invalid", "cursor must be a non-empty string");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    closed(decoded, ["version", "unit_digest", "projection_cursor"], "cursor");
    if (decoded.version !== CURSOR_VERSION || typeof decoded.unit_digest !== "string" ||
        typeof decoded.projection_cursor !== "string") throw new Error("cursor identity is invalid");
    return decoded;
  } catch (error) {
    fail("acceptance_coverage_cursor_invalid", "cursor is malformed", { cause: error.message });
  }
}

function queryInput(input) {
  closed(input, ["unit", "criterionIdentity", "nodeId", "cursor"], "query");
  const unit = string(input.unit, "query.unit");
  const selectors = ["criterionIdentity", "nodeId"].filter((key) => input[key] !== undefined);
  if (selectors.length > 1) fail("acceptance_coverage_selector_invalid", "query has multiple selectors");
  return { unit, selector: selectors.length ? { [selectors[0]]: string(input[selectors[0]], `query.${selectors[0]}`) } : undefined,
    cursor: input.cursor === undefined ? undefined : decodeCursor(input.cursor) };
}

function boundedQuery(value) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (error) {
    fail("acceptance_coverage_query_invalid", "query must be bounded JSON data",
      { cause: error.message });
  }
  if (bytes > MAX_QUERY_BYTES) {
    fail("acceptance_coverage_query_oversize", "query exceeds its byte bound",
      { maximum_bytes: MAX_QUERY_BYTES, byte_length: bytes });
  }
}

function nextCall(unit, projection) {
  if (!projection.page.continuation) return null;
  const call = {
    tool: "queryControlledContractAcceptanceCoverage",
    arguments: {
      unit: unit.id,
      cursor: encodeCursor({
        version: CURSOR_VERSION,
        unit_digest: unit.digest,
        projection_cursor: projection.page.continuation
      })
    }
  };
  if (Buffer.byteLength(JSON.stringify(call), "utf8") > MAX_NEXT_CALL_BYTES) {
    fail("acceptance_coverage_next_call_oversize", "acceptance coverage next call exceeds its bound");
  }
  return Object.freeze(call);
}

function projectWithQuery(state, query) {
  if (query.unit !== state.unit.id) {
    fail("acceptance_coverage_unit_mismatch", "query addresses a different selected unit");
  }
  let cursor;
  if (query.cursor) {
    if (query.cursor.unit_digest !== state.unit_digest) {
      fail("acceptance_coverage_cursor_stale", "cursor belongs to a different selected unit");
    }
    cursor = query.cursor.projection_cursor;
  }
  return projectAcceptanceCoverage({
    criterionIdentities: state.criterion_identities,
    evaluation: state.evaluation,
    criterionAxes: state.criterion_axes,
    ...(query.selector === undefined ? {} : { selector: query.selector }),
    ...(cursor === undefined ? {} : { cursor })
  });
}

function deriveControlledContractAcceptanceCoverage(input) {
  const state = packageInputs(input);

  return Object.freeze({
    ...state,
    criterion_axes: structuredClone(input.criterionAxes),
    next_calls: Object.freeze([])
  });
}

function queryControlledContractAcceptanceCoverage(input) {
  closed(input, ["state", "query"], "queryControlledContractAcceptanceCoverage");
  boundedQuery(input);
  if (!isObject(input.state)) fail("acceptance_coverage_state_invalid", "state must be an adapted coverage state");
  const addressed = queryInput(input.query);
  const projection = projectWithQuery(input.state, addressed);
  const next = nextCall(input.state.unit, projection);
  return Object.freeze({
    ...projection,
    next_calls: Object.freeze(next ? [next] : [])
  });
}

function compareControlledContractAcceptanceCoverage(input) {
  closed(input, ["prior", "current"], "comparison");
  return compareCriterionIdentitySets(input.prior, input.current);
}

export {
  ACCEPTANCE_COVERAGE_STATES,
  ACCEPTANCE_COVERAGE_AXES,
  ABSENT_SCOPE,
  ControlledContractAcceptanceCoverageError,
  compareControlledContractAcceptanceCoverage,
  compareCriterionIdentitySets,
  deriveCriterionIdentitySet,
  deriveControlledContractAcceptanceCoverage,
  evaluateAcceptanceCoverage,
  projectAcceptanceCoverage,
  queryControlledContractAcceptanceCoverage
};
