import { createHash } from "node:crypto";

import {
  STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS,
  classifyStableTestProofRuntimeReadiness,
  resolveStableTestProofProviderBindings,
  validateStableTestProofContract
} from "@agent-chassis/controlled-contract";

import { validateObligationCoverageCarrier } from
  "../../../../controlled-contract/lib/obligation-coverage-carrier.mjs";
import { assertAdmittedProofPackSnapshot } from
  "../../../../controlled-contract/lib/admitted-proof-packs.mjs";
import {
  projectWorkRecordTestProofValidation,
  resolveAuthorizedDeclaredTestTarget
} from
  "../../lib/work-record-test-proof-bindings.mjs";

const PUBLIC_KEYS = new Set(["git_sha", "repo", "subject"]);
const FORBIDDEN_AUTHORITY_KEYS = Object.freeze([
  "verification_id", "target", "command", "environment", "path", "root", "unit",
  "provider", "evaluator", "candidate", "receipt", "receipts", "policy", "authority"
]);
const ELIGIBLE_ROLES = new Set(["orchestrator", "reviewer", "worker"]);
const EXACT_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const RESOLUTION_SCHEMA_VERSION =
  "controlled-contract-verify-proof-population-resolution.v1";

const READINESS_REASON_CODES = Object.freeze({
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_INVENTORY]:
    "verify_proof.runtime_test_inventory_missing.v1",
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_SELECTION]:
    "verify_proof.runtime_test_selection_missing.v1",
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.INVALID_SELECTION]:
    "verify_proof.runtime_test_selection_invalid.v1"
});

class VerifyProofOperationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VerifyProofOperationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

const compare = (left, right) => String(left).localeCompare(String(right));

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex")}`;
}

function assertVerifyProofCallerShape(args, { authenticatedRole } = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new VerifyProofOperationError(
    "verify_proof.input_invalid.v1", "verify_proof input must be an object"
  );
  const unsupported = Object.keys(args).filter((key) => !PUBLIC_KEYS.has(key));
  const authority = unsupported.filter((key) => FORBIDDEN_AUTHORITY_KEYS.includes(key));
  if (unsupported.length > 0) throw new VerifyProofOperationError(
    authority.length > 0 ? "verify_proof.caller_authority_forbidden.v1"
      : "verify_proof.input_invalid.v1",
    "verify_proof accepts one canonical subject plus optional repository and orchestrator git_sha",
    { unsupported_keys: unsupported.sort() }
  );
  if (typeof args.subject !== "string" || args.subject.length === 0 ||
      args.subject.length > 512) throw new VerifyProofOperationError(
    "verify_proof.subject_invalid.v1", "subject is required and must be a bounded canonical identity"
  );
  if (!ELIGIBLE_ROLES.has(authenticatedRole)) throw new VerifyProofOperationError(
    "verify_proof.role_ineligible.v1",
    "verify_proof requires an authenticated eligible session role"
  );
  if (Object.hasOwn(args, "git_sha")) {
    if (authenticatedRole !== "orchestrator") throw new VerifyProofOperationError(
      "verify_proof.git_sha_role_forbidden.v1",
      "only an authenticated orchestrator may select an exact Git commit"
    );
    if (typeof args.git_sha !== "string" || !EXACT_GIT_OBJECT_ID_RE.test(args.git_sha) ||
        /^0+$/u.test(args.git_sha)) throw new VerifyProofOperationError(
      "verify_proof.git_sha_invalid.v1",
      "git_sha must be one complete lowercase hexadecimal Git object identity"
    );
  }
}

function notExecutable({ subject, kind = null, wkId = null, generation = null,
  reasonCode, diagnostics = [] }) {
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION,
    status: "not_executable",
    authority: "non_authoritative",
    subject: { requested: subject, kind, canonical_id: kind === null ? null : subject },
    wk_id: wkId,
    contract_generation: generation,
    reason_code: reasonCode,
    diagnostics: structuredClone(diagnostics),
    proof_count: 0,
    relationship_count: 0,
    proofs: []
  });
}

function subjectMatches(subject, context) {
  const record = context.workRecord;
  const matches = [];
  if (record?.id === subject) matches.push({ kind: "wk", value: record });
  for (const slice of record?.slices ?? []) {
    if (`${record.id}#${slice.id}` === subject) matches.push({ kind: "slice", value: slice });
  }
  for (const proof of context.controlledContract?.test_proofs ?? []) {
    if (proof?.test_proof_id === subject) matches.push({ kind: "test_proof", value: proof });
  }
  for (const obligation of context.obligationCoverage?.obligations ?? []) {
    if (obligation?.obligation_id === subject) matches.push({ kind: "obligation", value: obligation });
  }
  return matches;
}

function graphForObligation(row, contract) {
  const claims = new Map((contract.claims ?? []).map((claim) => [claim.claim_id, claim]));
  const named = new Set(row.controlled_contract_node_ids ?? []);
  const explicitBehaviors = [...named].filter((id) => claims.get(id)?.kind === "behavior");
  const explicitVerifications = [...named].filter((id) =>
    claims.get(id)?.kind === "verification" &&
    claims.get(id)?.verification_method === "test_execution");
  const candidates = (contract.relations ?? []).filter((relation) =>
    relation.role === "verifies" && (named.has(relation.relation_id) ||
      named.has(relation.target_claim_id) || named.has(relation.source_claim_id)));
  const behaviorIds = [...new Set([
    ...explicitBehaviors,
    ...candidates.map(({ target_claim_id: id }) => id)
      .filter((id) => claims.get(id)?.kind === "behavior")
  ])].sort(compare);
  const verificationIds = [...new Set([
    ...explicitVerifications,
    ...candidates.filter((relation) => behaviorIds.includes(relation.target_claim_id) &&
      claims.get(relation.source_claim_id)?.kind === "verification" &&
      claims.get(relation.source_claim_id)?.verification_method === "test_execution")
      .map(({ source_claim_id: id }) => id)
  ])].sort(compare);
  return {
    behaviorIds,
    verificationIds,
    relationIds: candidates.filter((relation) =>
      behaviorIds.includes(relation.target_claim_id) &&
      verificationIds.includes(relation.source_claim_id))
      .map(({ relation_id: id }) => id).sort(compare)
  };
}

function planEntriesFor(row, proofPlan) {
  if (row?.proof?.kind !== "pack_mapping") return [];
  return (proofPlan?.packs ?? []).filter((entry) =>
    entry.profile_id === row.proof.profile_id &&
    entry.profile_version === row.proof.profile_version &&
    entry.requested_intents?.includes(row.proof.requested_intent));
}

function allRelationships(context) {
  const proofByVerification = new Map();
  for (const proof of context.controlledContract.test_proofs) {
    const id = proof.verification_claim_id;
    const population = proofByVerification.get(id) ?? [];
    population.push(proof);
    proofByVerification.set(id, population);
  }
  const relationships = [];
  for (const obligation of context.obligationCoverage.obligations) {
    if (obligation.mechanism?.kind !== "test" || obligation.proof?.kind !== "pack_mapping") {
      continue;
    }
    const graph = graphForObligation(obligation, context.controlledContract);
    for (const verificationId of graph.verificationIds) {
      for (const proof of proofByVerification.get(verificationId) ?? []) relationships.push({
        obligation,
        proof,
        verification_id: verificationId,
        behavior_claim_ids: graph.behaviorIds,
        relation_ids: graph.relationIds,
        plan_entries: planEntriesFor(obligation, context.proofPlan)
      });
    }
  }
  return relationships.sort((left, right) =>
    compare(left.proof.test_proof_id, right.proof.test_proof_id) ||
    compare(left.obligation.obligation_id, right.obligation.obligation_id));
}

function validationVerificationIds(unit) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit: unit });
  return projection.status === "valid"
    ? [...new Set(projection.executable_declarations.flatMap(
      ({ verification_ids: ids }) => ids))].sort(compare)
    : [];
}

function selectedProofs(match, context, relationships) {
  const all = context.controlledContract.test_proofs;
  if (match.kind === "wk") return [...all];
  if (match.kind === "slice") {
    const ids = new Set(validationVerificationIds(match.value));
    return all.filter((proof) => ids.has(proof.verification_claim_id));
  }
  if (match.kind === "test_proof") return [match.value];
  const obligationId = match.value.obligation_id;
  return relationships.filter(({ obligation }) => obligation.obligation_id === obligationId)
    .map(({ proof }) => proof);
}

function readinessDetails(readiness, verificationId, wkId) {
  const candidates = readiness.current_test_ids.slice(0, 16);
  return {
    readiness_reason: readiness.reason,
    verification_id: verificationId,
    selected_test_id: readiness.selected_test_id,
    candidate_test_ids: candidates,
    candidate_total: readiness.candidate_total,
    candidate_test_ids_omitted: readiness.candidate_total - candidates.length,
    authority_limb: "mechanical_failure",
    admissibility_effect: "none",
    recovery_operation: "workspace_controlled_test_proof_patch",
    complete_retrieval: {
      tool: "workspace_controlled_test_proof_query",
      arguments: { wk_id: wkId, verification_ids: [verificationId] }
    }
  };
}

function assertContext(context) {
  if (!context || typeof context !== "object") throw new VerifyProofOperationError(
    "verify_proof.server_context_unavailable.v1",
    "verify_proof requires server-resolved canonical context"
  );
  const wkId = context.workRecord?.id;
  if (typeof wkId !== "string" || context.obligationCoverage?.wk_id !== wkId ||
      (context.contractWkId !== undefined && context.contractWkId !== wkId) ||
      !DIGEST_RE.test(context.contractGeneration ?? "")) throw new VerifyProofOperationError(
    "verify_proof.contract_generation_mismatch.v1",
    "canonical work record, relationship carriers, and contract generation are cross-bound",
    { work_record_id: wkId ?? null, obligation_coverage_wk_id:
      context.obligationCoverage?.wk_id ?? null, contract_wk_id: context.contractWkId ?? null }
  );
  const contractValidation = validateStableTestProofContract(context.controlledContract);
  if (!contractValidation.valid) throw new VerifyProofOperationError(
    "verify_proof.controlled_contract_invalid.v1",
    "canonical controlled contract is invalid", { diagnostics: contractValidation.diagnostics }
  );
  const coverageValidation = validateObligationCoverageCarrier(context.obligationCoverage);
  if (!coverageValidation.valid) throw new VerifyProofOperationError(
    "verify_proof.obligation_coverage_invalid.v1",
    "canonical obligation coverage is invalid", { diagnostics: coverageValidation.diagnostics }
  );
  return wkId;
}

function resolveVerifyProofOperation({ args, context }) {
  assertVerifyProofCallerShape(args, { authenticatedRole: context?.authenticatedRole });
  const wkId = assertContext(context);
  const matches = subjectMatches(args.subject, context);
  if (matches.length === 0) return notExecutable({
    subject: args.subject,
    wkId,
    generation: context.contractGeneration,
    reasonCode: "verify_proof.subject_unknown.v1",
    diagnostics: [{ recovery_operation: "workspace_controlled_test_proof_query" }]
  });
  if (matches.length !== 1) throw new VerifyProofOperationError(
    "verify_proof.subject_ambiguous.v1",
    "subject matches more than one canonical identity",
    { subject: args.subject, match_kinds: matches.map(({ kind }) => kind).sort() }
  );
  const [match] = matches;
  const relationships = allRelationships(context);
  const selected = selectedProofs(match, context, relationships);
  const unique = new Map();
  for (const proof of selected) {
    const existing = unique.get(proof.test_proof_id);
    if (existing && existing.verification_claim_id !== proof.verification_claim_id) {
      throw new VerifyProofOperationError(
        "verify_proof.test_proof_identity_ambiguous.v1",
        "one test proof identity is bound to multiple verifications",
        { test_proof_id: proof.test_proof_id }
      );
    }
    unique.set(proof.test_proof_id, proof);
  }
  const proofs = [...unique.values()].sort((left, right) =>
    compare(left.test_proof_id, right.test_proof_id));
  if (proofs.length === 0) return notExecutable({
    subject: args.subject,
    kind: match.kind,
    wkId,
    generation: context.contractGeneration,
    reasonCode: "verify_proof.proof_population_empty.v1",
    diagnostics: [{ recovery_operation: "workspace_controlled_test_proof_patch" }]
  });

  const diagnostics = [];
  const resolvedProofs = proofs.map((proof) => {
    const proofRelationships = relationships.filter(({ proof: related }) =>
      related.test_proof_id === proof.test_proof_id);
    const readiness = classifyStableTestProofRuntimeReadiness(proof);
    if (readiness.status !== "ready") diagnostics.push({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_claim_id,
      reason_code: READINESS_REASON_CODES[readiness.reason],
      details: readinessDetails(readiness, proof.verification_claim_id, wkId)
    });
    try {
      resolveStableTestProofProviderBindings(proof);
    } catch (error) {
      diagnostics.push({ test_proof_id: proof.test_proof_id,
        verification_id: proof.verification_claim_id,
        reason_code: "verify_proof.provider_binding_invalid.v1",
        details: { package_code: error?.code ?? null } });
    }
    const target = resolveAuthorizedDeclaredTestTarget({
      workRecord: context.workRecord,
      selectedUnit: context.selectedUnit,
      reviewedTargetBinding: context.reviewedTargetBinding ?? null,
      orchestrator: context.authenticatedRole === "orchestrator",
      verificationId: proof.verification_claim_id,
      controlledContractGeneration: context.contractGeneration,
      sourceSnapshotDigest: context.sourceSnapshotDigest ?? null
    });
    if (target.status !== "resolved") diagnostics.push({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_claim_id,
      reason_code: target.reason_code ?? "verify_proof.declared_target_invalid.v1",
      details: { target_status: target.status, diagnostics: target.diagnostics ?? [] }
    });
    if (proofRelationships.length === 0) diagnostics.push({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_claim_id,
      reason_code: "verify_proof.obligation_relationship_missing.v1",
      details: {}
    });
    const projectedRelationships = proofRelationships.map((relationship) => {
      if (relationship.plan_entries.length !== 1) diagnostics.push({
        test_proof_id: proof.test_proof_id,
        verification_id: proof.verification_claim_id,
        obligation_id: relationship.obligation.obligation_id,
        reason_code: relationship.plan_entries.length === 0
          ? "verify_proof.proof_plan_entry_missing.v1"
          : "verify_proof.proof_plan_entry_ambiguous.v1",
        details: { count: relationship.plan_entries.length }
      });
      return {
        obligation_id: relationship.obligation.obligation_id,
        obligation: structuredClone(relationship.obligation),
        behavior_claim_ids: [...relationship.behavior_claim_ids],
        relation_ids: [...relationship.relation_ids],
        proof_plan_entry: relationship.plan_entries.length === 1
          ? structuredClone(relationship.plan_entries[0]) : null,
        proof_plan_entry_digest: relationship.plan_entries.length === 1
          ? canonicalDigest(relationship.plan_entries[0]) : null
      };
    }).sort((left, right) => compare(left.obligation_id, right.obligation_id));
    return {
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_claim_id,
      test_proof: structuredClone(proof),
      declared_target: structuredClone(target),
      relationships: projectedRelationships
    };
  });
  if (context.postDeliveryPack === null || context.postDeliveryPack === undefined) {
    diagnostics.push({ reason_code: "verify_proof.post_delivery_pack_unavailable.v1",
      details: {} });
  } else {
    assertAdmittedProofPackSnapshot(context.postDeliveryPack);
    if (context.postDeliveryPack.evaluation_stage !== "post_delivery" ||
        context.postDeliveryPack.test_validity_evaluator?.status !== "resolved") {
      diagnostics.push({ reason_code: "verify_proof.evaluator_unavailable.v1", details: {} });
    }
    for (const proof of resolvedProofs) for (const relationship of proof.relationships) {
      if (relationship.obligation.proof.profile_id !==
          context.postDeliveryPack.profile.profile_id) diagnostics.push({
        test_proof_id: proof.test_proof_id,
        verification_id: proof.verification_id,
        obligation_id: relationship.obligation_id,
        reason_code: "verify_proof.post_delivery_pack_binding_mismatch.v1",
        details: { profile_id: relationship.obligation.proof.profile_id }
      });
    }
  }
  diagnostics.sort((left, right) => compare(
    `${left.test_proof_id ?? ""}:${left.obligation_id ?? ""}:${left.reason_code}`,
    `${right.test_proof_id ?? ""}:${right.obligation_id ?? ""}:${right.reason_code}`
  ));
  if (diagnostics.length > 0) return deepFreeze({
    ...notExecutable({ subject: args.subject, kind: match.kind, wkId,
      generation: context.contractGeneration,
      reasonCode: "verify_proof.population_not_ready.v1", diagnostics }),
    proof_count: resolvedProofs.length,
    relationship_count: resolvedProofs.reduce((total, proof) =>
      total + proof.relationships.length, 0),
    proofs: resolvedProofs
  });
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION,
    status: "executable",
    authority: "non_authoritative",
    subject: { requested: args.subject, kind: match.kind, canonical_id: args.subject },
    wk_id: wkId,
    contract_generation: context.contractGeneration,
    contract_digest: context.contractDigest,
    obligation_coverage_digest: context.obligationCoverageDigest,
    proof_plan_digest: context.proofPlanDigest,
    post_delivery_pack: context.postDeliveryPack,
    proof_count: resolvedProofs.length,
    relationship_count: resolvedProofs.reduce((total, proof) =>
      total + proof.relationships.length, 0),
    proofs: resolvedProofs
  });
}

export {
  FORBIDDEN_AUTHORITY_KEYS as VERIFY_PROOF_FORBIDDEN_AUTHORITY_KEYS,
  RESOLUTION_SCHEMA_VERSION as VERIFY_PROOF_POPULATION_RESOLUTION_SCHEMA_VERSION,
  VerifyProofOperationError,
  assertVerifyProofCallerShape,
  resolveVerifyProofOperation
};
