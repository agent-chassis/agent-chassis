

import path from "node:path";

import { COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION } from "./commit-object-primitive.mjs";
import { COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION } from "./commit-scope-envelope.mjs";

import { digestTrustedExactReviewEvidence } from "./workspace-agent-dispatch-run-receipt.mjs";

export const WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION =
  "workspace-agent-write-confinement-evidence.v1";
export const WRITE_CONFINEMENT_DELIVERY_INPUT_SCHEMA_VERSION =
  "workspace-agent-write-confinement-delivery.v1";
export const WRITE_CONFINEMENT_RECEIPT_BINDING_SCHEMA_VERSION =
  "workspace-agent-write-confinement-receipt-binding.v1";
export const WRITE_CONFINEMENT_SOURCE_DIGEST_SCHEMA_VERSION =
  "workspace-agent-write-confinement-source.v1";
export const WRITE_CONFINEMENT_RESULT_DIGEST_SCHEMA_VERSION =
  "workspace-agent-write-confinement-result.v1";

const ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION = "envelope-attestation-marker.v1";

export const WRITE_CONFINEMENT_EVIDENCE_AUTHORITY = "authenticated_observation_only";
export const WRITE_CONFINEMENT_EVIDENCE_OBSERVATION_BOUNDARY = "base_to_delivery_tree_delta";

export const WRITE_CONFINEMENT_EVIDENCE_NOT_COVERED = Object.freeze([
  "transient_worktree_state",
  "reverted_intermediate_edits",
  "concurrent_mutation",
  "causal_attribution",
  "prevention",
  "rollback",
  "runtime_mutation"
]);

export const WRITE_CONFINEMENT_EVIDENCE_MAX_CHANGED_PATHS = 10000;
export const WRITE_CONFINEMENT_EVIDENCE_MAX_WRITE_SCOPE_ENTRIES = 1000;

export const WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT: "agent_launch.write_confinement_evidence.missing_required_input.v1",
  MALFORMED_INPUT: "agent_launch.write_confinement_evidence.malformed_input.v1",
  INCOMPLETE_INPUT: "agent_launch.write_confinement_evidence.incomplete_input.v1",
  NON_COMMIT_VALUED: "agent_launch.write_confinement_evidence.non_commit_valued.v1",
  NON_MANAGED_IMPLEMENTATION: "agent_launch.write_confinement_evidence.non_managed_implementation.v1",
  NONTERMINAL_RUN: "agent_launch.write_confinement_evidence.nonterminal_run.v1",
  UNAUTHENTICATED_SOURCE: "agent_launch.write_confinement_evidence.unauthenticated_source.v1",
  POPULATION_BOUND_EXCEEDED: "agent_launch.write_confinement_evidence.population_bound_exceeded.v1",
  SCOPE_POPULATION_INCONSISTENT: "agent_launch.write_confinement_evidence.scope_population_inconsistent.v1",
  CROSS_REPOSITORY: "agent_launch.write_confinement_evidence.cross_repository.v1",
  CROSS_WK: "agent_launch.write_confinement_evidence.cross_wk.v1",
  CROSS_UNIT: "agent_launch.write_confinement_evidence.cross_unit.v1",
  RUN_ATTEMPT_MISMATCH: "agent_launch.write_confinement_evidence.run_attempt_mismatch.v1",
  STALE_IDENTITY: "agent_launch.write_confinement_evidence.stale_identity.v1",
  DIGEST_MISMATCH: "agent_launch.write_confinement_evidence.digest_mismatch.v1"
});

const DELIVERY_REQUIRED_FIELDS = Object.freeze([
  "schema_version", "repository", "run_id", "attempt", "record_id", "unit_address",
  "selected_unit", "role", "work_kind", "managed", "run_status", "write_scope",
  "materialized", "scope"
]);
const RECEIPT_BINDING_REQUIRED_FIELDS = Object.freeze([
  "schema_version", "repository", "run_id", "attempt", "record_id", "unit_address",
  "base_commit", "delivery_commit", "source_digest", "result_digest"
]);
const SELECTED_UNIT_FIELDS = Object.freeze([
  "kind", "address", "record_id", "slice_id", "repo"
]);
const MATERIALIZED_REQUIRED_FIELDS = Object.freeze([
  "schema_version", "tree", "commit", "base_sha"
]);
const SCOPE_REQUIRED_FIELDS = Object.freeze([
  "schema_version", "contained", "changed_paths", "refusal", "attestation"
]);

const TERMINAL_RUN_STATUSES = Object.freeze(new Set(["succeeded", "failed", "cancelled"]));
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const RECORD_ID_RE = /^WK-\d{4}$/u;
const UNIT_ADDRESS_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonZeroOid(value) {
  return typeof value === "string" && OID_RE.test(value) && !/^0+$/u.test(value);
}

function isCanonicalRepoPath(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !path.posix.isAbsolute(value) && !value.includes("\\") &&
    path.posix.normalize(value) === value && value !== "." &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isCanonicalPathArray(value) {
  return Array.isArray(value) && value.every(isCanonicalRepoPath) &&
    value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function refuse(code, reason, detail = null) {
  return Object.freeze({
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    projected: false,
    evidence: null,
    evidence_digest: null,
    state_changed: false,
    authority: WRITE_CONFINEMENT_EVIDENCE_AUTHORITY,
    refusal: Object.freeze({
      code,
      reason,
      detail: detail === null ? null : Object.freeze(structuredClone(detail))
    })
  });
}

function firstMissingField(value, fields) {
  return fields.find((field) => !Object.hasOwn(value, field)) ?? null;
}

function admitInputPresence({ authenticatedDelivery, receiptBinding, observedAt }) {
  for (const [label, value] of [
    ["authenticatedDelivery", authenticatedDelivery],
    ["receiptBinding", receiptBinding],
    ["observedAt", observedAt]
  ]) {
    if (value === undefined || value === null) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MISSING_REQUIRED_INPUT,
        `${label} is required to project write-confinement evidence`,
        { input: label }
      );
    }
  }
  return null;
}

function admitInputShape({ authenticatedDelivery, receiptBinding, observedAt }) {
  if (!isPlainObject(authenticatedDelivery) ||
      authenticatedDelivery.schema_version !== WRITE_CONFINEMENT_DELIVERY_INPUT_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      `authenticatedDelivery must be an object carrying schema_version ${WRITE_CONFINEMENT_DELIVERY_INPUT_SCHEMA_VERSION}`,
      { input: "authenticatedDelivery" }
    );
  }
  if (!isPlainObject(receiptBinding) ||
      receiptBinding.schema_version !== WRITE_CONFINEMENT_RECEIPT_BINDING_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      `receiptBinding must be an object carrying schema_version ${WRITE_CONFINEMENT_RECEIPT_BINDING_SCHEMA_VERSION}`,
      { input: "receiptBinding" }
    );
  }
  const observedInstant = typeof observedAt === "string" && INSTANT_RE.test(observedAt)
    ? new Date(observedAt)
    : null;

  if (observedInstant === null || !Number.isFinite(observedInstant.getTime()) ||
      observedInstant.toISOString() !== observedAt) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      "observedAt must be a launcher-observed UTC instant in strict ISO-8601 milliseconds form",
      { input: "observedAt" }
    );
  }
  return null;
}

function admitCompleteness(delivery, binding) {
  const missingDelivery = firstMissingField(delivery, DELIVERY_REQUIRED_FIELDS);
  if (missingDelivery !== null) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.INCOMPLETE_INPUT,
      `authenticatedDelivery is missing the required field ${missingDelivery}`,
      { input: "authenticatedDelivery", field: missingDelivery }
    );
  }
  const missingBinding = firstMissingField(binding, RECEIPT_BINDING_REQUIRED_FIELDS);
  if (missingBinding !== null) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.INCOMPLETE_INPUT,
      `receiptBinding is missing the required field ${missingBinding}`,
      { input: "receiptBinding", field: missingBinding }
    );
  }
  if (!isPlainObject(delivery.materialized)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      "authenticatedDelivery.materialized must be the commit-object primitive result",
      { input: "authenticatedDelivery.materialized" }
    );
  }
  if (!isPlainObject(delivery.scope)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      "authenticatedDelivery.scope must be the commit-scope envelope result",
      { input: "authenticatedDelivery.scope" }
    );
  }
  const missingMaterialized = firstMissingField(delivery.materialized, MATERIALIZED_REQUIRED_FIELDS);
  if (missingMaterialized !== null) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.INCOMPLETE_INPUT,
      `authenticatedDelivery.materialized is missing the required field ${missingMaterialized}`,
      { input: "authenticatedDelivery.materialized", field: missingMaterialized }
    );
  }
  const missingScope = firstMissingField(delivery.scope, SCOPE_REQUIRED_FIELDS);
  if (missingScope !== null) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.INCOMPLETE_INPUT,
      `authenticatedDelivery.scope is missing the required field ${missingScope}`,
      { input: "authenticatedDelivery.scope", field: missingScope }
    );
  }
  return null;
}

function admitIdentityShape(delivery, binding) {
  const repositoryOk = (value) => typeof value === "string" && value.length > 0 &&
    path.isAbsolute(value) && path.normalize(value) === value;
  for (const [label, source] of [["authenticatedDelivery", delivery], ["receiptBinding", binding]]) {
    if (!repositoryOk(source.repository)) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `${label}.repository must be the canonical absolute normalized repository path`,
        { input: `${label}.repository` }
      );
    }
    if (typeof source.run_id !== "string" || !OPAQUE_ID_RE.test(source.run_id)) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `${label}.run_id must be a canonical opaque run identity`,
        { input: `${label}.run_id` }
      );
    }
    if (!Number.isInteger(source.attempt) || source.attempt < 0) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `${label}.attempt must be a non-negative integer attempt identity`,
        { input: `${label}.attempt` }
      );
    }
    if (typeof source.record_id !== "string" || !RECORD_ID_RE.test(source.record_id)) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `${label}.record_id must be a canonical WK identity`,
        { input: `${label}.record_id` }
      );
    }
    const unitMatch = typeof source.unit_address === "string"
      ? UNIT_ADDRESS_RE.exec(source.unit_address)
      : null;
    if (unitMatch === null || unitMatch[1] !== source.record_id) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `${label}.unit_address must be a canonical WK-#####SLICE-### address agreeing with record_id`,
        { input: `${label}.unit_address` }
      );
    }
  }
  const selected = delivery.selected_unit;
  const sliceId = UNIT_ADDRESS_RE.exec(delivery.unit_address)[2];
  if (!isPlainObject(selected) ||
      Object.keys(selected).length !== SELECTED_UNIT_FIELDS.length ||
      SELECTED_UNIT_FIELDS.some((field) => !Object.hasOwn(selected, field)) ||
      selected.kind !== "slice" || selected.address !== delivery.unit_address ||
      selected.record_id !== delivery.record_id || selected.slice_id !== sliceId ||
      !(selected.repo === null || (typeof selected.repo === "string" && selected.repo.length > 0))) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
      "authenticatedDelivery.selected_unit must be the exact launcher-selected slice for unit_address",
      { input: "authenticatedDelivery.selected_unit" }
    );
  }
  for (const field of ["source_digest", "result_digest"]) {
    const value = binding[field];
    if (value !== null && (typeof value !== "string" || !DIGEST_RE.test(value))) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.MALFORMED_INPUT,
        `receiptBinding.${field} must be null or a canonical sha256 digest`,
        { input: `receiptBinding.${field}` }
      );
    }
  }
  return null;
}

function admitCommitValues(delivery, binding) {
  const commitFields = [
    ["authenticatedDelivery.materialized.base_sha", delivery.materialized.base_sha],
    ["authenticatedDelivery.materialized.commit", delivery.materialized.commit],
    ["authenticatedDelivery.materialized.tree", delivery.materialized.tree],
    ["receiptBinding.base_commit", binding.base_commit],
    ["receiptBinding.delivery_commit", binding.delivery_commit]
  ];
  for (const [label, value] of commitFields) {
    if (!isNonZeroOid(value)) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.NON_COMMIT_VALUED,
        `${label} must be a non-zero 40- or 64-hex object name`,
        { input: label }
      );
    }
  }
  return null;
}

function admitManagedImplementation(delivery) {
  if (delivery.managed !== true || delivery.role !== "worker" ||
      delivery.work_kind !== "implementation") {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.NON_MANAGED_IMPLEMENTATION,
      "write-confinement evidence is projected only for a managed implementation worker delivery",
      { managed: delivery.managed === true, role: delivery.role, work_kind: delivery.work_kind }
    );
  }
  return null;
}

function admitTerminalRun(delivery) {
  if (typeof delivery.run_status !== "string" || !TERMINAL_RUN_STATUSES.has(delivery.run_status)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.NONTERMINAL_RUN,
      "write-confinement evidence is projected only for a terminal run",
      { run_status: typeof delivery.run_status === "string" ? delivery.run_status : null }
    );
  }
  return null;
}

function admitAuthenticity(delivery) {
  const { materialized, scope } = delivery;
  if (materialized.schema_version !== COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.UNAUTHENTICATED_SOURCE,
      `materialized commit object must carry ${COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION}`,
      { schema_version: materialized.schema_version ?? null }
    );
  }
  if (scope.schema_version !== COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.UNAUTHENTICATED_SOURCE,
      `commit-scope result must carry ${COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION}`,
      { schema_version: scope.schema_version ?? null }
    );
  }
  const attestation = scope.attestation;
  if (!isPlainObject(attestation) ||
      attestation.schema_version !== ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.UNAUTHENTICATED_SOURCE,
      `commit-scope result must carry the ${ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION} object marker`,
      { schema_version: attestation?.schema_version ?? null }
    );
  }

  if (attestation.base_sha !== materialized.base_sha ||
      attestation.commit !== materialized.commit ||
      attestation.tree !== materialized.tree) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.UNAUTHENTICATED_SOURCE,
      "the commit-scope attestation marker does not bind the materialized commit object",
      {
        attested: {
          base_sha: attestation.base_sha ?? null,
          commit: attestation.commit ?? null,
          tree: attestation.tree ?? null
        }
      }
    );
  }
  return null;
}

function admitRefusalShape(delivery) {
  const refusal = delivery.scope.refusal;
  if (refusal !== null && !isPlainObject(refusal)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "the authenticated commit-scope refusal must be null or a structured refusal object",
      { refusal: null }
    );
  }
  return null;
}

function admitBounds(delivery, changedPaths, outOfScope) {
  const oversized = [
    ["write_scope", delivery.write_scope, WRITE_CONFINEMENT_EVIDENCE_MAX_WRITE_SCOPE_ENTRIES],
    ["changed_paths", changedPaths, WRITE_CONFINEMENT_EVIDENCE_MAX_CHANGED_PATHS],
    ["out_of_scope", outOfScope, WRITE_CONFINEMENT_EVIDENCE_MAX_CHANGED_PATHS]
  ].find(([, values, bound]) => Array.isArray(values) && values.length > bound);
  if (oversized === undefined) return null;
  const [population, values, bound] = oversized;
  return refuse(
    WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.POPULATION_BOUND_EXCEEDED,
    `${population} exceeds the declared bound of ${bound}; refusing rather than truncating, sampling, or partially succeeding`,
    { population, size: values.length, bound }
  );
}

function admitPopulationConsistency(delivery, changedPaths, outOfScope) {
  const { scope } = delivery;
  if (!isCanonicalPathArray(delivery.write_scope) || delivery.write_scope.length === 0) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "the frozen normalized write scope must be a non-empty, strictly ascending canonical repository-path array",
      { population: "write_scope" }
    );
  }
  if (typeof scope.contained !== "boolean") {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "the authenticated commit-scope result must carry a boolean containment outcome",
      { contained: null }
    );
  }
  if (!isCanonicalPathArray(changedPaths)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "changed_paths must be a strictly ascending canonical repository-path array as emitted by its owner",
      { population: "changed_paths" }
    );
  }

  if (scope.contained === (scope.refusal !== null)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "the authenticated containment outcome disagrees with the presence of a structured refusal",
      { contained: scope.contained, refusal_present: scope.refusal !== null }
    );
  }
  if (!isCanonicalPathArray(outOfScope)) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "refusal.out_of_scope must be a strictly ascending canonical repository-path array as emitted by its owner",
      { population: "out_of_scope" }
    );
  }
  const changedSet = new Set(changedPaths);
  const stray = outOfScope.filter((entry) => !changedSet.has(entry));
  if (stray.length > 0) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
      "refusal.out_of_scope names paths absent from the authoritative changed_paths population",
      { population: "out_of_scope", stray_path_count: stray.length, first_stray_path: stray[0] }
    );
  }

  const metrics = scope.metrics;
  if (isPlainObject(metrics) && metrics.measured === true) {
    const mismatch = [
      ["write_scope", "scope_count", delivery.write_scope.length, metrics.scope_count],
      ["changed_paths", "changed_file_count", changedPaths.length, metrics.changed_file_count]
    ].find(([, , supplied, measured]) => supplied !== measured);
    if (mismatch !== undefined) {
      const [population, metric, supplied, measured] = mismatch;
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.SCOPE_POPULATION_INCONSISTENT,
        `the supplied ${population} population holds ${supplied} entries but the authenticated result measured ${metric} as ${measured}`,
        { population, metric, supplied_length: supplied, measured_count: measured }
      );
    }
  }
  return null;
}

function admitCrossBinding(delivery, binding) {
  if (delivery.repository !== binding.repository) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.CROSS_REPOSITORY,
      "the authenticated delivery and the receipt binding name different canonical repositories",
      { delivery: delivery.repository, receipt: binding.repository }
    );
  }
  if (delivery.record_id !== binding.record_id) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.CROSS_WK,
      "the authenticated delivery and the receipt binding name different WK records",
      { delivery: delivery.record_id, receipt: binding.record_id }
    );
  }
  if (delivery.unit_address !== binding.unit_address) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.CROSS_UNIT,
      "the authenticated delivery and the receipt binding name different units",
      { delivery: delivery.unit_address, receipt: binding.unit_address }
    );
  }
  if (delivery.run_id !== binding.run_id || delivery.attempt !== binding.attempt) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.RUN_ATTEMPT_MISMATCH,
      "the authenticated delivery and the receipt binding name different run/attempt identities",
      {
        delivery: { run_id: delivery.run_id, attempt: delivery.attempt },
        receipt: { run_id: binding.run_id, attempt: binding.attempt }
      }
    );
  }

  if (delivery.materialized.base_sha !== binding.base_commit ||
      delivery.materialized.commit !== binding.delivery_commit) {
    return refuse(
      WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.STALE_IDENTITY,
      "the receipt binding is pinned to a different base/delivery commit pair than the authenticated commit object",
      {
        delivery: {
          base_commit: delivery.materialized.base_sha,
          delivery_commit: delivery.materialized.commit
        },
        receipt: { base_commit: binding.base_commit, delivery_commit: binding.delivery_commit }
      }
    );
  }
  return null;
}

export function writeConfinementSourceDigestBody(delivery) {
  return {
    schema_version: WRITE_CONFINEMENT_SOURCE_DIGEST_SCHEMA_VERSION,
    repository: delivery.repository,
    run_id: delivery.run_id,
    attempt: delivery.attempt,
    record_id: delivery.record_id,
    unit_address: delivery.unit_address,
    selected_unit: structuredClone(delivery.selected_unit),
    frozen_write_scope: [...delivery.write_scope],
    base_commit: delivery.materialized.base_sha,
    delivery_commit: delivery.materialized.commit,
    delivery_tree: delivery.materialized.tree
  };
}

export function writeConfinementResultDigestBody(scope, changedPaths, outOfScope) {
  return {
    schema_version: WRITE_CONFINEMENT_RESULT_DIGEST_SCHEMA_VERSION,
    contained: scope.contained,
    changed_paths: [...changedPaths],
    outside_write_scope_paths: [...outOfScope]
  };
}

export function projectWriteConfinementEvidence({
  authenticatedDelivery,
  receiptBinding,
  observedAt
} = {}) {
  const presence = admitInputPresence({ authenticatedDelivery, receiptBinding, observedAt });
  if (presence !== null) return presence;

  const shape = admitInputShape({ authenticatedDelivery, receiptBinding, observedAt });
  if (shape !== null) return shape;

  const delivery = authenticatedDelivery;
  const binding = receiptBinding;

  const completeness = admitCompleteness(delivery, binding);
  if (completeness !== null) return completeness;

  const identity = admitIdentityShape(delivery, binding);
  if (identity !== null) return identity;

  const commitValues = admitCommitValues(delivery, binding);
  if (commitValues !== null) return commitValues;

  const managed = admitManagedImplementation(delivery);
  if (managed !== null) return managed;

  const terminal = admitTerminalRun(delivery);
  if (terminal !== null) return terminal;

  const authenticity = admitAuthenticity(delivery);
  if (authenticity !== null) return authenticity;

  const refusalShape = admitRefusalShape(delivery);
  if (refusalShape !== null) return refusalShape;

  const changedPaths = delivery.scope.changed_paths;
  const outOfScope = delivery.scope.refusal === null
    ? []
    : delivery.scope.refusal.out_of_scope;

  const bounds = admitBounds(delivery, changedPaths, outOfScope);
  if (bounds !== null) return bounds;

  const consistency = admitPopulationConsistency(delivery, changedPaths, outOfScope);
  if (consistency !== null) return consistency;

  const crossBinding = admitCrossBinding(delivery, binding);
  if (crossBinding !== null) return crossBinding;

  const sourceDigest = digestTrustedExactReviewEvidence(writeConfinementSourceDigestBody(delivery));
  const resultDigest = digestTrustedExactReviewEvidence(
    writeConfinementResultDigestBody(delivery.scope, changedPaths, outOfScope)
  );
  for (const [field, supplied, recomputed] of [
    ["source_digest", binding.source_digest, sourceDigest],
    ["result_digest", binding.result_digest, resultDigest]
  ]) {
    if (supplied !== null && supplied !== recomputed) {
      return refuse(
        WRITE_CONFINEMENT_EVIDENCE_REFUSAL_CODES.DIGEST_MISMATCH,
        `receiptBinding.${field} does not match the digest of the authenticated ${field === "source_digest" ? "source binding" : "result populations"}`,
        { field, supplied, recomputed }
      );
    }
  }

  const outsideSet = new Set(outOfScope);
  const insidePaths = changedPaths.filter((entry) => !outsideSet.has(entry));

  const evidence = Object.freeze({
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    authority: WRITE_CONFINEMENT_EVIDENCE_AUTHORITY,
    observation_boundary: WRITE_CONFINEMENT_EVIDENCE_OBSERVATION_BOUNDARY,
    not_covered: WRITE_CONFINEMENT_EVIDENCE_NOT_COVERED,

    repository: delivery.repository,
    run_id: delivery.run_id,
    attempt: delivery.attempt,
    record_id: delivery.record_id,
    unit_address: delivery.unit_address,
    selected_unit: Object.freeze(structuredClone(delivery.selected_unit)),

    frozen_write_scope: Object.freeze([...delivery.write_scope]),
    base_commit: delivery.materialized.base_sha,
    delivery_commit: delivery.materialized.commit,
    delivery_tree: delivery.materialized.tree,

    contained: delivery.scope.contained,
    changed_paths: Object.freeze([...changedPaths]),
    outside_write_scope_paths: Object.freeze([...outOfScope]),
    inside_write_scope_paths: Object.freeze(insidePaths),
    changed_path_count: changedPaths.length,
    outside_write_scope_path_count: outOfScope.length,
    inside_write_scope_path_count: insidePaths.length,
    populations_complete: true,

    source_digest: sourceDigest,
    result_digest: resultDigest,
    observed_at: observedAt,

    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    closure_effect: "none",
    proof_pack_applicability: "none",
    cce_effect: "none",
    semantic_judgment: "not_performed_coordinator_owned"
  });

  return Object.freeze({
    schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    projected: true,
    evidence,
    evidence_digest: digestTrustedExactReviewEvidence(evidence),
    state_changed: false,
    authority: WRITE_CONFINEMENT_EVIDENCE_AUTHORITY,
    refusal: null
  });
}
