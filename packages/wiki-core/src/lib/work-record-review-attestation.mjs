

import {
  classifyNonNegativeInteger,
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
} from "./work-record-admission-shared.mjs";
import {
  normalizeControlledValue,
  normalizeProvenance,
  selectArrayCandidate
} from "./work-record-feature-vector-normalize.mjs";
import { normalizeEscalations } from "./work-record-feature-vector-facets.mjs";
import { normalizeScenarios } from "./work-record-feature-vector.mjs";
import { WORK_UNIT_VERIFICATION_METHOD_VALUES } from "./work-record-feature-vector-vocabulary.mjs";
import { SHA256_PATTERN } from "./work-record-schema-constants.mjs";

export const REVIEW_ATTESTATION_SCHEMA_VERSION = "review-attestation.v1";

export const REVIEW_ATTESTATION_AUTHORITY = "portfolio_local_reference";
export const REVIEW_ATTESTATION_REVIEWER_ROLE_CLASS_VALUES = Object.freeze(["reviewer", "redteam"]);
export const REVIEW_ATTESTATION_CONTROL_ID_VALUES = Object.freeze([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);
const REVIEW_ATTESTATION_CONTROL_ID_SET = new Set(REVIEW_ATTESTATION_CONTROL_ID_VALUES);

export const REVIEW_ATTESTATION_DISPOSITION_VALUES = Object.freeze(["accepted_no_findings", "accepted_with_nonblocking_findings"]);

export const REVIEW_ATTESTATION_REVIEW_OUTCOME_VALUES = Object.freeze([
  "no_findings",
  "passed_no_blocking_or_medium_findings"
]);
const REVIEW_OUTCOME_TO_DISPOSITION = Object.freeze({
  no_findings: "accepted_no_findings",
  passed_no_blocking_or_medium_findings: "accepted_with_nonblocking_findings"
});

export function canonicalizeReviewOutcome(value) {
  const outcome = normalizeStringEntry(value);
  if (!outcome) return null;
  if (Object.prototype.hasOwnProperty.call(REVIEW_OUTCOME_TO_DISPOSITION, outcome)) {
    return REVIEW_OUTCOME_TO_DISPOSITION[outcome];
  }
  return REVIEW_ATTESTATION_DISPOSITION_VALUES.includes(outcome) ? outcome : null;
}

export const REVIEW_ATTESTATION_TRUSTED_PROVENANCE_KIND = "structured_dispatch_run";

export const REVIEW_ATTESTATION_TERMINAL_SUCCESS_STATUS_VALUES = Object.freeze(["succeeded", "completed"]);

export const REVIEW_ATTESTATION_DECISION_CODES = Object.freeze({
  valid: "review_attestation.valid.v1",
  missing: "review_attestation.missing.v1",
  malformed: "review_attestation.malformed.v1",
  wrongUnit: "review_attestation.wrong_unit.v1",
  wrongDigest: "review_attestation.wrong_digest.v1",
  wrongRole: "review_attestation.wrong_role.v1",
  wrongControl: "review_attestation.wrong_control.v1",
  nonTerminal: "review_attestation.non_terminal.v1",
  selfAuthored: "review_attestation.self_authored.v1",
  untrustedProvenance: "review_attestation.untrusted_provenance.v1",
  blockingFindings: "review_attestation.blocking_findings.v1",
  missingTrustedReviewResultApi: "review_attestation.missing_trusted_review_result_api.v1",
  expired: "review_attestation.expired.v1",
  digestMismatch: "review_attestation.digest_mismatch.v1",
  missingExpectation: "review_attestation.missing_expectation.v1"
});
const CODES = REVIEW_ATTESTATION_DECISION_CODES;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function isSha256(value) {
  return isNonEmptyString(value) && SHA256_PATTERN.test(value.trim());
}
function isoTimestampMs(value) {
  if (!isNonEmptyString(value) || !ISO_TIMESTAMP_PATTERN.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
}

function isReviewedControlId(value) {
  const normalized = normalizeStringEntry(value);
  return Boolean(normalized && REVIEW_ATTESTATION_CONTROL_ID_SET.has(normalized));
}
function normalizeControlIds(values) {
  if (!Array.isArray(values)) return null;
  const controls = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeStringEntry(value);
    if (!normalized || !isReviewedControlId(normalized) || seen.has(normalized)) return null;
    seen.add(normalized);
    controls.push(normalized);
  }
  return controls.length > 0 ? controls.sort((left, right) => left.localeCompare(right)) : null;
}
function normalizeUnit(value) {
  if (!isObject(value)) return null;
  const address = normalizeStringEntry(value.address);
  const recordId = normalizeStringEntry(value.record_id);
  if (!address || !recordId) return null;
  return { record_id: recordId, slice_id: normalizeStringEntry(value.slice_id), address };
}
function normalizeReviewedSliceId(value) {
  if (!isObject(value)) return null;
  return normalizeStringEntry(value.id) ?? normalizeStringEntry(value.slice_id);
}

function normalizeReviewRunRef(value) {
  if (!isObject(value)) return null;
  const ref = {
    run_id: normalizeStringEntry(value.run_id),
    role_class: normalizeStringEntry(value.role_class),
    terminal_status: normalizeStringEntry(value.terminal_status),
    subject_address: normalizeStringEntry(value.subject_address),
    provenance_kind: normalizeStringEntry(value.provenance_kind)
  };
  return Object.values(ref).every(isNonEmptyString) ? ref : null;
}

function attestationReviewUnit(value) {
  if (value === undefined || value === null) return null;
  return normalizeUnit(value);
}
function resolveReviewedUnitDigestContext(source) {
  if (!isObject(source)) return null;

  const record =
    isObject(source.record) ? source.record :
    isObject(source.selected_record) ? source.selected_record :
    isObject(source.selectedRecord) ? source.selectedRecord :
    source;

  let unit =
    isObject(source.reviewed_unit) ? source.reviewed_unit :
    isObject(source.reviewedUnit) ? source.reviewedUnit :
    isObject(source.selected_unit) ? source.selected_unit :
    isObject(source.selectedUnit) ? source.selectedUnit :
    isObject(source.selected_slice) ? source.selected_slice :
    isObject(source.selectedSlice) ? source.selectedSlice :
    isObject(source.unit) ? source.unit :
    null;

  const selectedSliceId =
    normalizeStringEntry(source.slice_id) ??
    normalizeStringEntry(source.selected_slice_id) ??
    normalizeStringEntry(source.selectedSliceId);

  if (!unit && selectedSliceId) {
    const sliceCollections = [];
    if (Array.isArray(source.slices)) sliceCollections.push(source.slices);
    if (Array.isArray(record?.slices) && record.slices !== source.slices) {
      sliceCollections.push(record.slices);
    }

    for (const slices of sliceCollections) {
      unit = slices.find((slice) => {
        const candidateSliceId = normalizeReviewedSliceId(slice);
        return candidateSliceId === selectedSliceId;
      }) ?? null;

      if (unit) break;
    }
  }

  if (!unit && !selectedSliceId) {
    unit = source;
  }

  if (!unit) {
    return null;
  }

  return { record, unit };
}
function normalizeReviewedSectionScope(value) {
  if (!isObject(value)) return null;
  const scope = {};
  const items = normalizeStringEntryArray(value.items);
  const outOfScope = normalizeStringEntryArray(value.out_of_scope);
  if (items.length > 0) scope.items = items;
  if (outOfScope.length > 0) scope.out_of_scope = outOfScope;
  return Object.keys(scope).length > 0 ? scope : null;
}
function normalizeStringEntryArray(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const entry of value) {
    const normalized = normalizeStringEntry(entry);
    if (normalized) entries.push(normalized);
  }
  return entries;
}
function normalizeReviewedReadScope(...values) {
  return [...new Set(values.flatMap((value) => normalizeStringEntryArray(value)))]
    .sort((left, right) => left.localeCompare(right, "en"));
}
function normalizeEffectiveReviewedReadScope(record, unit, sliceId) {
  const sliceOwnsReadScopeAlias = Boolean(
    sliceId &&
    isObject(unit) &&
    (
      Object.prototype.hasOwnProperty.call(unit, "docs") ||
      Object.prototype.hasOwnProperty.call(unit, "read_scope")
    )
  );
  const source = sliceOwnsReadScopeAlias || !sliceId ? unit : record;
  return normalizeReviewedReadScope(source?.docs, source?.read_scope);
}
function normalizeReviewedScenarios(record, unit) {
  const rawScenarios = selectArrayCandidate(
    [unit, record],
    ["scenarios", "scenario_inventory", "scenarioInventory"]
  );
  return normalizeScenarios(record, { selectedSlice: unit })
    .map((scenario, index) => {
      const rawScenario = rawScenarios[index];
      const authoredId = isObject(rawScenario)
        ? normalizeStringEntry(rawScenario.id)
        : null;
      return {

        ...(authoredId ? { id: scenario.id } : {}),
        scenario_kind: scenario.scenario_kind,
        process_boundary: scenario.process_boundary,
        asserts_contract: scenario.asserts_contract,
        asserts_provenance_field: scenario.asserts_provenance_field,
        uses_stub: scenario.uses_stub,
        runtime_mode: scenario.runtime_mode,
        artifact_kind: scenario.artifact_kind
      };
    })
    .sort((left, right) => {
      const leftCanonical = JSON.stringify(left);
      const rightCanonical = JSON.stringify(right);
      return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
    });
}
const REVIEWED_ACCEPTANCE_PROVENANCE_FIELDS = Object.freeze([
  "text",
  "verification_method",
  "evidence_target"
]);
const REVIEWED_ACCEPTANCE_VERIFICATION_METHODS = new Set(
  WORK_UNIT_VERIFICATION_METHOD_VALUES
);
function normalizeReviewedCriterionProvenance(value) {
  if (!isObject(value)) return null;
  const provenance = {};
  for (const field of REVIEWED_ACCEPTANCE_PROVENANCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (value[field] === null) {
      provenance[field] = null;
      continue;
    }
    const normalized = normalizeProvenance(value[field], null);
    if (normalized) provenance[field] = normalized;
  }
  return Object.keys(provenance).length > 0 ? provenance : null;
}
function normalizeReviewedCriterion(value) {
  if (!isObject(value)) {
    return normalizeStringEntry(value);
  }

  const criterion = {
    text: normalizeStringEntry(value.text),
    verification_method: normalizeControlledValue(
      value.verification_method,
      REVIEWED_ACCEPTANCE_VERIFICATION_METHODS
    ),
    evidence_target: normalizeStringEntry(value.evidence_target)
  };
  const id = normalizeStringEntry(value.id);
  if (id) criterion.id = id;
  const facetProvenance = normalizeReviewedCriterionProvenance(value.facet_provenance);
  if (facetProvenance) criterion.facet_provenance = facetProvenance;
  return criterion;
}
function normalizeReviewedCriteria(value) {
  if (!Array.isArray(value)) return [];
  const criteria = [];
  for (const entry of value) {
    const normalized = normalizeReviewedCriterion(entry);
    if (normalized) criteria.push(normalized);
  }
  return criteria;
}
function normalizeReviewedAcceptance(value) {
  if (!isObject(value)) return null;
  const acceptance = {};
  const criteria = normalizeReviewedCriteria(value.criteria);
  const validation = normalizeStringEntryArray(value.validation);
  if (criteria.length > 0) acceptance.criteria = criteria;
  if (validation.length > 0) acceptance.validation = validation;
  return Object.keys(acceptance).length > 0 ? acceptance : null;
}
function normalizeReviewedMetadata(value) {
  return isObject(value) ? cloneJson(value) : null;
}
const REVIEWED_TARGET_PROVENANCE_FIELDS = Object.freeze([
  "path",
  "name",
  "kind",
  "operation",
  "activity_kind",
  "artifact_kind",
  "granularity",
  "optional"
]);
function normalizeReviewedTargetPath(value) {
  const normalized = normalizeStringEntry(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}
function normalizeReviewedTargetProvenance(value) {
  if (!isObject(value)) return null;
  const provenance = {};
  for (const field of REVIEWED_TARGET_PROVENANCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    if (value[field] === null) {
      provenance[field] = null;
      continue;
    }
    const normalized = normalizeStringEntry(value[field]);
    if (normalized) provenance[field] = normalized;
  }
  return Object.keys(provenance).length > 0 ? provenance : null;
}
function normalizeReviewedExpectedEditTargets(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((entry, index) => {
    const target = isObject(entry) ? entry : {};
    const normalized = {
      id: normalizeStringEntry(target.id) ?? `target-${index + 1}`,
      path: normalizeReviewedTargetPath(target.path),
      name: normalizeStringEntry(target.name),
      kind: normalizeStringEntry(target.kind),
      activity_kind: normalizeStringEntry(target.activity_kind),
      artifact_kind: normalizeStringEntry(target.artifact_kind),
      operation: normalizeStringEntry(target.operation),
      granularity: normalizeStringEntry(target.granularity),
      optional: target.optional === true
    };
    const facetProvenance = normalizeReviewedTargetProvenance(target.facet_provenance);
    if (facetProvenance) normalized.facet_provenance = facetProvenance;
    return normalized;
  });
}
function resolveEffectiveReviewedExpectedEditTargets(record, unit, sliceId) {
  if (!sliceId || Array.isArray(unit?.expected_edit_targets)) {
    return Array.isArray(unit?.expected_edit_targets)
      ? unit.expected_edit_targets
      : [];
  }
  return Array.isArray(record?.expected_edit_targets)
    ? record.expected_edit_targets
    : [];
}
function normalizeReviewedUnitDigestFacts(source) {
  const context = resolveReviewedUnitDigestContext(source);
  if (!context) return null;

  const { record, unit } = context;
  const recordId =
    normalizeStringEntry(unit.record_id) ??
    normalizeStringEntry(record?.record_id) ??
    normalizeStringEntry(record?.id);
  const sliceId = normalizeReviewedSliceId(unit);
  const address =
    normalizeStringEntry(unit.address) ??
    (recordId && sliceId ? `${recordId}#${sliceId}` : normalizeStringEntry(record?.address));
  const facts = {
    unit: {
      record_id: recordId,
      slice_id: sliceId ?? normalizeStringEntry(record?.slice_id),
      address,
      kind: normalizeStringEntry(unit.kind) ?? normalizeStringEntry(record?.kind),
      record_kind: normalizeStringEntry(unit.record_kind) ?? normalizeStringEntry(record?.record_kind),
      work_kind: normalizeStringEntry(unit.work_kind) ?? normalizeStringEntry(record?.work_kind),
      repo: normalizeStringEntry(unit.repo) ?? normalizeStringEntry(record?.repo),
      initiative: normalizeStringEntry(unit.initiative) ?? normalizeStringEntry(record?.initiative),
    },
    contract: {},
  };

  if (sliceId) {
    facts.unit.id = sliceId;
  }

  const readScope = normalizeEffectiveReviewedReadScope(record, unit, sliceId);
  if (readScope.length > 0) facts.contract.read_scope = readScope;

  const writeScope = normalizeStringEntryArray(unit.write_scope ?? record?.write_scope);
  if (writeScope.length > 0) facts.contract.write_scope = writeScope;

  const repoPaths = normalizeStringEntryArray(unit.repo_paths ?? record?.repo_paths);
  if (repoPaths.length > 0) facts.contract.repo_paths = repoPaths;

  const dependsOn = normalizeStringEntryArray(unit.depends_on ?? record?.depends_on);
  if (dependsOn.length > 0) facts.contract.depends_on = dependsOn;

  const blocks = normalizeStringEntryArray(unit.blocks ?? record?.blocks);
  if (blocks.length > 0) facts.contract.blocks = blocks;

  const scope = normalizeReviewedSectionScope(unit.scope ?? record?.scope ?? unit.sections?.scope ?? record?.sections?.scope);
  if (scope) facts.contract.scope = scope;

  const acceptance = normalizeReviewedAcceptance(
    unit.acceptance ??
      record?.acceptance ??
      unit.sections?.acceptance ??
      record?.sections?.acceptance,
  );
  if (acceptance) facts.contract.acceptance = acceptance;

  const validation = normalizeStringEntryArray(
    unit.validation ??
      record?.validation ??
      unit.sections?.validation ??
      record?.sections?.validation,
  );
  if (validation.length > 0) facts.contract.validation = validation;

  const dispatchIntent = normalizeReviewedMetadata(
    unit.dispatch_intent ??
      record?.dispatch_intent ??
      unit.sections?.dispatch_intent ??
      record?.sections?.dispatch_intent,
  );
  if (dispatchIntent) facts.contract.dispatch_intent = dispatchIntent;

  const expectedChangedLineBudget =
    unit.expected_changed_line_budget ??
    record?.expected_changed_line_budget ??
    unit.sections?.expected_changed_line_budget ??
    record?.sections?.expected_changed_line_budget;
  if (expectedChangedLineBudget !== undefined && expectedChangedLineBudget !== null) {
    facts.contract.expected_changed_line_budget = expectedChangedLineBudget;
  }

  const expectedEditTargets = normalizeReviewedExpectedEditTargets(
    resolveEffectiveReviewedExpectedEditTargets(record, unit, sliceId)
  );
  if (expectedEditTargets.length > 0) {
    facts.contract.expected_edit_targets = expectedEditTargets;
  }

  const scenarios = normalizeReviewedScenarios(record, unit);
  if (scenarios.length > 0) {
    facts.contract.scenarios = scenarios;
  }

  const escalations = normalizeEscalations(record?.escalations ?? []);
  if (escalations.length > 0) {
    facts.contract.escalations = escalations;
  }

  const runtimeModeMetadata = normalizeReviewedMetadata(
    unit.runtime_mode_metadata ??
      record?.runtime_mode_metadata ??
      unit.sections?.runtime_mode_metadata ??
      record?.sections?.runtime_mode_metadata,
  );
  if (runtimeModeMetadata) facts.contract.runtime_mode_metadata = runtimeModeMetadata;

  const artifactKindMetadata = normalizeReviewedMetadata(
    unit.artifact_kind_metadata ??
      record?.artifact_kind_metadata ??
      unit.sections?.artifact_kind_metadata ??
      record?.sections?.artifact_kind_metadata,
  );
  if (artifactKindMetadata) facts.contract.artifact_kind_metadata = artifactKindMetadata;

  const targetRuntimeMetadata = normalizeReviewedMetadata(
    unit.target_runtime_metadata ??
      record?.target_runtime_metadata ??
      unit.sections?.target_runtime_metadata ??
      record?.sections?.target_runtime_metadata,
  );
  if (targetRuntimeMetadata) facts.contract.target_runtime_metadata = targetRuntimeMetadata;

  const targetArtifactMetadata = normalizeReviewedMetadata(
    unit.target_artifact_metadata ??
      record?.target_artifact_metadata ??
      unit.sections?.target_artifact_metadata ??
      record?.sections?.target_artifact_metadata,
  );
  if (targetArtifactMetadata) facts.contract.target_artifact_metadata = targetArtifactMetadata;

  const targetMetadata = normalizeReviewedMetadata(
    unit.target_metadata ??
      record?.target_metadata ??
      unit.sections?.target_metadata ??
      record?.sections?.target_metadata,
  );
  if (targetMetadata) facts.contract.target_metadata = targetMetadata;

  if (Object.keys(facts.unit).every((key) => facts.unit[key] === null || facts.unit[key] === undefined)) {
    return null;
  }
  if (Object.keys(facts.contract).length === 0) {
    return null;
  }
  return facts;
}
export function computeReviewedUnitSourceDigest(source) {
  const facts = normalizeReviewedUnitDigestFacts(source);
  if (!facts) return null;
  return computeNormalizedInputDigest(facts);
}
export function computeReviewAttestationSourceDigest(source) {
  return computeReviewedUnitSourceDigest(source);
}
export function stableReviewedUnitSourceDigest(source) {
  return computeReviewedUnitSourceDigest(source);
}

function reviewAttestationBoundedFacts(a) {
  const facts = {
    schema_version: a.schema_version, authority: a.authority, attestation_id: a.attestation_id,
    repo: a.repo, unit: a.unit, reviewed_controls: a.reviewed_controls,
    reviewer_role_class: a.reviewer_role_class, status: a.status, source_digest: a.source_digest,
    reviewed_at: a.reviewed_at, expires_at: a.expires_at, review_run_ref: a.review_run_ref
  };

  if (a.review_unit !== undefined && a.review_unit !== null) {
    facts.review_unit = a.review_unit;
  }
  return facts;
}
export function computeReviewAttestationDigest(attestation) {
  return computeNormalizedInputDigest(reviewAttestationBoundedFacts(attestation));
}
function refuse(decisionCode, reason) {
  return { ok: false, decision_code: decisionCode, reasons: [reason] };
}

export function buildReviewAttestation(input) {
  if (!isObject(input)) return refuse(CODES.malformed, "input is not an object");
  const attestationId = normalizeStringEntry(input.attestation_id);
  const repo = normalizeStringEntry(input.repo);
  const unit = normalizeUnit(input.unit);
  const reviewedControls = normalizeControlIds(input.reviewed_controls);
  const reviewerRoleClass = normalizeStringEntry(input.reviewer_role_class);

  const status = canonicalizeReviewOutcome(input.review_outcome ?? input.disposition ?? input.status);
  const sourceDigest =
    normalizeStringEntry(input.source_digest) ??
    computeReviewedUnitSourceDigest(
      input.reviewed_unit ??
        input.reviewedUnit ??
        input.selected_unit ??
        input.selectedUnit ??
        input.unit_source ??
        input.unitSource ??
        input.source ??
        null,
    );
  const reviewedMs = isoTimestampMs(input.reviewed_at);
  const expiresMs = isoTimestampMs(input.expires_at);
  const reviewRunRef = normalizeReviewRunRef(input.review_run);

  const reviewUnitSupplied = input.review_unit !== undefined && input.review_unit !== null;
  const reviewUnit = reviewUnitSupplied ? normalizeUnit(input.review_unit) : null;

  if (!attestationId || !repo || !unit || !reviewedControls || !reviewerRoleClass) return refuse(CODES.malformed, "missing required bounded fields");
  if (reviewUnitSupplied && !reviewUnit) return refuse(CODES.malformed, "review_unit, when present, must be a bounded {record_id, address} unit");
  if (!isSha256(sourceDigest)) return refuse(CODES.malformed, "source_digest must be a sha256 digest");
  if (reviewedMs === null || expiresMs === null) return refuse(CODES.malformed, "reviewed_at/expires_at must be ISO-8601 UTC");
  if (expiresMs <= reviewedMs) return refuse(CODES.malformed, "expires_at must be after reviewed_at");
  if (!REVIEW_ATTESTATION_REVIEWER_ROLE_CLASS_VALUES.includes(reviewerRoleClass)) return refuse(CODES.wrongRole, "reviewer_role_class not in trusted set");
  if (!status || !REVIEW_ATTESTATION_DISPOSITION_VALUES.includes(status)) return refuse(CODES.blockingFindings, "review_outcome is not an accepted (non-blocking) outcome");

  const blockingCount = classifyNonNegativeInteger(input.blocking_finding_count);
  const mediumCount = classifyNonNegativeInteger(input.medium_finding_count);
  if (blockingCount.status === "invalid" || mediumCount.status === "invalid") {
    return refuse(CODES.blockingFindings, "blocking/medium finding counts must be non-negative integers");
  }
  const trustedCleanReviewSignal = input.trusted_clean_review === true;
  if ((blockingCount.status === "missing" || mediumCount.status === "missing") && !trustedCleanReviewSignal) {
    return refuse(
      CODES.missingTrustedReviewResultApi,
      "trusted structured review result must provide blocking_finding_count and medium_finding_count, or an equivalent trusted clean-review signal"
    );
  }
  const blockingFindingCount = blockingCount.status === "missing" ? 0 : blockingCount.value;
  const mediumFindingCount = mediumCount.status === "missing" ? 0 : mediumCount.value;
  if (blockingFindingCount > 0 || mediumFindingCount > 0) {
    return refuse(CODES.blockingFindings, "blocking or medium findings present");
  }
  if (!reviewRunRef) return refuse(CODES.untrustedProvenance, "review_run lacks a structured minted-run identity");
  if (reviewRunRef.provenance_kind !== REVIEW_ATTESTATION_TRUSTED_PROVENANCE_KIND) return refuse(CODES.untrustedProvenance, "review_run provenance is not a trusted structured run");
  if (reviewRunRef.role_class !== reviewerRoleClass) return refuse(CODES.wrongRole, "review_run role_class disagrees with reviewer_role_class");
  if (!REVIEW_ATTESTATION_TERMINAL_SUCCESS_STATUS_VALUES.includes(reviewRunRef.terminal_status)) return refuse(CODES.nonTerminal, "review_run is not in a terminal-success status");
  if (reviewUnit) {

    if (reviewUnit.address === unit.address) return refuse(CODES.malformed, "review_unit must be a separate unit from the attested target unit");
    if (reviewRunRef.subject_address !== reviewUnit.address) return refuse(CODES.wrongUnit, "review_run subject_address must match the separate review unit");
  } else if (reviewRunRef.subject_address !== unit.address) {
    return refuse(CODES.wrongUnit, "review_run subject_address does not match the reviewed unit");
  }
  const attestation = {
    schema_version: REVIEW_ATTESTATION_SCHEMA_VERSION, authority: REVIEW_ATTESTATION_AUTHORITY,
    attestation_id: attestationId, attestation_digest: null, repo, unit,
    reviewed_controls: reviewedControls, reviewer_role_class: reviewerRoleClass, status,
    source_digest: sourceDigest, reviewed_at: normalizeStringEntry(input.reviewed_at),
    expires_at: normalizeStringEntry(input.expires_at), review_run_ref: reviewRunRef
  };

  if (reviewUnit) attestation.review_unit = reviewUnit;
  attestation.attestation_digest = computeReviewAttestationDigest(attestation);
  return { ok: true, attestation: cloneJson(attestation) };
}
function isWellFormedAttestation(a) {
  return (
    isObject(a) && a.schema_version === REVIEW_ATTESTATION_SCHEMA_VERSION &&

    a.authority === REVIEW_ATTESTATION_AUTHORITY &&
    isNonEmptyString(a.attestation_id) && isNonEmptyString(a.repo) &&
    normalizeUnit(a.unit) !== null && normalizeControlIds(a.reviewed_controls) !== null &&
    REVIEW_ATTESTATION_REVIEWER_ROLE_CLASS_VALUES.includes(a.reviewer_role_class) &&
    REVIEW_ATTESTATION_DISPOSITION_VALUES.includes(a.status) && isSha256(a.source_digest) &&
    isoTimestampMs(a.reviewed_at) !== null && isoTimestampMs(a.expires_at) !== null &&

    isoTimestampMs(a.expires_at) > isoTimestampMs(a.reviewed_at) &&
    normalizeReviewRunRef(a.review_run_ref) !== null && isSha256(a.attestation_digest) &&

    isWellFormedOptionalReviewUnit(a)
  );
}
function isWellFormedOptionalReviewUnit(a) {
  if (a.review_unit === undefined || a.review_unit === null) return true;
  const reviewUnit = normalizeUnit(a.review_unit);
  const targetUnit = normalizeUnit(a.unit);
  return reviewUnit !== null && targetUnit !== null && reviewUnit.address !== targetUnit.address;
}
function deny(decisionCode, reason) {
  return { valid: false, decision_code: decisionCode, reasons: [reason] };
}

export function validateStoredReviewAttestationIntrinsic(attestation, context = {}) {
  if (attestation === null || attestation === undefined) {
    return { ...deny(CODES.missing, "no attestation supplied"), active: false };
  }
  if (!isWellFormedAttestation(attestation)) {
    return { ...deny(CODES.malformed, "attestation is malformed"), active: false };
  }
  if (computeReviewAttestationDigest(attestation) !== attestation.attestation_digest) {
    return {
      ...deny(CODES.digestMismatch, "attestation_digest does not match bounded facts"),
      active: false
    };
  }

  const runRef = attestation.review_run_ref;
  if (runRef.provenance_kind !== REVIEW_ATTESTATION_TRUSTED_PROVENANCE_KIND) {
    return {
      ...deny(CODES.untrustedProvenance, "provenance is not a trusted structured run"),
      active: false
    };
  }
  if (!REVIEW_ATTESTATION_TERMINAL_SUCCESS_STATUS_VALUES.includes(runRef.terminal_status)) {
    return { ...deny(CODES.nonTerminal, "review run is not terminal-success"), active: false };
  }
  if (runRef.role_class !== attestation.reviewer_role_class) {
    return {
      ...deny(CODES.wrongRole, "review run role class does not match the attested reviewer role"),
      active: false
    };
  }
  const reviewUnit = attestationReviewUnit(attestation.review_unit);
  if (reviewUnit) {
    if (
      reviewUnit.address === attestation.unit.address ||
      runRef.subject_address !== reviewUnit.address
    ) {
      return {
        ...deny(CODES.wrongUnit, "review run subject does not match the separate review unit"),
        active: false
      };
    }
  } else if (runRef.subject_address !== attestation.unit.address) {
    return {
      ...deny(CODES.wrongUnit, "review run subject does not match the attested unit"),
      active: false
    };
  }

  if (!isObject(context)) {
    return { ...deny(CODES.missingExpectation, "intrinsic binding context is required"), active: false };
  }
  const expectedRepo = normalizeStringEntry(context.repo);
  const expectedUnit = normalizeStringEntry(context.selected_unit_address);
  const expectedDigest = normalizeStringEntry(context.current_reviewed_unit_digest);
  const nowMs = isoTimestampMs(context.now);
  if (!expectedRepo || !expectedUnit || !isSha256(expectedDigest) || nowMs === null) {
    return {
      ...deny(CODES.missingExpectation, "server-owned repo, selected unit, digest, and time are required"),
      active: false
    };
  }
  if (expectedRepo !== attestation.repo || expectedUnit !== attestation.unit.address) {
    return { ...deny(CODES.wrongUnit, "stored attestation binds a different unit"), active: false };
  }
  if (expectedDigest !== attestation.source_digest) {
    return {
      ...deny(CODES.wrongDigest, "stored attestation binds a different reviewed-unit digest"),
      active: false
    };
  }
  if (nowMs > isoTimestampMs(attestation.expires_at)) {
    return { ...deny(CODES.expired, "attestation has expired"), active: false };
  }
  return {
    valid: true,
    active: true,
    decision_code: CODES.valid,
    reasons: [],
    launch_authoritative: false
  };
}

export function validateReviewAttestation(attestation, expectation = {}) {
  if (attestation === null || attestation === undefined) return deny(CODES.missing, "no attestation supplied");
  if (!isWellFormedAttestation(attestation)) return deny(CODES.malformed, "attestation is malformed");
  if (computeReviewAttestationDigest(attestation) !== attestation.attestation_digest) return deny(CODES.digestMismatch, "attestation_digest does not match bounded facts");
  const runRef = attestation.review_run_ref;
  if (runRef.provenance_kind !== REVIEW_ATTESTATION_TRUSTED_PROVENANCE_KIND) return deny(CODES.untrustedProvenance, "provenance is not a trusted structured run");
  if (!REVIEW_ATTESTATION_TERMINAL_SUCCESS_STATUS_VALUES.includes(runRef.terminal_status)) return deny(CODES.nonTerminal, "review run is not terminal-success");

  if (runRef.role_class !== attestation.reviewer_role_class) return deny(CODES.wrongRole, "review run role class does not match the attested reviewer role");

  const reviewUnit = attestationReviewUnit(attestation.review_unit);
  if (reviewUnit) {
    if (reviewUnit.address === attestation.unit.address) return deny(CODES.wrongUnit, "review unit must differ from the attested target unit");
    if (runRef.subject_address !== reviewUnit.address) return deny(CODES.wrongUnit, "review run subject does not match the separate review unit");
  } else if (runRef.subject_address !== attestation.unit.address) {
    return deny(CODES.wrongUnit, "review run subject does not match the attested unit");
  }

  if (!isObject(expectation)) return deny(CODES.missingExpectation, "expectation binding context is required");
  const expectedRepo = normalizeStringEntry(expectation.repo);
  const expectedUnit = normalizeStringEntry(expectation.unit_address);
  const expectedDigest = normalizeStringEntry(expectation.source_digest);
  const expectedRole = normalizeStringEntry(expectation.required_role_class);
  const admittingRunId = normalizeStringEntry(expectation.admitting_run_id);
  const requiredControls = normalizeControlIds(expectation.required_controls);
  if (!expectedRepo) return deny(CODES.missingExpectation, "expectation.repo is required");
  if (!expectedUnit) return deny(CODES.missingExpectation, "expectation.unit_address is required");
  if (!isSha256(expectedDigest)) return deny(CODES.missingExpectation, "expectation.source_digest must be a sha256 digest");
  if (!expectedRole) return deny(CODES.missingExpectation, "expectation.required_role_class is required");
  if (!admittingRunId) return deny(CODES.missingExpectation, "expectation.admitting_run_id is required");
  if (!requiredControls) return deny(CODES.missingExpectation, "expectation.required_controls must be a non-empty array of control ids");

  if (expectedRepo !== attestation.repo) return deny(CODES.wrongUnit, "repo does not match expectation");
  if (expectedUnit !== attestation.unit.address) return deny(CODES.wrongUnit, "unit address does not match expectation");
  if (expectedDigest !== attestation.source_digest) return deny(CODES.wrongDigest, "source digest does not match the current unit");
  if (expectedRole !== attestation.reviewer_role_class) return deny(CODES.wrongRole, "reviewer role class does not match expectation");

  const covered = new Set(attestation.reviewed_controls);
  const missing = requiredControls.filter((control) => !covered.has(control));
  if (missing.length > 0) return deny(CODES.wrongControl, `reviewed controls do not cover: ${missing.join(", ")}`);
  if (admittingRunId === runRef.run_id) return deny(CODES.selfAuthored, "attestation was authored by the run being admitted");
  const nowMs = isoTimestampMs(expectation.now) ?? Date.now();
  if (nowMs > isoTimestampMs(attestation.expires_at)) return deny(CODES.expired, "attestation has expired");

  return { valid: true, decision_code: CODES.valid, reasons: [], launch_authoritative: false };
}

export function isReviewAttestationExpired(attestation, now) {
  if (!isWellFormedAttestation(attestation)) return true;
  const nowMs = isoTimestampMs(now) ?? Date.now();
  return nowMs > isoTimestampMs(attestation.expires_at);
}
