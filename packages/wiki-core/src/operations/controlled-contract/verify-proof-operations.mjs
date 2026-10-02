import { deepFreeze, canonicalDigest } from "@agent-chassis/controlled-contract";

import {
  buildStableTestProofRecoveryCall,
  resolveStableTestProofProviderBindings
} from "@agent-chassis/controlled-contract";
import { TEST_RUNTIME_ENVIRONMENT_ID_RE } from "@agent-chassis/controlled-contract/test-proof";

import { assertProofAuthoringDraft } from "@agent-chassis/controlled-contract";
import { prepareProofObligationRuntime, PROOF_OBLIGATION_NOT_EXECUTABLE_CODES,
  ProofObligationResolutionError, resolveProofObligationRuntime } from
  "@agent-chassis/controlled-contract";
import {
  resolveAuthorizedDeclaredTestTarget,
  resolveNativeCaseDeclaredTestTarget
} from
  "../../lib/work-record-test-proof-bindings.mjs";
import { controlledContractFocusCause, isControlledContractFocus } from
  "../../lib/controlled-contract-tools.mjs";
import { parseProofSourceUnitAddress as parseProofAuthoringUnitAddress } from "./saved-proof-source.mjs";
import { obligationCoverageQueryCall } from "./coverage-recovery-guidance.mjs";
import { executionTimeoutInputSchema, parseExecutionTimeout } from "../../lib/execution-timeout.mjs";

const PUBLIC_KEYS = new Set(["environment", "git_sha", "repo", "source", "subject", "timeout"]);

const SOURCE_KEYS = new Set(["focus", "unit"]);

const VERIFY_PROOF_TIMEOUT_DESCRIPTION =
  "Optional proof/test execution budget: short=30s, medium=300s (default), long=1800s, or {seconds:N} with integer N in 1..2147483. One monotonic budget starts after canonical proof population and runtime binding resolution and is shared by provider preparation and every candidate, falsifier and traversal attempt; expiry or request cancellation interrupts the active attempt and starts no further attempt.";
const FORBIDDEN_AUTHORITY_KEYS = Object.freeze([
  "verification_id", "target", "command", "path", "root", "unit",
  "provider", "evaluator", "candidate", "receipt", "receipts", "policy", "authority"
]);
const ELIGIBLE_ROLES = new Set(["orchestrator", "reviewer", "worker"]);
const EXACT_GIT_OBJECT_ID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const RESOLUTION_SCHEMA_VERSION =
  "controlled-contract-verify-proof-population-resolution.v3";
const ATTRIBUTABLE_RESOLUTION_FAILURE_CODES = new Set([
  "verify_proof.explicit_relation_disagreement.v1",
  "verify_proof.explicit_verification_disagreement.v1"
]);
const ATTRIBUTABLE_TARGET_INTEGRITY_CODES = new Set([
  "test_proof_declared_target_duplicate",
  "validation_verification_binding_duplicate"
]);

class VerifyProofOperationError extends Error {
  constructor(code, message, details = {}, options = undefined) {
    super(message, options);
    this.name = "VerifyProofOperationError";
    this.code = code;
    this.details = { authority_limb: "mechanical_failure", ...structuredClone(details) };
  }
}

const compare = (a, b) => String(a).localeCompare(String(b));

function verifyProofTimeoutRefusal(message, facts) {
  return new VerifyProofOperationError("verify_proof.timeout_invalid.v1", message, facts);
}

function verifyProofTimeoutInputSchema(z) {
  return executionTimeoutInputSchema(z, VERIFY_PROOF_TIMEOUT_DESCRIPTION);
}

function verifyProofPopulationSubject(subject) {
  try {
    return parseProofAuthoringUnitAddress(subject);
  } catch (error) {
    if (error?.code === "obligation_coverage_unit_invalid") return null;
    throw error;
  }
}

function refuseVerifyProofSource(field, cause, details = {}) {
  throw new VerifyProofOperationError("verify_proof.source_invalid.v1",
    "source must be a closed { unit, focus? } canonical proof-source selection",
    { field, cause, ...details });
}

function parseVerifyProofSource(args) {
  if (!Object.hasOwn(args, "source")) return null;
  const { source } = args;
  if (source === null || typeof source !== "object" || Array.isArray(source) ||
      Object.getPrototypeOf(source) !== Object.prototype) {
    refuseVerifyProofSource("source", "verify_proof.source_not_object.v1");
  }
  const unsupported = Object.keys(source).filter((key) => !SOURCE_KEYS.has(key)).sort();
  if (unsupported.length > 0) refuseVerifyProofSource("source",
    "verify_proof.source_member_unsupported.v1", { unsupported_keys: unsupported });
  if (!Object.hasOwn(source, "unit")) refuseVerifyProofSource("source.unit",
    "verify_proof.source_unit_missing.v1");
  let address;
  try {
    address = parseProofAuthoringUnitAddress(source.unit);
  } catch (error) {
    if (error?.code !== "obligation_coverage_unit_invalid") throw error;
    refuseVerifyProofSource("source.unit", error.code, {
      rejected_type: Array.isArray(source.unit) ? "array" : source.unit === null ? "null" : typeof source.unit });
  }
  if (Object.hasOwn(source, "focus") &&
      (source.focus === null || source.focus === undefined || !isControlledContractFocus(source.focus))) {
    const { cause, ...facts } = controlledContractFocusCause(source.focus);
    refuseVerifyProofSource("source.focus", cause, { ...facts, field: "source.focus" });
  }
  if (verifyProofPopulationSubject(args.subject) !== null) throw new VerifyProofOperationError(
    "verify_proof.source_subject_conflict.v1",
    "source qualifies only an individual saved proof or obligation subject",
    { field: "source", cause: "verify_proof.population_subject_with_source.v1",
      subject: args.subject, source_unit: source.unit });
  return Object.freeze({ unit: source.unit, wkId: address.wkId,
    selectedUnit: address.selectedUnit, focus: source.focus ?? null });
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
    "verify_proof accepts one canonical subject plus optional repository, source, timeout, environment and orchestrator git_sha",
    { unsupported_keys: unsupported.sort() }
  );
  if (typeof args.subject !== "string" || args.subject.length === 0 ||
      args.subject.length > 512) throw new VerifyProofOperationError(
    "verify_proof.subject_invalid.v1", "subject is required and must be a bounded canonical identity"
  );
  if (Object.hasOwn(args, "timeout")) parseExecutionTimeout(args.timeout, verifyProofTimeoutRefusal);
  if (Object.hasOwn(args, "environment") && (typeof args.environment !== "string" ||
      args.environment.length > 512 || !TEST_RUNTIME_ENVIRONMENT_ID_RE.test(args.environment))) {
    throw new VerifyProofOperationError("verify_proof.environment_invalid.v1",
      "environment names one setup-published prepared environment as <ecosystem>@<installation root>",
      { field: "environment", accepted_form: "<ecosystem>@<repository-relative installation root>, e.g. npm@. or python@services/api" });
  }
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
  parseVerifyProofSource(args);
}

function forcedInvocationCoverageDiagnostics(proof, contract) {
  const forced = (proof.falsifiers ?? []).filter(({ strategy }) =>
    strategy === "forced_invocation");
  if (forced.length === 0) return [];
  const propositions = new Map((contract.propositions ?? []).map((entry) =>
    [entry.proposition_id, entry]));
  const references = new Map((contract.references ?? []).map((entry) =>
    [entry.reference_id, entry]));
  const diagnostics = [];
  for (const propositionId of [...new Set(forced.map(({ proposition_id: id }) => id))]
    .sort(compare)) {
    const proposition = propositions.get(propositionId);
    if (proposition?.operator !== "reference:uses") continue;
    const subject = references.get(proposition.subject_reference_id);
    const subjectPath = subject?.identity?.kind === "repository_path"
      ? subject.identity.path : null;
    const operations = (proposition.operands ?? [])
      .filter(({ kind }) => kind === "reference")
      .map(({ reference_id: id }) => references.get(id))
      .filter((reference) => reference?.identity?.kind === "code_symbol");
    const covering = forced.filter((falsifier) => falsifier.proposition_id === propositionId &&
      (subjectPath === null || falsifier.mutation?.module_path === subjectPath));
    const uncovered = operations.filter((reference) => !covering.some((falsifier) =>
      falsifier.mutation?.operation?.module_path === reference.identity.path &&
      falsifier.mutation?.operation?.export_name === reference.identity.symbol));
    if (uncovered.length === 0) continue;
    diagnostics.push({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_claim_id,
      reason_code: "verify_proof.forbidden_operation_falsifier_coverage_incomplete.v1",
      details: {
        proposition_id: propositionId,
        subject_module_path: subjectPath,
        declared_operation_count: operations.length,
        covering_falsifier_ids: covering.map(({ falsifier_id: id }) => id).sort(compare),
        uncovered_operations: uncovered.map((reference) => ({
          reference_id: reference.reference_id,
          module_path: reference.identity.path,
          export_name: reference.identity.symbol
        }))
      }
    });
  }
  return diagnostics;
}

function resolveAttributableProofRuntime(input) {
  try {
    return resolveProofObligationRuntime(input);
  } catch (error) {
    if (!(error instanceof ProofObligationResolutionError)) throw error;
    if (ATTRIBUTABLE_RESOLUTION_FAILURE_CODES.has(error?.code)) return {
      status: "not_executable", reason_code: error.code, details: error.details ?? {}
    };
    if (error?.code === "verify_proof.declared_target_integrity_refused.v1" &&
        error.details?.diagnostics?.length > 0 && error.details.diagnostics.every(
          ({ code }) => ATTRIBUTABLE_TARGET_INTEGRITY_CODES.has(code))) return {
      status: "not_executable",
      reason_code: PROOF_OBLIGATION_NOT_EXECUTABLE_CODES.DECLARED_TARGET_AMBIGUOUS,
      details: error.details
    };
    throw error;
  }
}

function resolveAttributableDeclaredTarget(input) {
  const retain = entry => !Array.isArray(entry?.verification_ids) ||
    entry.verification_ids.includes(input.verificationId);
  const workRecord = {
    ...input.workRecord,
    acceptance: { ...input.workRecord.acceptance,
      validation: (input.workRecord.acceptance?.validation ?? []).filter(retain) },
    slices: (input.workRecord.slices ?? []).map(slice => ({ ...slice,
      acceptance: { ...slice.acceptance,
        validation: (slice.acceptance?.validation ?? []).filter(retain) } }))
  };
  const selectedUnit = input.selectedUnit?.id === workRecord.id ? workRecord :
    workRecord.slices.find(({ id }) => id === input.selectedUnit?.id) ?? input.selectedUnit;
  return resolveAuthorizedDeclaredTestTarget({ ...input, workRecord, selectedUnit });
}

function resolveVerifyProofOperation({ args, context }) {
  assertVerifyProofCallerShape(args, { authenticatedRole: context?.authenticatedRole });
  const wkId = context?.workRecord?.id;
  const source = assertProofAuthoringDraft(context?.obligationCoverage);
  if (source.wk_id !== wkId || context.contractWkId !== wkId ||
      !DIGEST_RE.test(context.contractGeneration ?? '') ||
      !context.executionSourceBinding || !context.authoringResolution) {
    throw new VerifyProofOperationError('verify_proof.contract_generation_mismatch.v1',
      'Saved source, native generation and invocation binding must identify the same candidate');
  }
  const prepared = prepareProofObligationRuntime({ wkId, focus: source.focus,
    obligationCoverage: source, obligationCoverageDigest: context.obligationCoverageDigest,
    controlledContract: context.controlledContract, contractDigest: context.contractDigest,
    contractGeneration: context.contractGeneration });
  const rows = prepared.rows;
  const nodes = new Map(context.authoringResolution.dependencies.map(node => [node.identity, node]));
  const targetArities = new Map();
  for (const declaration of context.testTargetDeclarations.executable_declarations) {
    for (const id of declaration.verification_ids) targetArities.set(id, (targetArities.get(id) ?? 0) + 1);
  }
  const proofs = new Map(), diagnostics = [];
  for (const resolved of context.authoringResolution.rows) {
    const row = rows.get(resolved.obligation_id);
    const graph = context.nativeGraphs.get(row.obligation_id);
    const declaredRelationIds = [...new Set([
      ...(graph?.relationIds ?? []), ...(graph?.explicitRelations ?? [])
    ])].sort(compare);
    const verificationId = graph?.qualifying.length === 1 ? graph.qualifying[0] : null;
    const nativeProofs = verificationId === null ? [] :
      (context.controlledContract.test_proofs ?? []).filter(
        proof => proof.verification_claim_id === verificationId);
    const nativeProof = nativeProofs.length === 1 ? nativeProofs[0] : null;
    const selectedAssessment = resolved.selected_proof_assessment ?? null;
    const testExecutionRequired =
      selectedAssessment?.requirements?.test_execution_evidence === 'required';
    const authoredCaseUnavailable = testExecutionRequired && row.case_id != null &&
      selectedAssessment.authored_case?.status !== 'complete';
    if (!testExecutionRequired || authoredCaseUnavailable) {
      const retainedProblems = resolved.diagnostics ?? [];
      const retainedCategories = new Set(retainedProblems.map(entry =>
        entry.problem?.category));
      const stageOrder = ['authored_inputs', 'canonical_sources', 'system_capability'];
      const unavailableStage = selectedAssessment === null
        ? retainedCategories.has('author_input') ? 'authored_inputs'
          : retainedCategories.has('canonical_source') ? 'canonical_sources'
            : retainedCategories.has('system_capability')
              ? 'system_capability' : 'authored_inputs'
        : stageOrder.find(stage => !['complete', 'current', 'available'].includes(
          selectedAssessment.stages?.[stage]?.status)) ?? 'execution_evidence';
      const stageFacts = selectedAssessment?.stages?.[unavailableStage] ?? null;
      const reasonCode = unavailableStage === 'authored_inputs'
        ? 'verify_proof.author_inputs_unavailable.v1'
        : unavailableStage === 'canonical_sources'
          ? 'verify_proof.canonical_source_unavailable.v1'
          : 'verify_proof.execution_capability_unavailable.v1';
      const diagnostic = { obligation_id: row.obligation_id,
        test_proof_id: nativeProof?.test_proof_id ?? null,
        verification_id: verificationId, reason_code: reasonCode,
        authority_limb: 'mechanical_failure', details: {
          stage: unavailableStage,
          execution_family: selectedAssessment?.execution_family ?? null,
          owner_codes: stageFacts?.diagnostic_codes ?? retainedProblems.map(entry => entry.code),
          responsible_owner: unavailableStage === 'system_capability'
            ? '@agent-chassis/controlled-contract' : null,
          selected_proof_assessment: selectedAssessment,
          retained_diagnostics: retainedProblems,
          path: `/obligations/${source.obligations.indexOf(row)}`,
          resolved_node_identity: resolved.resolved_identity
        } };
      diagnostics.push(diagnostic);
      proofs.set(`unavailable:${row.obligation_id}`, {
        test_proof_id: nativeProof?.test_proof_id ?? null,
        verification_id: verificationId, declared_target: null,
        relationships: [{ obligation_id: row.obligation_id,
          relation_ids: declaredRelationIds,
          selected_definition: resolved.definition,
          resolved_node_identity: resolved.resolved_identity }], failure: diagnostic });
      continue;
    }

    const candidates = context.controlledContract.test_proofs ?? [];

    const nativeCaseTarget = nativeProof?.test_selector?.provider_id !== undefined;
    const ownedTarget = verificationId === null ? null : nativeCaseTarget
      ? resolveNativeCaseDeclaredTestTarget({ verificationId,
        selector: nativeProof.test_selector,
        unit: source.selected_unit === null ? wkId : `${wkId}#${source.selected_unit}`,
        controlledContractGeneration: context.contractGeneration,
        sourceSnapshotDigest: context.sourceSnapshotDigest })
      : resolveAttributableDeclaredTarget({
        workRecord: context.workRecord, selectedUnit: context.selectedUnit,
        reviewedTargetBinding: context.reviewedTargetBinding ?? null,
        orchestrator: false, verificationId,
        controlledContractGeneration: context.contractGeneration,
        sourceSnapshotDigest: context.sourceSnapshotDigest
      });
    const target = ownedTarget === null ? null : { ...ownedTarget,
      binding_count: nativeCaseTarget ? 1 : targetArities.get(verificationId) ?? 0 };
    const resolution = resolveAttributableProofRuntime({
      prepared, obligationId: row.obligation_id, resolvedRow: resolved,
      resolvedNode: nodes.get(resolved.resolved_identity),
      executionSourceBinding: context.executionSourceBinding,
      declaredTargetProjection: target, executionPack: context.executionPack
    });
    if (resolution.status !== 'executable') {
      const joinKind = resolution.reason_code.includes('test_proof_binding') ? 'test_proof' :
        resolution.reason_code.includes('target') ? 'declared_target' : 'native_verification';
      const arity = resolution.details.arity ?? (joinKind === 'test_proof' ? candidates.filter(p => p.verification_claim_id === verificationId).length :
        joinKind === 'declared_target' ? target?.declaration_count ?? target?.details?.count ?? null : graph.qualifying.length);
      diagnostics.push({ obligation_id: row.obligation_id, verification_id: verificationId,
        reason_code: resolution.reason_code, authority_limb: 'mechanical_failure',
        details: { ...resolution.details, join_kind: joinKind, arity,
          verification_ids: graph.qualifying, owner_code: resolution.details.owner_code ?? resolution.reason_code,
          path: resolution.details.path ?? `/obligations/${source.obligations.indexOf(row)}`, resolved_node_identity: resolved.resolved_identity } });
      const proof = nativeProofs.length === 1 ? nativeProofs[0] : null;
      const failureKey = `unavailable:${row.obligation_id}`;
      const diagnostic = diagnostics.at(-1);
      if (proof) diagnostic.test_proof_id = proof.test_proof_id;
      if (resolution.reason_code === 'verify_proof.test_selector_invalid.v1') {
        diagnostic.details.recovery_call = buildStableTestProofRecoveryCall({ wkId, focus: source.focus });
      }

      if (resolution.reason_code === PROOF_OBLIGATION_NOT_EXECUTABLE_CODES.QUALIFYING_VERIFICATION_AMBIGUOUS) {
        diagnostic.details.recovery_call = obligationCoverageQueryCall({ wkId, focus: source.focus,
          selectedUnit: source.selected_unit, obligationId: row.obligation_id });
      }
      proofs.set(failureKey, { test_proof_id: proof?.test_proof_id ?? null, verification_id: verificationId,
        declared_target: target, relationships: [{ obligation_id: row.obligation_id,
          relation_ids: declaredRelationIds, selected_definition: resolved.definition,
          resolved_node_identity: resolved.resolved_identity }], failure: diagnostic });
      continue;
    }
    const proof = resolution.test_proof;
    const proofDiagnostics = [];
    try { resolveStableTestProofProviderBindings(proof); }
    catch (error) {
      proofDiagnostics.push({ obligation_id: row.obligation_id,
        test_proof_id: proof.test_proof_id,
        verification_id: verificationId, reason_code: 'verify_proof.provider_binding_invalid.v1',
        authority_limb: 'mechanical_failure', details: { package_code: error.code } });
    }
    proofDiagnostics.push(...forcedInvocationCoverageDiagnostics(proof, context.controlledContract));
    const key = canonicalDigest({ source: context.executionSourceBinding.binding_digest, node: resolved.resolved_identity,
      proof, target, evaluator: context.executionPack.test_validity_evaluator.implementation_digest });
    if (!proofs.has(key)) {
      diagnostics.push(...proofDiagnostics);
      proofs.set(key, { execution_key: key, test_proof_id: proof.test_proof_id,
        verification_id: verificationId, test_proof: proof, declared_target: target,
        relationships: [], ...(proofDiagnostics.length
          ? { failure_diagnostics: proofDiagnostics } : {}) });
    }
    proofs.get(key).relationships.push({ obligation_id: row.obligation_id, obligation: row,
      behavior_claim_ids: resolution.behavior_claim_ids, relation_ids: resolution.relation_ids,
      ...(resolution.authored_case ? { authored_case: resolution.authored_case } : {}),
      selected_definition: resolution.selected_definition, resolved_node_identity: resolution.resolved_node_identity });
  }
  const population = [...proofs.values()];
  for (const proof of population.filter(entry => entry.failure_diagnostics)) {
    const obligationIds = proof.relationships.map(({ obligation_id: id }) => id);
    for (const diagnostic of proof.failure_diagnostics) {
      diagnostic.obligation_ids = obligationIds;
    }
  }
  const eligible = population.filter(proof => proof.failure === undefined &&
    proof.failure_diagnostics === undefined);
  const ineligible = population.filter(proof => proof.failure !== undefined ||
    proof.failure_diagnostics !== undefined);
  const status = diagnostics.length || !population.length ? 'not_executable' : 'executable';
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION, status, authority: 'non_authoritative',
    ...(status === 'not_executable' ? { authority_limb: 'mechanical_failure',
      reason_code: diagnostics.length ? 'verify_proof.population_not_ready.v1' : 'verify_proof.proof_population_empty.v1' } : {}),
    subject: { requested: args.subject, kind: context.subjectKind, canonical_id: args.subject },
    wk_id: wkId, focus: source.focus, contract_generation: context.contractGeneration,
    contract_digest: context.canonicalContractDigest, obligation_coverage_digest: context.obligationCoverageDigest,
    execution_source_binding: context.executionSourceBinding, execution_pack: context.executionPack,
    diagnostics, proof_count: population.length, relationship_count: context.authoringResolution.rows.length,
    proofs: population, eligible, ineligible
  });
}

export { FORBIDDEN_AUTHORITY_KEYS as VERIFY_PROOF_FORBIDDEN_AUTHORITY_KEYS,
  RESOLUTION_SCHEMA_VERSION as VERIFY_PROOF_POPULATION_RESOLUTION_SCHEMA_VERSION,
  VerifyProofOperationError, assertVerifyProofCallerShape, parseVerifyProofSource,
  resolveVerifyProofOperation, verifyProofPopulationSubject, verifyProofTimeoutInputSchema,
  verifyProofTimeoutRefusal };
