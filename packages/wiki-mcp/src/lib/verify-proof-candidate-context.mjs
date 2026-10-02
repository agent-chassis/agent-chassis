

import { projectSavedProofCase as projectProofAuthoringCase } from '../../../wiki-core/src/operations/controlled-contract/saved-proof-source.mjs';
import * as casePackage from '@agent-chassis/controlled-contract';
import { projectWorkRecordTestProofValidation } from "../../../wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import { resolveImmutableExactCommitCandidate, materializeImmutableCandidate, assertMaterializedImmutableCandidateCurrent } from "../../../agent-launch-cli/src/lib/backend-immutable-candidate.mjs";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { canonicalDigest, deepFreeze } from "@agent-chassis/controlled-contract";
import { loadAdmittedProofPack } from "@agent-chassis/controlled-contract";
import { resolveBehaviorAndVerificationPopulation, createNativeVerificationIndex } from "@agent-chassis/controlled-contract";
import { locateVerifyProofSubjectWkIds, orderVerifyProofSourceChoices, resolveVerifyProofSourceBinding,
  resolveSavedProofRuntimeBindings, verifyProofSourceChoice } from "../../../wiki-core/src/operations/controlled-contract/verify-proof-source-binding.mjs";
import { VerifyProofOperationError, parseVerifyProofSource, verifyProofPopulationSubject }
  from "../../../wiki-core/src/operations/controlled-contract/verify-proof-operations.mjs";
import { readControlledContractGeneration } from "../../../wiki-core/src/lib/controlled-contract-tools.mjs";
import { bindLauncherSavedProofSource, assertManagedReviewerTestProofRuntimeCurrent,
  mintManagedWorkerTestProofRuntimeAuthority, mintManagedReviewerTestProofRuntimeAuthority }
  from "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { verifyExactSliceCommitBinding } from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { mintManagedWorkerTestRunAuthority } from "../../../agent-launch-cli/src/lib/managed-worker-test-run-authority.mjs";
import { defaultTerminalCandidateRunGit } from "../../../agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { resolveFrozenReviewContractArtifact, resolveLauncherRunState } from "./launcher-run-credential.mjs";

const VERIFIED_WORKER_SLICE_BINDINGS = new WeakMap();

export function verifiedManagedWorkerSliceBinding(authority) {
  return (authority !== null && typeof authority === "object"
    ? VERIFIED_WORKER_SLICE_BINDINGS.get(authority) : undefined) ?? null;
}

function selectedUnit(record, address) {
  if (record?.id === address) return record;
  const [wkId, sliceId, ...rest] = String(address ?? "").split("#");
  if (rest.length > 0 || record?.id !== wkId) return null;
  return record.slices?.find(({ id }) => id === sliceId) ?? null;
}

const NO_SOURCE_CHOICE_CODES = new Set(["verify_proof.subject_ambiguous.v1",
  "verify_proof.subject_unknown.v1", "verify_proof.native_binding_unavailable.v1"]);
async function crossWkSourceChoices({ root, subject, wkIds }) {
  const choices = [];
  for (const wkId of wkIds) {
    try {
      const selected = await resolveVerifyProofSourceBinding({ repoRoot: root, wkId, subject,
        authenticatedRole: "orchestrator" });
      choices.push(verifyProofSourceChoice(selected.source));
    } catch (error) {
      if (error?.code === "verify_proof.source_tuple_ambiguous.v1") {
        choices.push(...error.details.source_choices);
      } else if (!NO_SOURCE_CHOICE_CODES.has(error?.code)) throw error;
    }
  }
  return orderVerifyProofSourceChoices(choices);
}

async function canonicalSubjectWkMatches({ root, subject, source }) {
  if (source !== null) {

    await resolveVerifyProofSourceBinding({ repoRoot: root, wkId: source.wkId, subject,
      source: { unit: source.unit, ...(source.focus === null ? {} : { focus: source.focus }) },
      authenticatedRole: "orchestrator" });
    return { wkIds: [source.wkId], choices: [] };
  }
  const census = await locateVerifyProofSubjectWkIds({ repoRoot: root, subject });
  const candidates = census.wk_ids;
  if (candidates.length > 1) return { wkIds: candidates,
    choices: await crossWkSourceChoices({ root, subject, wkIds: candidates }) };
  if (candidates.length === 0) return { wkIds: candidates, choices: [] };
  const [wkId] = candidates;

  await resolveVerifyProofSourceBinding({ repoRoot: root, wkId, subject,
    authenticatedRole: "orchestrator" });
  return { wkIds: candidates, choices: [] };
}

async function resolveCanonicalSubjectWkId({ repoRoot, subject, source, gitSha, worktreeRoot }) {
  const population = verifyProofPopulationSubject(subject);
  const selection = parseVerifyProofSource({ subject, ...(source === undefined ? {} : { source }) });
  if (population !== null) return population.wkId;
  let matches;
  if (gitSha === undefined) matches = await canonicalSubjectWkMatches({ root: repoRoot, subject, source: selection });
  else {
    const candidate = resolveImmutableExactCommitCandidate({ mainRepo: repoRoot, gitSha });
    const materialized = materializeImmutableCandidate({ candidate, worktreeRoot });
    let primary = null;
    try {
      assertMaterializedImmutableCandidateCurrent({ materialized });
      matches = await canonicalSubjectWkMatches({ root: materialized.checkout.worktree_path,
        subject, source: selection });
      assertMaterializedImmutableCandidateCurrent({ materialized });
    } catch (error) { primary = error; }
    materialized.cleanup({ primaryErrorCode: primary?.code ?? null });
    if (primary !== null) throw primary;
  }
  if (matches.wkIds.length === 0) throw new VerifyProofOperationError(
    "verify_proof.subject_unknown.v1",
    "subject does not exist in canonical work-record and contract relationships"
  );
  if (matches.wkIds.length !== 1) throw new VerifyProofOperationError(
    "verify_proof.subject_ambiguous.v1",
    "subject is ambiguous across canonical work-record and contract relationships",
    { subject, match_count: matches.wkIds.length, source_choices: matches.choices,
      choice_count: matches.choices.length }
  );
  return matches.wkIds[0];
}

async function gitIdentity(root) {
  const [commitResult, treeResult] = await Promise.all([
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"] }),
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"] })
  ]);
  const commit = commitResult?.ok === true ? String(commitResult.stdout ?? "").trim() : null;
  const tree = treeResult?.ok === true ? String(treeResult.stdout ?? "").trim() : null;
  if (!/^[a-f0-9]{40,64}$/u.test(commit ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(tree ?? "")) throw Object.assign(new Error(
    "launcher review materialization has no exact Git candidate identity"
  ), { code: "verify_proof.reviewer_candidate_unresolved.v1" });
  return { commit, tree };
}

function authenticateManagedWorkerSliceBinding({ mainRepo, state, wkId }) {
  const credential = state.credential;
  if (!credential || state.assignedUnit?.startsWith(`${wkId}#`) !== true) throw Object.assign(
    new Error("managed worker proof authority is unavailable"),
    { code: "verify_proof.worker_authority_unavailable.v1" });
  return verifyExactSliceCommitBinding({
    binding: resolveWorktreeBinding({ mainRepo, launchRef: credential.launchRef,
      runId: credential.runId, retryId: credential.retryId }),
    mainRepo,
    assignedUnit: state.assignedUnit,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });
}

async function resolveRuntimeAuthority({ env, mainRepo, state, wkId }) {
  if (state.role === "worker") {
    const binding = authenticateManagedWorkerSliceBinding({ mainRepo, state, wkId });
    const managed = mintManagedWorkerTestRunAuthority({ commitBinding: binding, mainRepo });
    const authority = mintManagedWorkerTestProofRuntimeAuthority({ authority: managed });
    VERIFIED_WORKER_SLICE_BINDINGS.set(authority, binding);
    return { authority, role: "worker", selectedUnitAddress: state.assignedUnit,
      candidateIdentity: authority.candidate_identity ?? authority.run_id };
  }
  if (state.role !== "reviewer" || state.assignedUnit?.startsWith(`${wkId}#`) !== true) {
    throw Object.assign(new Error(
      "verify_proof is available only in eligible launcher-managed worker and reviewer sessions"
    ), { code: "verify_proof.role_ineligible.v1" });
  }
  const artifact = resolveFrozenReviewContractArtifact({ state });
  if (artifact.status === "refused" || artifact.technical_role !== "reviewer" ||
      artifact.canonical_parent_wk_contract?.id !== wkId) throw Object.assign(new Error(
    "managed reviewer frozen contract is unavailable or cross-bound"
  ), { code: "verify_proof.reviewer_frozen_contract_refused.v1" });
  const root = realpathSync(env.WIKI_MCP_REVIEW_MATERIALIZATION_DIR ?? "");
  const identity = await gitIdentity(root);
  const runDigest = createHash("sha256").update(
    `${state.credential.launchRef}\0${state.credential.runId}\0${state.credential.retryId}`
  ).digest("hex");
  const authority = await mintManagedReviewerTestProofRuntimeAuthority({
    mainRepo,
    worktreePath: root,
    runId: `run-review-${runDigest}`,
    wkId,
    selectedUnit: state.assignedUnit,
    reviewedSha: identity.commit,
    reviewedTree: identity.tree
  });
  return { authority, role: "reviewer", selectedUnitAddress: state.assignedUnit,
    candidateIdentity: identity.commit,
    reviewedTargetBinding: Object.freeze({
      schema_version: "launcher-frozen-reviewed-test-target-binding.v1",
      reviewer_unit: state.assignedUnit,
      reviewed_unit: artifact.review_unit_contract.admission_review_target_unit ?? null,
      artifact_digest: artifact.artifact_digest
    }) };
}

async function resolveProductionContext({ args, repoRoot, env, state = null, wkId }) {
  const runtime = await resolveRuntimeAuthority({ env, mainRepo: repoRoot,
    state: state ?? resolveLauncherRunState(env), wkId });
  return resolveProductionContextFromRuntime({ args, runtime });
}

async function resolveProductionContextFromRuntime({ args, runtime }) {
  const repoRoot = runtime.authority.worktree_path, wkId = runtime.authority.wk_id;
  const authorizedUnit = runtime.role === "reviewer" ? runtime.reviewedTargetBinding?.reviewed_unit : runtime.selectedUnitAddress;
  const sourceInput = args.source === undefined ? {} : { source: args.source };
  const selected = await resolveVerifyProofSourceBinding({ repoRoot, wkId, subject: args.subject,
    ...sourceInput, authenticatedRole: runtime.role, authorizedUnit });
  const sourceGuard = bindLauncherSavedProofSource({ authority: runtime.authority, source: selected.source.source });

  const caseSource = selected.source.caseSource;
  const caseMember = caseSource === null ? null : {
    repository_relative_path: path.relative(repoRoot, caseSource.file),
    selected_unit: null, content_digest: caseSource.content_digest,
    source_snapshot_digest: sourceGuard.snapshot.source_snapshot_digest };
  const assertSourcesCurrent = () => sourceGuard.assertCurrent();
  await runtime.assertCurrentIdentity?.();
  const resolution = await selected.resolve();
  const generation = await readControlledContractGeneration({ repoRoot, wkId });
  const pack = await loadAdmittedProofPack("proof.verification.test-validity");
  assertSourcesCurrent();
  const bindingBody = { schema_version: "verify-proof-execution-source-binding.v1",
    wk_id: wkId, selected_unit: selected.source.selectedUnit, focus: selected.source.focus,
    source: sourceGuard.member, case_source: caseMember,
    cases: selected.source.cases.map(definition => ({ case_id: definition.case_id,
      case_revision: projectProofAuthoringCase(casePackage, { ...selected.source, contract: selected.canonicalContract }, { case_id: definition.case_id })[0].case_revision })), canonical_contract_digest: selected.canonicalContract.content_digest, contract_digest: selected.contract.content_digest,
    contract_generation: generation.generation_digest, context_digest: resolution.context_digest,
    resolution_identity_digest: resolution.identity_digest,
    selected_nodes: resolution.rows.map(row => ({ obligation_id: row.obligation_id, resolved_node_identity: row.resolved_identity })),
    definition_identities: resolution.definition_identities,
    dependencies: resolution.dependencies.map(({ construction, ...node }) => ({ ...node,
      construction_digest: construction === null ? null : `sha256:${canonicalDigest(construction)}` })),
    candidate: runtime.candidateIdentity, source_snapshot_digest: sourceGuard.snapshot.source_snapshot_digest };
  const binding = deepFreeze({ ...bindingBody, binding_digest: `sha256:${canonicalDigest(bindingBody)}` });
  const assertCurrentIdentity = async () => {
    await runtime.assertCurrentIdentity?.();
    if (runtime.role === "reviewer") await assertManagedReviewerTestProofRuntimeCurrent(runtime.authority);
    assertSourcesCurrent();
    const fresh = await resolveVerifyProofSourceBinding({ repoRoot, wkId, subject: args.subject,
      ...sourceInput, authenticatedRole: runtime.role, authorizedUnit });

    if (fresh.source.selectedUnit !== selected.source.selectedUnit ||
        fresh.source.focus !== selected.source.focus || fresh.kind !== selected.kind) {
      throw new VerifyProofOperationError("verify_proof.execution_source_stale.v1",
        "Saved source selection moved during this invocation");
    }
    const current = await fresh.resolve();
    const currentPack = await loadAdmittedProofPack("proof.verification.test-validity");
    if (canonicalDigest(current) !== canonicalDigest(resolution) ||
        currentPack.profile_digest !== pack.profile_digest || currentPack.admission_digest !== pack.admission_digest ||
        currentPack.parameter_contract_digest !== pack.parameter_contract_digest ||
        currentPack.test_validity_evaluator.implementation_digest !== pack.test_validity_evaluator.implementation_digest) {
      throw new VerifyProofOperationError("verify_proof.execution_source_stale.v1",
        "Saved source, parameters or exact definition moved during this invocation");
    }
    const currentGeneration = await readControlledContractGeneration({ repoRoot, wkId });
    if (currentGeneration.generation_digest !== generation.generation_digest) throw new VerifyProofOperationError(
      "verify_proof.execution_source_stale.v1", "Native generation moved during this invocation");
    assertSourcesCurrent();
  };
  const boundRuntime = { ...runtime, assertCurrentIdentity,
    resolveBindings: async ({ verificationIds }) => {
      await assertCurrentIdentity();
      return resolveSavedProofRuntimeBindings({ source: selected.source, contract: selected.contract, verificationIds });
    },
    ...(runtime.role === "worker" ? { executionAuthorityIdentity: runtime.candidateIdentity,
      candidateIdentity: sourceGuard.snapshot.source_snapshot_digest } : {}) };
  const nativeIndex = createNativeVerificationIndex(selected.contract.content);
  return { runtime: boundRuntime, resolutionContext: {
    obligationCoverage: selected.source.source.content,
    obligationCoverageDigest: selected.source.source.content_digest,
    controlledContract: selected.contract.content, contractWkId: wkId,
    canonicalContractDigest: selected.canonicalContract.content_digest, contractDigest: selected.contract.content_digest, contractGeneration: generation.generation_digest,
    authoringResolution: resolution, executionSourceBinding: binding, executionPack: pack,
    testTargetDeclarations: projectWorkRecordTestProofValidation({ selectedUnit: selected.source.unit }),
    workRecord: selected.source.record, selectedUnit: runtime.role === "reviewer"
      ? selectedUnit(selected.source.record, runtime.selectedUnitAddress) : selected.source.unit,
    subjectKind: selected.kind, authenticatedRole: runtime.role,
    reviewedTargetBinding: runtime.reviewedTargetBinding ?? null,
    sourceSnapshotDigest: sourceGuard.snapshot.source_snapshot_digest,
    nativeGraphs: new Map(selected.selected.map(row => [row.obligation_id,
      resolveBehaviorAndVerificationPopulation(row, selected.contract.content, nativeIndex)]))
  } };
}

export { authenticateManagedWorkerSliceBinding, resolveCanonicalSubjectWkId, resolveProductionContext,
  resolveProductionContextFromRuntime, resolveRuntimeAuthority as resolveManagedRuntimeAuthority };
