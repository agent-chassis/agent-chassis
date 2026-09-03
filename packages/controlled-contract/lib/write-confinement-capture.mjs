

import {
  CAPTURE_ROLE_DEFECTS,
  assembleCaptureEvaluationInput,
  canonicalCaptureEvaluationInputJson,
  capturePackIdentityMismatch,
  captureEvaluationInputDiagnostics,
  createCaptureResultFactory,
  diagnosticScalar,
  isPlainObject,
  planCaptureRoleBindings,
  resolveCapturePackSnapshot,
  resolveExactlyOneEvaluationStage
} from "./capture-mapping.mjs";
import {
  compareCodeUnits,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION =
  "controlled-contract-write-confinement-capture.v1";

const WRITE_CONFINEMENT_PROFILE_ID = "proof.scope.write-confinement";
const WRITE_CONFINEMENT_PROFILE_VERSION = "2.0.0";

const WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION =
  "workspace-agent-write-confinement-evidence.v1";

const NON_EVIDENCE_LAUNCHER_SCHEMA_VERSIONS = Object.freeze({
  "workspace-agent-write-confinement-delivery.v1": "authenticated delivery input",
  "workspace-agent-write-confinement-receipt-binding.v1": "receipt binding input",
  "workspace-agent-write-confinement-source.v1": "source digest body",
  "workspace-agent-write-confinement-result.v1": "result digest body"
});

const ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "projected", "evidence", "evidence_digest", "state_changed",
  "authority", "refusal"
]);

const EVIDENCE_FIELDS = Object.freeze([
  "schema_version", "authority", "observation_boundary", "not_covered",
  "repository", "run_id", "attempt", "record_id", "unit_address", "selected_unit",
  "frozen_write_scope", "base_commit", "delivery_commit", "delivery_tree",
  "contained", "changed_paths", "outside_write_scope_paths",
  "inside_write_scope_paths", "changed_path_count",
  "outside_write_scope_path_count", "inside_write_scope_path_count",
  "populations_complete", "source_digest", "result_digest", "observed_at",
  "admission_effect", "review_effect", "integration_effect", "publication_effect",
  "closure_effect", "proof_pack_applicability", "cce_effect", "semantic_judgment"
]);

const REQUIRED_EVIDENCE_MARKERS = Object.freeze({
  authority: "authenticated_observation_only",
  observation_boundary: "base_to_delivery_tree_delta",
  populations_complete: true,
  admission_effect: "none",
  review_effect: "none",
  integration_effect: "none",
  publication_effect: "none",
  closure_effect: "none",
  proof_pack_applicability: "none",
  cce_effect: "none",
  semantic_judgment: "not_performed_coordinator_owned"
});

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

const WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.write_confinement_capture.missing_required_input.v1",
  MALFORMED_ENVELOPE:
    "controlled_contract.write_confinement_capture.malformed_envelope.v1",
  WRONG_LAUNCHER_ARTIFACT:
    "controlled_contract.write_confinement_capture.wrong_launcher_artifact.v1",
  EVIDENCE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.write_confinement_capture.evidence_schema_version_unsupported.v1",
  UNPROJECTED_ENVELOPE:
    "controlled_contract.write_confinement_capture.unprojected_envelope.v1",
  MALFORMED_EVIDENCE:
    "controlled_contract.write_confinement_capture.malformed_evidence.v1",
  EVIDENCE_AUTHORITY_UNSUPPORTED:
    "controlled_contract.write_confinement_capture.evidence_authority_unsupported.v1",
  POPULATION_NONCANONICAL:
    "controlled_contract.write_confinement_capture.population_noncanonical.v1",
  POPULATION_INCONSISTENT:
    "controlled_contract.write_confinement_capture.population_inconsistent.v1",
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.write_confinement_capture.pack_snapshot_unrecognized.v1",
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.write_confinement_capture.profile_identity_mismatch.v1",
  PACK_STAGE_UNSUPPORTED:
    "controlled_contract.write_confinement_capture.pack_stage_unsupported.v1",
  PACK_ROLE_INCOMPATIBLE:
    "controlled_contract.write_confinement_capture.pack_role_incompatible.v1",
  EVALUATION_INPUT_INVALID:
    "controlled_contract.write_confinement_capture.evaluation_input_invalid.v1"
});

const ROLE_PLAN = Object.freeze([
  Object.freeze({
    role: "execution",
    typeTerms: Object.freeze(["cc:process"]),
    identityKinds: Object.freeze(["durable_id"]),

    build: (evidence, kind) => [singleton(
      "ref-write-confinement-execution", kind,
      { domain: "launcher.managed-delivery",
        value: `${evidence.unit_address}@${evidence.run_id}#${evidence.attempt}` },
      evidence
    )]
  }),
  Object.freeze({
    role: "observed_population",
    typeTerms: Object.freeze(["cc:population"]),
    identityKinds: Object.freeze(["durable_id"]),

    build: (evidence, kind) => [singleton(
      "ref-write-confinement-observed-population", kind,
      { domain: "launcher.write-confinement.observed-population",
        value: evidence.result_digest },
      evidence
    )]
  }),
  Object.freeze({
    role: "observed_mutations",
    typeTerms: Object.freeze(["cc:artifact", "cc:resource"]),
    identityKinds: Object.freeze(["repository_path", "durable_id"]),

    build: (evidence, kind) => evidence.changed_paths.map((entry, index) => member(
      `ref-write-confinement-observed-mutation-${index}`, kind,
      "launcher.write-confinement.observed-mutation", entry, evidence
    ))
  }),
  Object.freeze({
    role: "authorized_scope",
    typeTerms: Object.freeze(["cc:scope"]),
    identityKinds: Object.freeze(["durable_id"]),

    build: (evidence, kind) => [singleton(
      "ref-write-confinement-authorized-scope", kind,
      { domain: "launcher.write-confinement.authorized-scope",
        value: evidence.source_digest },
      evidence
    )]
  }),
  Object.freeze({
    role: "authorized_targets",
    typeTerms: Object.freeze(["cc:artifact", "cc:resource"]),
    identityKinds: Object.freeze(["repository_path", "durable_id"]),

    build: (evidence, kind) => evidence.frozen_write_scope.map((entry, index) => member(
      `ref-write-confinement-authorized-target-${index}`, kind,
      "launcher.write-confinement.authorized-target", entry, evidence
    ))
  }),
  Object.freeze({
    role: "verification",
    typeTerms: Object.freeze(["cc:process", "cc:test"]),
    identityKinds: Object.freeze(["durable_id", "repository_path"]),

    build: (evidence, kind, envelope) => [singleton(
      "ref-write-confinement-verification", kind,
      { domain: "launcher.write-confinement.verification",
        value: envelope.evidence_digest },
      evidence
    )]
  }),
  Object.freeze({
    role: "unauthorized_mutation_condition",
    typeTerms: Object.freeze(["cc:state", "cc:configuration"]),
    identityKinds: Object.freeze(["durable_id"]),

    build: (evidence, kind) => [singleton(
      "ref-write-confinement-unauthorized-mutation-condition", kind,
      { domain: "launcher.write-confinement.condition",
        value: "observed-mutation-outside-frozen-write-scope" },
      evidence
    )]
  })
]);

function singleton(referenceId, kind, durable, evidence) {
  return {
    reference_id: referenceId,
    identity: kind === "durable_id"
      ? { kind, domain: durable.domain, value: durable.value }
      : { kind, repository: evidence.repository, path: durable.value }
  };
}

function member(referenceId, kind, domain, entry, evidence) {
  return {
    reference_id: referenceId,
    identity: kind === "repository_path"
      ? { kind, repository: evidence.repository, path: entry }
      : { kind, domain, value: entry }
  };
}

const RESULTS = createCaptureResultFactory({
  schemaVersion: WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION,
  identity: {
    profile_id: WRITE_CONFINEMENT_PROFILE_ID,
    profile_version: WRITE_CONFINEMENT_PROFILE_VERSION,
    evidence_schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
  }
});

const refuse = (code, reason, detail = null) => RESULTS.refuse(code, reason, detail);

function exactKeys(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function missingField(value, fields) {
  return fields.find((field) => !Object.hasOwn(value, field)) ?? null;
}

function unexpectedField(value, fields) {
  const allowed = new Set(fields);
  return Object.keys(value).filter((key) => !allowed.has(key))
    .sort(compareCodeUnits)[0] ?? null;
}

function populationDefect(values, label) {
  if (!Array.isArray(values)) return `${label} must be an array as emitted by its owner`;
  const bad = values.findIndex((entry) => typeof entry !== "string" || entry.length === 0 ||
    entry.includes("\0"));
  if (bad !== -1) return `${label}[${bad}] must be a non-empty NUL-free repository path`;
  if (!sortedUnique(values)) {
    return `${label} must be strictly ascending and duplicate-free as emitted by its owner`;
  }
  return null;
}

function admitEnvelope(projection) {
  if (projection === undefined || projection === null) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MISSING_REQUIRED_INPUT,
      "projection is required to map write-confinement capture",
      { input: "projection" }
    );
  }
  if (!isPlainObject(projection)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_ENVELOPE,
      "projection must be the launcher write-confinement projection envelope object",
      { input: "projection" }
    );
  }

  const wrongArtifact = NON_EVIDENCE_LAUNCHER_SCHEMA_VERSIONS[projection.schema_version];
  if (wrongArtifact !== undefined) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.WRONG_LAUNCHER_ARTIFACT,
      `projection is the launcher ${wrongArtifact}, not the write-confinement projection envelope`,
      { supplied: projection.schema_version, expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION }
    );
  }
  if (projection.schema_version !== WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED,
      `projection must carry schema_version ${WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION}`,
      {
        supplied: typeof projection.schema_version === "string"
          ? projection.schema_version : null,
        expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
      }
    );
  }

  if (!exactKeys(projection, ENVELOPE_FIELDS)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_ENVELOPE,
      "projection must be the projection envelope with its exact field set, not the inner evidence object",
      {
        missing_field: missingField(projection, ENVELOPE_FIELDS),
        unexpected_field: unexpectedField(projection, ENVELOPE_FIELDS)
      }
    );
  }
  if (projection.projected !== true || projection.refusal !== null ||
      projection.evidence === null) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.UNPROJECTED_ENVELOPE,
      "only a projected envelope carrying evidence and no refusal can be mapped",
      {
        projected: projection.projected === true,
        refusal_present: projection.refusal !== null,
        evidence_present: projection.evidence !== null
      }
    );
  }
  if (typeof projection.evidence_digest !== "string" ||
      !DIGEST_RE.test(projection.evidence_digest)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_ENVELOPE,
      "the projection envelope must carry a canonical sha256 evidence digest",
      { input: "projection.evidence_digest" }
    );
  }
  return null;
}

function admitEvidenceShape(evidence) {
  if (!isPlainObject(evidence)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
      "projection.evidence must be the inner write-confinement evidence object",
      { input: "projection.evidence" }
    );
  }
  if (evidence.schema_version !== WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED,
      `projection.evidence must carry schema_version ${WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION}`,
      {
        supplied: typeof evidence.schema_version === "string" ? evidence.schema_version : null,
        expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
      }
    );
  }
  if (!exactKeys(evidence, EVIDENCE_FIELDS)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
      "projection.evidence must carry the exact accepted evidence field set",
      {
        missing_field: missingField(evidence, EVIDENCE_FIELDS),
        unexpected_field: unexpectedField(evidence, EVIDENCE_FIELDS)
      }
    );
  }
  for (const [field, expected] of Object.entries(REQUIRED_EVIDENCE_MARKERS)) {
    if (evidence[field] !== expected) {
      return refuse(
        WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
        `projection.evidence.${field} does not carry the observation-only authority this mapping accepts`,
        { field, expected, supplied: diagnosticScalar(evidence[field]) }
      );
    }
  }
  if (!Array.isArray(evidence.not_covered) || evidence.not_covered.length === 0 ||
      evidence.not_covered.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
      "projection.evidence.not_covered must state what the owner did not observe",
      { field: "not_covered" }
    );
  }
  for (const field of ["repository", "run_id", "record_id", "unit_address", "base_commit",
    "delivery_commit", "delivery_tree", "observed_at"]) {
    if (typeof evidence[field] !== "string" || evidence[field].length === 0) {
      return refuse(
        WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
        `projection.evidence.${field} must be a non-empty authenticated identity`,
        { field }
      );
    }
  }
  if (!Number.isInteger(evidence.attempt) || evidence.attempt < 0) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
      "projection.evidence.attempt must be a non-negative integer attempt identity",
      { field: "attempt" }
    );
  }
  for (const field of ["source_digest", "result_digest"]) {
    if (typeof evidence[field] !== "string" || !DIGEST_RE.test(evidence[field])) {
      return refuse(
        WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
        `projection.evidence.${field} must be a canonical sha256 digest`,
        { field }
      );
    }
  }
  if (typeof evidence.contained !== "boolean") {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.MALFORMED_EVIDENCE,
      "projection.evidence.contained must be the owner's boolean containment outcome",
      { field: "contained" }
    );
  }
  return null;
}

function admitEvidenceConsistency(evidence) {
  for (const [field, label] of [
    ["frozen_write_scope", "projection.evidence.frozen_write_scope"],
    ["changed_paths", "projection.evidence.changed_paths"],
    ["outside_write_scope_paths", "projection.evidence.outside_write_scope_paths"],
    ["inside_write_scope_paths", "projection.evidence.inside_write_scope_paths"]
  ]) {
    const defect = populationDefect(evidence[field], label);
    if (defect !== null) {
      return refuse(
        WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_NONCANONICAL,
        defect, { population: field }
      );
    }
  }
  for (const [countField, populationField] of [
    ["changed_path_count", "changed_paths"],
    ["outside_write_scope_path_count", "outside_write_scope_paths"],
    ["inside_write_scope_path_count", "inside_write_scope_paths"]
  ]) {
    if (evidence[countField] !== evidence[populationField].length) {
      return refuse(
        WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
        `projection.evidence.${countField} disagrees with the length of ${populationField}`,
        {
          population: populationField,
          declared: diagnosticScalar(evidence[countField]),
          actual: evidence[populationField].length
        }
      );
    }
  }
  const changed = new Set(evidence.changed_paths);
  const outsideStray = evidence.outside_write_scope_paths.find((entry) => !changed.has(entry));
  if (outsideStray !== undefined) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
      "projection.evidence.outside_write_scope_paths names a path absent from changed_paths",
      { population: "outside_write_scope_paths", path: outsideStray }
    );
  }
  const insideStray = evidence.inside_write_scope_paths.find((entry) => !changed.has(entry));
  if (insideStray !== undefined) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
      "projection.evidence.inside_write_scope_paths names a path absent from changed_paths",
      { population: "inside_write_scope_paths", path: insideStray }
    );
  }

  const outside = new Set(evidence.outside_write_scope_paths);
  const inside = new Set(evidence.inside_write_scope_paths);
  const overlap = evidence.inside_write_scope_paths.find((entry) => outside.has(entry));
  if (overlap !== undefined) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
      "a changed path is reported both inside and outside the frozen write scope",
      { path: overlap }
    );
  }
  const unpartitioned = evidence.changed_paths.find((entry) =>
    !outside.has(entry) && !inside.has(entry));
  if (unpartitioned !== undefined) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
      "a changed path is reported neither inside nor outside the frozen write scope",
      { path: unpartitioned }
    );
  }

  if (evidence.contained !== (evidence.outside_write_scope_paths.length === 0)) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.POPULATION_INCONSISTENT,
      "the containment outcome disagrees with the outside-write-scope population",
      {
        contained: evidence.contained,
        outside_write_scope_path_count: evidence.outside_write_scope_paths.length
      }
    );
  }
  return null;
}

const ROLE_DEFECT_REASONS = Object.freeze({
  [CAPTURE_ROLE_DEFECTS.ROLE_UNFILLABLE]: () =>
    "the admitted pack declares a reference role this mapping cannot fill",
  [CAPTURE_ROLE_DEFECTS.TYPE_TERM_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no type term this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.IDENTITY_KIND_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no identity kind this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.CARDINALITY_INVALID]: ({ role }) =>
    `the authenticated evidence fills ${role} with a member count the pack forbids`,
  [CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT]: ({ role }) =>
    `this mapping emitted two conflicting definitions of one reference for ${role}`
});

function refuseRoleDefect({ kind, detail }) {
  return refuse(
    WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.PACK_ROLE_INCOMPATIBLE,
    ROLE_DEFECT_REASONS[kind](detail),
    detail
  );
}

async function mapWriteConfinementCapture({ projection, pack = null } = {}) {
  const envelopeRefusal = admitEnvelope(projection);
  if (envelopeRefusal !== null) return envelopeRefusal;

  const evidence = projection.evidence;
  const shapeRefusal = admitEvidenceShape(evidence);
  if (shapeRefusal !== null) return shapeRefusal;

  const consistencyRefusal = admitEvidenceConsistency(evidence);
  if (consistencyRefusal !== null) return consistencyRefusal;

  const { admitted, unrecognized } = await resolveCapturePackSnapshot({
    pack, profileId: WRITE_CONFINEMENT_PROFILE_ID
  });
  if (unrecognized) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.PACK_SNAPSHOT_UNRECOGNIZED,
      "a supplied pack must be the exact snapshot returned by the admitted-pack loader",
      { input: "pack" }
    );
  }

  const identityMismatch = capturePackIdentityMismatch(admitted.profile, {
    profileId: WRITE_CONFINEMENT_PROFILE_ID,
    profileVersion: WRITE_CONFINEMENT_PROFILE_VERSION
  });
  if (identityMismatch !== null) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.PROFILE_IDENTITY_MISMATCH,
      "this mapping is written against one exact admitted pack identity",
      identityMismatch
    );
  }

  const { stage, declaredStageCount } =
    resolveExactlyOneEvaluationStage(admitted.profile);
  if (stage === null) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.PACK_STAGE_UNSUPPORTED,
      "this mapping fills one evaluation stage and the pack does not declare exactly one",
      { declared_stage_count: declaredStageCount }
    );
  }

  const { bindings, references, defect } = planCaptureRoleBindings(
    admitted.profile,
    ROLE_PLAN.map(({ role, typeTerms, identityKinds, build }) => ({
      role,
      typeTerms,
      identityKinds,
      build: (identityKind) => build(evidence, identityKind, projection)
    }))
  );
  if (defect !== null) return refuseRoleDefect(defect);

  const evaluationInput = assembleCaptureEvaluationInput({
    stage, referenceBindings: bindings
  });
  const diagnostics = captureEvaluationInputDiagnostics(evaluationInput);
  if (diagnostics !== null) {
    return refuse(
      WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES.EVALUATION_INPUT_INVALID,
      "the mapped evaluation input does not satisfy the owning evaluation-input schema",
      { diagnostics }
    );
  }

  return RESULTS.accept({
    source: {
      repository: evidence.repository,
      run_id: evidence.run_id,
      attempt: evidence.attempt,
      record_id: evidence.record_id,
      unit_address: evidence.unit_address,
      base_commit: evidence.base_commit,
      delivery_commit: evidence.delivery_commit,
      delivery_tree: evidence.delivery_tree,
      source_digest: evidence.source_digest,
      result_digest: evidence.result_digest,
      evidence_digest: projection.evidence_digest
    },
    references,
    evaluationInput
  });
}

function canonicalWriteConfinementEvaluationInputJson(result) {
  return canonicalCaptureEvaluationInputJson(result, "write-confinement capture");
}

export {
  WRITE_CONFINEMENT_CAPTURE_REFUSAL_CODES,
  WRITE_CONFINEMENT_CAPTURE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_PROFILE_ID,
  WRITE_CONFINEMENT_PROFILE_VERSION,
  canonicalWriteConfinementEvaluationInputJson,
  mapWriteConfinementCapture
};
