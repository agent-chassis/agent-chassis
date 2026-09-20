

import {
  compareCodeUnits,
  deepFreeze,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION =
  "controlled-contract-write-confinement-verification.v1";

const WRITE_CONFINEMENT_PROFILE_ID = "proof.scope.write-confinement";
const WRITE_CONFINEMENT_PROFILE_VERSION = "4.0.0";

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

const WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.write_confinement_verification.missing_required_input.v1",
  MALFORMED_ENVELOPE:
    "controlled_contract.write_confinement_verification.malformed_envelope.v1",
  WRONG_LAUNCHER_ARTIFACT:
    "controlled_contract.write_confinement_verification.wrong_launcher_artifact.v1",
  EVIDENCE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.write_confinement_verification.evidence_schema_version_unsupported.v1",
  UNPROJECTED_ENVELOPE:
    "controlled_contract.write_confinement_verification.unprojected_envelope.v1",
  MALFORMED_EVIDENCE:
    "controlled_contract.write_confinement_verification.malformed_evidence.v1",
  EVIDENCE_AUTHORITY_UNSUPPORTED:
    "controlled_contract.write_confinement_verification.evidence_authority_unsupported.v1",
  POPULATION_NONCANONICAL:
    "controlled_contract.write_confinement_verification.population_noncanonical.v1",
  POPULATION_INCONSISTENT:
    "controlled_contract.write_confinement_verification.population_inconsistent.v1"
});

const CODES = WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnosticScalar(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean": return value;
    case "function": return "[function]";
    case "symbol": return "[symbol]";
    case "bigint": return "[bigint]";
    default: return "[object]";
  }
}

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

function refuse(code, reason, detail = null) {
  return deepFreeze({
    schema_version: WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION,
    verified: false,
    profile_id: WRITE_CONFINEMENT_PROFILE_ID,
    profile_version: WRITE_CONFINEMENT_PROFILE_VERSION,
    evidence_schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
    source: null,
    populations: null,
    refusal: { code, reason, detail: detail === null ? null : structuredClone(detail) }
  });
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
    return refuse(CODES.MISSING_REQUIRED_INPUT,
      "projection is required to verify a write-confinement projection envelope",
      { input: "projection" });
  }
  if (!isPlainObject(projection)) {
    return refuse(CODES.MALFORMED_ENVELOPE,
      "projection must be the launcher write-confinement projection envelope object",
      { input: "projection" });
  }
  const wrongArtifact = NON_EVIDENCE_LAUNCHER_SCHEMA_VERSIONS[projection.schema_version];
  if (wrongArtifact !== undefined) {
    return refuse(CODES.WRONG_LAUNCHER_ARTIFACT,
      `projection is the launcher ${wrongArtifact}, not the write-confinement projection envelope`,
      { supplied: projection.schema_version, expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION });
  }
  if (projection.schema_version !== WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION) {
    return refuse(CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED,
      `projection must carry schema_version ${WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION}`, {
        supplied: typeof projection.schema_version === "string"
          ? projection.schema_version : null,
        expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
      });
  }
  if (!exactKeys(projection, ENVELOPE_FIELDS)) {
    return refuse(CODES.MALFORMED_ENVELOPE,
      "projection must be the projection envelope with its exact field set, not the inner evidence object", {
        missing_field: missingField(projection, ENVELOPE_FIELDS),
        unexpected_field: unexpectedField(projection, ENVELOPE_FIELDS)
      });
  }
  if (projection.projected !== true || projection.refusal !== null ||
      projection.evidence === null) {
    return refuse(CODES.UNPROJECTED_ENVELOPE,
      "only a projected envelope carrying evidence and no refusal can be verified", {
        projected: projection.projected === true,
        refusal_present: projection.refusal !== null,
        evidence_present: projection.evidence !== null
      });
  }
  if (typeof projection.evidence_digest !== "string" ||
      !DIGEST_RE.test(projection.evidence_digest)) {
    return refuse(CODES.MALFORMED_ENVELOPE,
      "the projection envelope must carry a canonical sha256 evidence digest",
      { input: "projection.evidence_digest" });
  }
  return null;
}

function admitEvidenceShape(evidence) {
  if (evidence === undefined || evidence === null) {
    return refuse(CODES.MISSING_REQUIRED_INPUT,
      "evidence is required to verify write confinement", { input: "evidence" });
  }
  if (!isPlainObject(evidence)) {
    return refuse(CODES.MALFORMED_EVIDENCE,
      "evidence must be the inner write-confinement evidence object", { input: "evidence" });
  }
  const wrongArtifact = NON_EVIDENCE_LAUNCHER_SCHEMA_VERSIONS[evidence.schema_version];
  if (wrongArtifact !== undefined) {
    return refuse(CODES.WRONG_LAUNCHER_ARTIFACT,
      `evidence is the launcher ${wrongArtifact}, not the write-confinement evidence`,
      { supplied: evidence.schema_version, expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION });
  }
  if (evidence.schema_version !== WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION) {
    return refuse(CODES.EVIDENCE_SCHEMA_VERSION_UNSUPPORTED,
      `evidence must carry schema_version ${WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION}`, {
        supplied: typeof evidence.schema_version === "string" ? evidence.schema_version : null,
        expected: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION
      });
  }
  if (!exactKeys(evidence, EVIDENCE_FIELDS)) {
    return refuse(CODES.MALFORMED_EVIDENCE,
      "evidence must carry the exact accepted evidence field set", {
        missing_field: missingField(evidence, EVIDENCE_FIELDS),
        unexpected_field: unexpectedField(evidence, EVIDENCE_FIELDS)
      });
  }
  for (const [field, expected] of Object.entries(REQUIRED_EVIDENCE_MARKERS)) {
    if (evidence[field] !== expected) {
      return refuse(CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
        `evidence.${field} does not carry the observation-only authority this verification accepts`,
        { field, expected, supplied: diagnosticScalar(evidence[field]) });
    }
  }
  if (!Array.isArray(evidence.not_covered) || evidence.not_covered.length === 0 ||
      evidence.not_covered.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return refuse(CODES.EVIDENCE_AUTHORITY_UNSUPPORTED,
      "evidence.not_covered must state what the owner did not observe", { field: "not_covered" });
  }
  for (const field of ["repository", "run_id", "record_id", "unit_address", "base_commit",
    "delivery_commit", "delivery_tree", "observed_at"]) {
    if (typeof evidence[field] !== "string" || evidence[field].length === 0) {
      return refuse(CODES.MALFORMED_EVIDENCE,
        `evidence.${field} must be a non-empty authenticated identity`, { field });
    }
  }
  if (!Number.isInteger(evidence.attempt) || evidence.attempt < 0) {
    return refuse(CODES.MALFORMED_EVIDENCE,
      "evidence.attempt must be a non-negative integer attempt identity", { field: "attempt" });
  }
  for (const field of ["source_digest", "result_digest"]) {
    if (typeof evidence[field] !== "string" || !DIGEST_RE.test(evidence[field])) {
      return refuse(CODES.MALFORMED_EVIDENCE,
        `evidence.${field} must be a canonical sha256 digest`, { field });
    }
  }
  if (typeof evidence.contained !== "boolean") {
    return refuse(CODES.MALFORMED_EVIDENCE,
      "evidence.contained must be the owner's boolean containment outcome",
      { field: "contained" });
  }
  return null;
}

function admitEvidenceConsistency(evidence) {
  for (const [field, label] of [
    ["frozen_write_scope", "evidence.frozen_write_scope"],
    ["changed_paths", "evidence.changed_paths"],
    ["outside_write_scope_paths", "evidence.outside_write_scope_paths"],
    ["inside_write_scope_paths", "evidence.inside_write_scope_paths"]
  ]) {
    const defect = populationDefect(evidence[field], label);
    if (defect !== null) {
      return refuse(CODES.POPULATION_NONCANONICAL, defect, { population: field });
    }
  }
  for (const [countField, populationField] of [
    ["changed_path_count", "changed_paths"],
    ["outside_write_scope_path_count", "outside_write_scope_paths"],
    ["inside_write_scope_path_count", "inside_write_scope_paths"]
  ]) {
    if (evidence[countField] !== evidence[populationField].length) {
      return refuse(CODES.POPULATION_INCONSISTENT,
        `evidence.${countField} disagrees with the length of ${populationField}`, {
          population: populationField,
          declared: diagnosticScalar(evidence[countField]),
          actual: evidence[populationField].length
        });
    }
  }
  const changed = new Set(evidence.changed_paths);
  const outsideStray = evidence.outside_write_scope_paths.find((entry) => !changed.has(entry));
  if (outsideStray !== undefined) {
    return refuse(CODES.POPULATION_INCONSISTENT,
      "evidence.outside_write_scope_paths names a path absent from changed_paths",
      { population: "outside_write_scope_paths", path: outsideStray });
  }
  const insideStray = evidence.inside_write_scope_paths.find((entry) => !changed.has(entry));
  if (insideStray !== undefined) {
    return refuse(CODES.POPULATION_INCONSISTENT,
      "evidence.inside_write_scope_paths names a path absent from changed_paths",
      { population: "inside_write_scope_paths", path: insideStray });
  }
  const outside = new Set(evidence.outside_write_scope_paths);
  const inside = new Set(evidence.inside_write_scope_paths);
  const overlap = evidence.inside_write_scope_paths.find((entry) => outside.has(entry));
  if (overlap !== undefined) {
    return refuse(CODES.POPULATION_INCONSISTENT,
      "a changed path is reported both inside and outside the frozen write scope",
      { path: overlap });
  }
  const unpartitioned = evidence.changed_paths.find((entry) =>
    !outside.has(entry) && !inside.has(entry));
  if (unpartitioned !== undefined) {
    return refuse(CODES.POPULATION_INCONSISTENT,
      "a changed path is reported neither inside nor outside the frozen write scope",
      { path: unpartitioned });
  }
  if (evidence.contained !== (evidence.outside_write_scope_paths.length === 0)) {
    return refuse(CODES.POPULATION_INCONSISTENT,
      "the containment outcome disagrees with the outside-write-scope population", {
        contained: evidence.contained,
        outside_write_scope_path_count: evidence.outside_write_scope_paths.length
      });
  }
  return null;
}

function verifiedResult(evidence, evidenceDigest) {
  return deepFreeze({
    schema_version: WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION,
    verified: true,
    profile_id: WRITE_CONFINEMENT_PROFILE_ID,
    profile_version: WRITE_CONFINEMENT_PROFILE_VERSION,
    evidence_schema_version: WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
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
      evidence_digest: evidenceDigest
    },
    populations: {
      contained: evidence.contained,
      frozen_write_scope: [...evidence.frozen_write_scope],
      changed_paths: [...evidence.changed_paths],
      inside_write_scope_paths: [...evidence.inside_write_scope_paths],
      outside_write_scope_paths: [...evidence.outside_write_scope_paths],
      changed_path_count: evidence.changed_path_count,
      inside_write_scope_path_count: evidence.inside_write_scope_path_count,
      outside_write_scope_path_count: evidence.outside_write_scope_path_count
    },
    refusal: null
  });
}

function verifyWriteConfinementEvidence(evidence) {
  const shapeRefusal = admitEvidenceShape(evidence);
  if (shapeRefusal !== null) return shapeRefusal;
  const consistencyRefusal = admitEvidenceConsistency(evidence);
  if (consistencyRefusal !== null) return consistencyRefusal;
  return verifiedResult(evidence, null);
}

function verifyWriteConfinementProjection(projection) {
  const envelopeRefusal = admitEnvelope(projection);
  if (envelopeRefusal !== null) return envelopeRefusal;
  const evidence = projection.evidence;
  const shapeRefusal = admitEvidenceShape(evidence);
  if (shapeRefusal !== null) return shapeRefusal;
  const consistencyRefusal = admitEvidenceConsistency(evidence);
  if (consistencyRefusal !== null) return consistencyRefusal;
  return verifiedResult(evidence, projection.evidence_digest);
}

export {
  WRITE_CONFINEMENT_EVIDENCE_SCHEMA_VERSION,
  WRITE_CONFINEMENT_PROFILE_ID,
  WRITE_CONFINEMENT_PROFILE_VERSION,
  WRITE_CONFINEMENT_VERIFICATION_REFUSAL_CODES,
  WRITE_CONFINEMENT_VERIFICATION_SCHEMA_VERSION,
  verifyWriteConfinementEvidence,
  verifyWriteConfinementProjection
};
