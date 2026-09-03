

import { createHash } from "node:crypto";

import { TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2 } from "@agent-chassis/controlled-contract";

import {
  TEST_PROOF_ATTEMPT_AUTHORITY,
  canonicalTestProofEvidenceJson,
  digestTestProofEvidence,
  projectTestProofRuntimeEvidenceReceipt
} from "./workspace-agent-test-proof-evidence.mjs";
import {
  TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
  assertLauncherTestProofAttemptContext
} from "./workspace-agent-test-proof-runtime-identity.mjs";

export const BEHAVIORAL_PRESERVATION_PAIR_SCHEMA_VERSION =
  "workspace-agent-behavioral-preservation-pair.v1";
export const BEHAVIORAL_PRESERVATION_PAIR_EVIDENCE_SCHEMA_VERSION =
  "workspace-agent-behavioral-preservation-pair-evidence.v1";
export const BEHAVIORAL_PRESERVATION_PAIR_AUTHORITY = "advisory_paired_evidence_facts";
export const BEHAVIORAL_PRESERVATION_PUBLICATION_SCHEMA_VERSION =
  "workspace-agent-behavioral-preservation-publication.v1";

export const BEHAVIORAL_PRESERVATION_PAIR_POSITIONS = Object.freeze([
  "baseline",
  "candidate"
]);

export const BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS = Object.freeze([
  "wk_id",
  "selected_unit",
  "controlled_contract_generation",
  "verification_id",
  "command_id"
]);

const SIDE_MEMBERS = Object.freeze(["context", "attempt"]);

export const BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES = Object.freeze({
  INPUT_MALFORMED: "behavioral_preservation_pair.input_malformed.v1",
  INPUT_ONE_SIDED: "behavioral_preservation_pair.input_one_sided.v1",
  INPUT_OVER_BOUND: "behavioral_preservation_pair.input_over_bound.v1",
  SIDE_MEMBER_MISSING: "behavioral_preservation_pair.side_member_missing.v1",
  SIDE_IDENTITY_MISMATCH: "behavioral_preservation_pair.side_identity_mismatch.v1",
  SIDE_DUPLICATE: "behavioral_preservation_pair.side_duplicate.v1",
  INVARIANT_INEQUALITY: "behavioral_preservation_pair.invariant_inequality.v1",
  CROSS_BOUNDARY_BINDING: "behavioral_preservation_pair.cross_boundary_binding.v1",
  ASSEMBLY_UNSUPPORTED: "behavioral_preservation_pair.assembly_unsupported.v1",
  EVIDENCE_UNTRUSTED: "behavioral_preservation_pair.evidence_untrusted.v1"
});

export const BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES = Object.freeze({
  INPUT_MALFORMED: "behavioral_preservation_publication.input_malformed.v1",
  INPUT_OVER_BOUND: "behavioral_preservation_publication.input_over_bound.v1",
  REPORT_INVALID: "behavioral_preservation_publication.report_invalid.v1",
  REPORT_MISBOUND: "behavioral_preservation_publication.report_misbound.v1",
  PUBLICATION_UNTRUSTED: "behavioral_preservation_publication.untrusted.v1"
});

const TRUSTED_PAIR_EVIDENCE = new WeakSet();
const TRUSTED_BEHAVIORAL_PUBLICATIONS = new WeakSet();

export class BehavioralPreservationPairError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "BehavioralPreservationPairError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new BehavioralPreservationPairError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertExactKeys(value, allowed, { malformed, missing, overBound, subject }) {
  if (!isObject(value)) fail(malformed, `${subject} must be one object`, { subject });
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(overBound,
      `${subject} accepts exactly {${allowed.join(",")}}; caller-supplied ${key} is refused`,
      { subject, unexpected_key: key });
  }
  for (const key of allowed) {
    if (value[key] === undefined || value[key] === null) fail(missing,
      `${subject} requires ${key}`, { subject, missing_key: key });
  }
  return value;
}

function resolveSide(position, bundle) {
  assertExactKeys(bundle, SIDE_MEMBERS, {
    malformed: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_MALFORMED,
    missing: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.SIDE_MEMBER_MISSING,
    overBound: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_OVER_BOUND,
    subject: `${position} side bundle`
  });
  const context = assertLauncherTestProofAttemptContext(bundle.context);
  const receipt = projectTestProofRuntimeEvidenceReceipt(bundle.attempt);
  const evidence = bundle.attempt.evidence;
  if (context.schema_version !== TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION ||
      evidence.schema_version !== TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2 ||
      evidence.authority !== TEST_PROOF_ATTEMPT_AUTHORITY ||
      receipt.authority !== TEST_PROOF_ATTEMPT_AUTHORITY) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.ASSEMBLY_UNSUPPORTED,
    "pair assembly supports only the current authenticated runtime-evidence family", {
      position,
      context_schema_version: context.schema_version ?? null,
      evidence_schema_version: evidence.schema_version ?? null
    });

  const { evidence_id: evidenceId, ...attemptIdentity } = receipt.evidence_identity;
  if (typeof evidenceId !== "string" || evidenceId === "" ||
      canonicalTestProofEvidenceJson(attemptIdentity) !==
      canonicalTestProofEvidenceJson(context.evidence_identity)) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.SIDE_IDENTITY_MISMATCH,
    "the authenticated attempt identity is not the identity its bound context minted",
    { position });
  const authority = context.authority;
  if (authority.wk_id !== attemptIdentity.wk_id ||
      authority.selected_unit !== attemptIdentity.selected_unit ||
      typeof authority.main_repo !== "string" || authority.main_repo === "") fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.CROSS_BOUNDARY_BINDING,
    "the side's launcher authority does not bind the same repository, WK, and unit",
    { position });
  return { position, context, receipt, evidence, identity: attemptIdentity };
}

function sideBinding(side) {
  return {
    position: side.position,
    run_id: side.identity.run_id,
    attempt: side.identity.attempt,
    source_snapshot_digest: side.identity.source_snapshot_digest,
    test_id: side.identity.test_id,
    command_target: side.identity.command_target,
    evidence_id: side.receipt.evidence_identity.evidence_id,
    evidence_digest: side.receipt.evidence_digest,
    inventory_change_count: side.receipt.inventory_change_count,
    artifacts: side.evidence.artifacts.map(
      ({ artifact_id: artifactId, kind, digest }) => ({ artifact_id: artifactId, kind, digest })
    )
  };
}

export function buildBehavioralPreservationEvidencePair(input) {
  if (arguments.length > 1) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_OVER_BOUND,
    "pair assembly accepts exactly one ordered two-side input");
  assertExactKeys(input, BEHAVIORAL_PRESERVATION_PAIR_POSITIONS, {
    malformed: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_MALFORMED,
    missing: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_ONE_SIDED,
    overBound: BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INPUT_OVER_BOUND,
    subject: "pair input"
  });
  const sides = BEHAVIORAL_PRESERVATION_PAIR_POSITIONS.map(
    (position) => resolveSide(position, input[position])
  );
  const [baseline, candidate] = sides;

  if (baseline.receipt.evidence_digest === candidate.receipt.evidence_digest &&
      canonicalTestProofEvidenceJson(baseline.identity) ===
      canonicalTestProofEvidenceJson(candidate.identity)) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.SIDE_DUPLICATE,
    "an ordered pair requires two distinct authenticated receipt identities",
    { evidence_digest: baseline.receipt.evidence_digest });
  for (const field of BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS) {
    if (baseline.identity[field] !== candidate.identity[field]) fail(
      BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.INVARIANT_INEQUALITY,
      `paired sides must share the authenticated ${field}`, {
        invariant: field,
        baseline: baseline.identity[field] ?? null,
        candidate: candidate.identity[field] ?? null
      });
  }
  const repository = baseline.context.authority.main_repo;
  if (repository !== candidate.context.authority.main_repo) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.CROSS_BOUNDARY_BINDING,
    "paired sides must be bound to one repository", {
      baseline: repository,
      candidate: candidate.context.authority.main_repo
    });
  const body = {
    schema_version: BEHAVIORAL_PRESERVATION_PAIR_EVIDENCE_SCHEMA_VERSION,
    authority: BEHAVIORAL_PRESERVATION_PAIR_AUTHORITY,
    repository,
    shared_invariants: Object.fromEntries(BEHAVIORAL_PRESERVATION_PAIR_INVARIANTS.map(
      (field) => [field, baseline.identity[field]]
    )),
    sides: sides.map(sideBinding)
  };

  const pairEvidence = deepFreeze({
    ...body,
    pair_identity: { pair_id: `pair-${digestTestProofEvidence(body).slice("sha256:".length)}` }
  });
  const pairBytes = canonicalTestProofEvidenceJson(pairEvidence);
  const pair = Object.freeze({
    schema_version: BEHAVIORAL_PRESERVATION_PAIR_SCHEMA_VERSION,
    pair_id: pairEvidence.pair_identity.pair_id,
    pair_evidence: pairEvidence,
    body_bytes: pairBytes,
    body_digest: digestTestProofEvidence(pairEvidence),
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    proof_credit_effect: "none",
    applicability_effect: "none",
    behavioral_equivalence_effect: "none",
    business_semantic_effect: "none",
    policy_effect: "none"
  });
  TRUSTED_PAIR_EVIDENCE.add(pair);
  return pair;
}

export function assertBehavioralPreservationEvidencePair(pair) {
  if (!isObject(pair) || !Object.isFrozen(pair) || !TRUSTED_PAIR_EVIDENCE.has(pair) ||
      pair.schema_version !== BEHAVIORAL_PRESERVATION_PAIR_SCHEMA_VERSION) fail(
    BEHAVIORAL_PRESERVATION_PAIR_REFUSAL_CODES.EVIDENCE_UNTRUSTED,
    "pair projection requires one launcher-assembled pair evidence object");
  return pair;
}

const REPORT_FIELDS = Object.freeze([
  "evidence_id", "evidence_digest", "relative_path", "report_bytes", "report_digest"
]);

function digestUtf8(bytes) {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function projectBehavioralReport(pair, position, report) {
  const CODES = BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES;
  assertExactKeys(report, REPORT_FIELDS, {
    malformed: CODES.INPUT_MALFORMED,
    missing: CODES.REPORT_INVALID,
    overBound: CODES.INPUT_OVER_BOUND,
    subject: `${position} behavioral observable report`
  });
  const binding = pair.pair_evidence.sides.find((side) => side.position === position);
  if (binding === undefined || report.evidence_id !== binding.evidence_id ||
      report.evidence_digest !== binding.evidence_digest) {
    fail(CODES.REPORT_MISBOUND,
      `${position} behavioral observable report is not bound to its ordered pair side`,
      { position });
  }
  if (typeof report.relative_path !== "string" || report.relative_path.length === 0 ||
      typeof report.report_bytes !== "string" ||
      typeof report.report_digest !== "string" ||
      digestUtf8(report.report_bytes) !== report.report_digest) {
    fail(CODES.REPORT_INVALID,
      `${position} behavioral observable report bytes or digest are invalid`, { position });
  }
  let parsed;
  try {
    parsed = JSON.parse(report.report_bytes);
  } catch {
    fail(CODES.REPORT_INVALID,
      `${position} behavioral observable report is not parseable`, { position });
  }
  if (!isObject(parsed)) {
    fail(CODES.REPORT_INVALID,
      `${position} behavioral observable report is not one report object`, { position });
  }
  return deepFreeze(structuredClone(report));
}

export function buildBehavioralPreservationPublication(input) {
  const CODES = BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES;
  if (arguments.length > 1) fail(CODES.INPUT_OVER_BOUND,
    "behavioral publication accepts exactly one owner input");
  assertExactKeys(input, ["pair", "baselineReport", "candidateReport"], {
    malformed: CODES.INPUT_MALFORMED,
    missing: CODES.INPUT_MALFORMED,
    overBound: CODES.INPUT_OVER_BOUND,
    subject: "behavioral publication input"
  });
  const pair = assertBehavioralPreservationEvidencePair(input.pair);
  const publication = deepFreeze({
    schema_version: BEHAVIORAL_PRESERVATION_PUBLICATION_SCHEMA_VERSION,
    pair,
    reports: {
      baseline: projectBehavioralReport(pair, "baseline", input.baselineReport),
      candidate: projectBehavioralReport(pair, "candidate", input.candidateReport)
    }
  });
  TRUSTED_BEHAVIORAL_PUBLICATIONS.add(publication);
  return publication;
}

export function assertBehavioralPreservationPublication(publication) {
  if (!isObject(publication) || !Object.isFrozen(publication) ||
      !TRUSTED_BEHAVIORAL_PUBLICATIONS.has(publication) ||
      publication.schema_version !== BEHAVIORAL_PRESERVATION_PUBLICATION_SCHEMA_VERSION) {
    fail(BEHAVIORAL_PRESERVATION_PUBLICATION_REFUSAL_CODES.PUBLICATION_UNTRUSTED,
      "behavioral receipt publication requires one owner-issued projection envelope");
  }
  return publication;
}
