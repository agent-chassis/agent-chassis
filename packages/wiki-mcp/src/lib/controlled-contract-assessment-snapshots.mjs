import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  controlledContractPrettyJsonBytes,
  projectControlledContractIntegrationAssessmentPage,
  projectControlledContractProofAssessmentPage
} from "@agent-chassis/wiki-core";
import {
  assessmentCollectionDescriptor,
  createTaskResultSnapshotRegistry
} from "@agent-chassis/controlled-contract";

const TTL_MS = 30 * 60 * 1000;
const CAPACITY = 32;
const MAX_SCALAR_RANGE_BYTES = 8 * 1024;
const QUERY_OPERATIONS = Object.freeze({
  proof: "workspace_controlled_contract_assessment_query",
  integration_test_design: "workspace_controlled_contract_integration_test_design_query"
});
const ASSESS_OPERATIONS = Object.freeze({
  proof: "workspace_controlled_contract_assess",
  integration_test_design: "workspace_controlled_contract_integration_test_design_assess"
});

function unavailable(reason, recovery, details = {}) {
  const error = new Error("controlled-contract assessment snapshot is unavailable");
  error.code = "controlled_contract_assessment_snapshot_unavailable";
  error.details = Object.freeze({
    changed: false,
    reason,
    caller_correctable: true,
    supported_next_call: recovery?.tool ?? recovery ?? null,
    ...details
  });
  return error;
}

function invalid(reason, recovery, details = {}) {
  const error = new Error("controlled-contract assessment continuation is invalid");
  error.code = "controlled_contract_assessment_continuation_invalid";
  error.details = Object.freeze({
    changed: false,
    reason,
    caller_correctable: true,
    supported_next_call: recovery?.tool ?? recovery ?? null,
    ...details
  });
  return error;
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function rowProjection(_family, _collection, row, descriptor) {
  const fields = descriptor?.fields ?? Object.keys(row);
  return Object.freeze({
    schema_version: "controlled-contract-assessment-row-projection.v1",
    stable_id: descriptor === null
      ? row.stable_id ?? row.id ?? null : row[descriptor.stable_id],
    fields: Object.freeze(fields.map((field) => Object.freeze({
      path: Object.freeze([field]),
      value_kind: valueKind(row[field])
    })))
  });
}

function projectPage({ result, domain, collection, selector, ordinal, maximumItems,
  sourceCurrent, changedSourceClasses }) {
  const projector = domain === "proof"
    ? projectControlledContractProofAssessmentPage
    : projectControlledContractIntegrationAssessmentPage;
  return projector({
    assessment: result,
    collection,
    selector,
    ordinal,
    maximumItems,
    sourceCurrent,
    changedSourceClasses
  });
}

function controlledRecovery(family, assessOperation = null) {
  return Object.freeze({
    tool: assessOperation ?? ASSESS_OPERATIONS[family],
    arguments: Object.freeze({})
  });
}

function projectControlledResult(result) {
  const projected = { ...result };
  projected.assessment_identity = projected.task_result_identity;
  delete projected.task_result_identity;
  delete projected.domain;
  delete projected.projection_vocabulary;
  if (projected.continuation?.kind === "scalar_range") {
    projected.next_offset = projected.continuation.next_offset;
  }
  if (!Object.hasOwn(projected, "continuation") ||
      projected.continuation?.kind === "scalar_range") {
    projected.continuation = Object.freeze({
      collection_rows: "typed_collection",
      structured_values: "typed_field_projection",
      scalar_values: "offset_length_total_range"
    });
  }
  return Object.freeze(projected);
}

export function createControlledContractAssessmentSnapshotRegistry({
  now = () => Date.now(),
  random,
  capacity = CAPACITY,
  ttlMs = TTL_MS
} = {}) {
  const registry = createTaskResultSnapshotRegistry({
    now,
    ...(random === undefined ? {} : { random }),
    capacity,
    ttlMs,
    maximumItems: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items,
    maximumBytes: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
    maximumScalarRangeBytes: MAX_SCALAR_RANGE_BYTES,
    collectionDescriptor: assessmentCollectionDescriptor,
    projectPage,
    projectRow: rowProjection,
    measureProjectionBytes: controlledContractPrettyJsonBytes,
    assertProjectionBound: assertControlledContractSemanticProjectionBound,
    queryOperationForDomain: (family) => QUERY_OPERATIONS[family],
    unavailableError: unavailable,
    invalidError: invalid,
    accountingMode: "nested",
    schemaVersions: {
      field: "controlled-contract-assessment-field.v1",
      row: "controlled-contract-assessment-row-projection.v1"
    }
  });

  function put({ family, assessment, sourceIdentity, assessOperation,
    resolve_current_source_identity: resolveCurrentSourceIdentity = null }) {
    return registry.put({
      domain: family,
      result: assessment,
      sourceIdentity,
      recovery: controlledRecovery(family, assessOperation),
      resolveCurrentSourceIdentity
    });
  }

  async function query({ identity, family, collection, selector = null,
    cursor = null, fieldPath = null, offset = null, length = null,
    maximumItems = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items,
    maximumBytes = CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes,
    currentSourceIdentity = null }) {
    const result = await registry.query({
      identity: identity ?? null,
      domain: family ?? null,
      collection: collection ?? null,
      selector,
      cursor,
      fieldPath,
      offset,
      length,
      maximumItems,
      maximumBytes,
      currentSourceIdentity
    });
    return projectControlledResult(result);
  }

  return Object.freeze({ put, query, size: registry.size });
}

export const controlledContractAssessmentSnapshots =
  createControlledContractAssessmentSnapshotRegistry();

export const CONTROLLED_CONTRACT_ASSESSMENT_SNAPSHOT_POLICY = Object.freeze({
  ttl_ms: TTL_MS,
  capacity: CAPACITY,
  identity_bits: 256
});
