import {
  clearControlledContractAuthoringContinuationStorage,
  continuationPersistenceBoundary,
  createControlledContractAuthoringContinuationStorage,
  setControlledContractAuthoringContinuationStorageHookForTest
} from "./controlled-contract-authoring-continuation-storage.mjs";
import {
  AUTHORING_CONTINUATION_PATTERN,
  loadControlledContractPackage,
  isPlainObject,
  normalizeControlledContractIdentity
} from "./controlled-contract-tool-shared.mjs";
import { continuationContentDigest } from "./controlled-contract-continuation-encoding.mjs";
import {
  CONTINUATION_SCHEMA,
  assertServerOwnedSourceDeclaration,
  authenticateRecord,
  contentAddressedContinuation,
  continuationFailure,
  continuationHex,
  sameJsonValue
} from "./controlled-contract-authoring-continuation-records.mjs";

export {
  CONTROLLED_CONTRACT_DESIGN_RESPONSE_KINDS,
  CONTROLLED_CONTRACT_DESIGN_SEMANTIC_OWNERS,
  assertOneControlledContractSemanticOwner,
  sameJsonValue
} from "./controlled-contract-authoring-continuation-records.mjs";

const TRANSITION_SCHEMA = "controlled-contract-authoring-continuation-transition.v1";

export function setControlledContractAuthoringContinuationHookForTest(hook = null) {
  setControlledContractAuthoringContinuationStorageHookForTest(hook);
}

const {
  acquireStoreLock,
  atomicWrite,
  continuationStore,
  findTransitionTarget,
  readRecordFile,
  readTransitionFile,
  recordPath,
  releaseStoreLock,
  storeInitialRecord,
  transitionPath
} = createControlledContractAuthoringContinuationStorage({
  authenticateRecord,
  sameJsonValue
});

export async function rememberControlledContractAuthoringContinuation({
  repoRoot, wkId, focus = null, contract, skeleton, proposal = null,
  expectedSources = null, workbench = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (workbench !== null) {
    if (!isPlainObject(workbench)) continuationFailure("invalid",
      "a workbench continuation requires one server-resolved descriptor");
    const record = contentAddressedContinuation({
      schema_version: CONTINUATION_SCHEMA,
      wk_id: wkId,
      focus: focus ?? null,
      workbench: {
        status: "issued",
        attempt: 0,
        row_id: workbench.row_id,
        row_digest: workbench.row_digest,
        source_identity: structuredClone(workbench.source_identity),
        dependencies: structuredClone(workbench.dependencies ?? []),
        semantic_owner: workbench.semantic_owner,
        response_kinds: structuredClone(workbench.response_kinds),
        owner_context: structuredClone(workbench.owner_context ?? {}),
        response_digest: null,
        result_digest: null
      }
    });
    await authenticateRecord(record, record.identity);
    const store = await continuationStore(repoRoot);
    const locked = await acquireStoreLock(store, wkId);
    try {
      return await storeInitialRecord(store, record, locked.record.token);
    } finally {
      await releaseStoreLock(locked);
    }
  }
  const continuation = skeleton?.continuation;
  if (!continuation || typeof continuation.identity_digest !== "string" ||
      !AUTHORING_CONTINUATION_PATTERN.test(continuation.identity_digest)) {
    continuationFailure("invalid",
      "package proof-authoring result has no valid continuation identity");
  }
  if (proposal === null) continuationFailure("invalid",
    "a public continuation requires one complete proof-graph proposal");
  const pkg = await loadControlledContractPackage();
  const admitted = pkg.validateProofGraphProposal(proposal);
  const selected = skeleton.selected_pack;
  assertServerOwnedSourceDeclaration(expectedSources, pkg.PROOF_GRAPH_CARRIER_KINDS);
  if (admitted.wk_id !== wkId || (admitted.focus ?? null) !== (focus ?? null) ||
      admitted.contract_content_digest !== contract.content_digest ||
      admitted.selected_pack.profile_id !== selected?.profile_id ||
      admitted.selected_pack.profile_version !== selected?.profile_version ||
      !sameJsonValue(admitted.requested_intents, skeleton.requested_intents) ||
      !sameJsonValue(admitted.skeleton_continuation.continuation, continuation) ||
      !sameJsonValue(admitted.skeleton_continuation.unresolved_required_roles,
        skeleton.unresolved_required_roles ?? [])) {
    continuationFailure("tampered",
      "proof-graph proposal conflicts with the exact rebuilt skeleton identity");
  }
  const record = contentAddressedContinuation({
    schema_version: CONTINUATION_SCHEMA,
    wk_id: wkId,
    focus: focus ?? null,
    contract_content_digest: contract.content_digest,
    package_generation: skeleton.package_version ?? continuation.package_version ?? null,
    package_continuation: structuredClone(continuation),
    skeleton: structuredClone(skeleton),
    skeleton_digest: continuationContentDigest(skeleton),
    semantic_bindings: structuredClone(skeleton.evaluation_input),
    proof_graph: {
      status: "bound",
      proposal_digest: continuationContentDigest(admitted.server_projection),
      proposal: structuredClone(admitted.server_projection),
      expected_sources: structuredClone(expectedSources),
      package_generation: skeleton.package_version ?? continuation.package_version ?? null,
      unresolved_pointers: [],
      missing_graph_identities: admitted.addressed_carrier_kinds
    }
  });
  await authenticateRecord(record, record.identity);
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, wkId);
  try {
    return await storeInitialRecord(store, record, locked.record.token);
  } finally {
    await releaseStoreLock(locked);
  }
}

export async function getControlledContractAuthoringContinuation({ repoRoot, identity }) {
  if (continuationHex(identity) === null) return null;
  const store = await continuationStore(repoRoot);
  const direct = await readRecordFile(recordPath(store, identity), identity, { missing: true });
  return direct ?? findTransitionTarget(store, identity);
}

export async function readControlledContractProofGraphPublication({ repoRoot, identity }) {
  const store = await continuationStore(repoRoot);
  let current = await getControlledContractAuthoringContinuation({ repoRoot, identity });
  if (!current?.proof_graph) return null;
  const seen = new Set();
  for (;;) {
    if (seen.has(current.identity)) continuationFailure("tampered", "proof-graph transition cycle");
    seen.add(current.identity);
    if (current.proof_graph.status === "published") return current;
    const next = await readTransitionFile(transitionPath(store, current.identity),
      current.identity, { missing: true });
    if (next === null) return null;
    current = next.target;
  }
}

function workbenchAttempt(record) {
  const { status, attempt, response_digest, result_digest } = record.workbench;
  return Object.freeze({ identity: record.identity, status, attempt,
    response_digest, result_digest, usable: status === "issued" || status === "retryable" });
}

export async function inspectControlledContractWorkbenchAttempt({ repoRoot, identity }) {
  const original = await getControlledContractAuthoringContinuation({ repoRoot, identity });
  if (!original?.workbench) continuationFailure("unknown", "workbench continuation is unavailable");
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, original.wk_id);
  try {
    let current = original;
    const seen = new Set();
    for (;;) {
      if (seen.has(current.identity)) continuationFailure("tampered", "workbench attempt transition cycle");
      seen.add(current.identity);
      const next = await readTransitionFile(transitionPath(store, current.identity),
        current.identity, { missing: true });
      if (next === null) break;
      current = next.target;
    }
    return workbenchAttempt(current);
  } finally {
    await releaseStoreLock(locked);
  }
}

export function controlledContractWorkbenchAttemptRefusalDetails(attempt) {
  const settled = attempt.status === "applied";
  return Object.freeze({
    cause: settled ? "attempt_completed" : "attempt_outcome_unestablished",
    attempt_state: settled ? "applied" : "indeterminate",
    retained_status: attempt.status,
    attempt_identity: attempt.identity, response_digest: attempt.response_digest,
    result_digest: attempt.result_digest, retry_safe: false,
    recovery: null, supported_next_step: null,
    required_evidence: settled ? null
      : "An authenticated owner-certified effect-free terminal transition for this exact attempt and response, or an incumbent settlement receipt establishing its outcome.",
    operator_action: settled ? null
      : "The operation owner could not establish this exact attempt's outcome. This wrapper exposes no reset or evidence-import operation. Exceptional recovery requires an operator decision establishing the terminal outcome and revoking the predecessor's publication authority through an enforced fence; source matching or refresh supplies neither."
  });
}

export function assertControlledContractWorkbenchAttemptUsable(attempt) {
  if (attempt.usable) return;
  const settled = attempt.status === "applied";
  continuationFailure(settled ? "stale" : "outcome_unestablished",
    settled ? "The incumbent owner already completed this continuation; it cannot be applied again."
      : "This attempt is applying, but no owner-certified terminal outcome is retained. It may still be active or have indeterminate effects. Refresh cannot make it retryable.",
    { changed: false, ...controlledContractWorkbenchAttemptRefusalDetails(attempt) });
}

export async function rememberControlledContractRefactorContinuation({
  repoRoot, wkId, focus = null, contractContentDigest, packageGeneration,
  source, planIdentity, snapshotDigest, transactionIdentity
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof contractContentDigest !== "string" ||
      typeof packageGeneration !== "string" || !isPlainObject(source) ||
      typeof planIdentity !== "string" || typeof snapshotDigest !== "string" ||
      typeof transactionIdentity !== "string") continuationFailure("invalid",
    "refactor continuation requires one complete server-resolved binding");
  const record = contentAddressedContinuation({
    schema_version: CONTINUATION_SCHEMA,
    wk_id: wkId,
    focus: focus ?? null,
    contract_content_digest: contractContentDigest,
    package_generation: packageGeneration,
    refactor: {
      status: "planned",
      source: structuredClone(source),
      plan_identity: planIdentity,
      snapshot_digest: snapshotDigest,
      transaction_identity: transactionIdentity,
      receipt_identity: null
    }
  });
  await authenticateRecord(record, record.identity);
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, wkId);
  try {
    return await storeInitialRecord(store, record, locked.record.token);
  } finally {
    await releaseStoreLock(locked);
  }
}

export async function getControlledContractRefactorContinuation({ repoRoot, identity }) {
  if (continuationHex(identity) === null) return null;
  const store = await continuationStore(repoRoot);
  const transitioned = await readTransitionFile(transitionPath(store, identity), identity,
    { missing: true });
  if (transitioned?.target?.refactor) return transitioned.target;
  const record = await getControlledContractAuthoringContinuation({ repoRoot, identity });
  return record?.refactor ? record : null;
}

export async function updateControlledContractRefactorContinuation({
  repoRoot, wkId, focus = null, identity, changes
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (!isPlainObject(changes) || Reflect.ownKeys(changes).some((key) =>
      typeof key !== "string" || !["status", "receipt_identity"].includes(key))) {
    continuationFailure("invalid", "refactor transition changes are not closed");
  }
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, wkId);
  try {
    const current = await getControlledContractRefactorContinuation({ repoRoot, identity });
    if (current === null) continuationFailure("unknown",
      "refactor continuation is unavailable");
    if (current.wk_id !== wkId || current.focus !== (focus ?? null)) {
      continuationFailure("tampered", "refactor continuation transition scope changed");
    }
    const updated = contentAddressedContinuation({ ...current,
      refactor: { ...current.refactor, ...structuredClone(changes) } });
    await authenticateRecord(updated, updated.identity);
    await continuationPersistenceBoundary("transition_cas_owner", {
      source_identity: identity, target_identity: updated.identity,
      target_status: updated.refactor.status, wk_id: wkId,
      focus: focus ?? null, owner_token: locked.record.token
    });
    const filename = transitionPath(store, identity);
    const existing = await readTransitionFile(filename, identity, { missing: true });
    if (existing !== null) {
      if (existing.target.identity === updated.identity &&
          sameJsonValue(existing.target, updated)) return existing.target;
      continuationFailure("stale",
        "refactor continuation already has a different durable transition");
    }
    await atomicWrite(store, filename, {
      schema_version: TRANSITION_SCHEMA,
      source_identity: identity,
      target_record: updated
    }, locked.record.token);
    await continuationPersistenceBoundary("transition_written", {
      source_identity: identity, target_identity: updated.identity,
      target_status: updated.refactor.status
    });
    return (await readTransitionFile(filename, identity)).target;
  } finally {
    await releaseStoreLock(locked);
  }
}

export async function updateControlledContractAuthoringProofGraphContinuation({
  repoRoot, wkId, focus = null, identity, changes, reportTransition = false
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, wkId);
  try {
    const current = await getControlledContractAuthoringContinuation({ repoRoot, identity });
    if (!current || (!isPlainObject(current.proof_graph) &&
        !isPlainObject(current.workbench))) continuationFailure("unknown",
      "authoring continuation is unavailable");
    if (current.wk_id !== wkId || current.focus !== (focus ?? null)) {
      continuationFailure("tampered", "proof-graph continuation update scope changed");
    }
    const workbenchUpdate = isPlainObject(current.workbench);
    if (workbenchUpdate && (!isPlainObject(changes) || Reflect.ownKeys(changes).some((key) =>
      typeof key !== "string" || !["status", "response_digest", "result_digest"]
        .includes(key)))) continuationFailure("invalid",
      "workbench continuation transition changes are not closed");
    if (workbenchUpdate && ["contract_reference", "proof_graph", "contract_carrier"].includes(current.workbench.semantic_owner) &&
        !({ issued: ["applying"], applying: ["retryable", "applied"],
          retryable: ["applying"], applied: [] })[current.workbench.status].includes(changes.status)) {
      continuationFailure("stale", "owner attempt transition cannot reopen a completed attempt", {
        changed: false, attempt_state: current.workbench.status, retry_safe: false,
        recovery: null, supported_next_step: null
      });
    }
    const transitionChanges = workbenchUpdate && changes.status === "applying" &&
        ["issued", "retryable"].includes(current.workbench.status)
      ? { ...structuredClone(changes), attempt: current.workbench.attempt + 1 }
      : structuredClone(changes);
    const updated = contentAddressedContinuation({
      ...current,
      ...(workbenchUpdate
        ? { workbench: { ...current.workbench, ...transitionChanges } }
        : { proof_graph: { ...current.proof_graph, ...transitionChanges } })
    });
    await authenticateRecord(updated, updated.identity);
    await continuationPersistenceBoundary("transition_cas_owner", {
      source_identity: identity, target_identity: updated.identity,
      target_status: workbenchUpdate ? updated.workbench.status : updated.proof_graph.status,
      wk_id: wkId, focus: focus ?? null,
      owner_token: locked.record.token
    });
    const filename = transitionPath(store, identity);
    const existing = await readTransitionFile(filename, identity, { missing: true });
    if (existing !== null) {

      if (workbenchUpdate && changes.status === "applying") {
        let latest = existing.target;
        const seen = new Set([identity]);
        while (!seen.has(latest.identity)) {
          seen.add(latest.identity);
          const next = await readTransitionFile(
            transitionPath(store, latest.identity), latest.identity, { missing: true });
          if (next === null) break;
          latest = next.target;
        }
        if (["contract_reference", "proof_graph", "contract_carrier"].includes(current.workbench.semantic_owner)) {
          assertControlledContractWorkbenchAttemptUsable(workbenchAttempt(latest));
        }
        if (latest.workbench?.status === "retryable") {
          const retried = contentAddressedContinuation({ ...latest,
            workbench: { ...latest.workbench, status: "applying",
              attempt: latest.workbench.attempt + 1,
              response_digest: changes.response_digest ??
                latest.workbench.response_digest,
              result_digest: null } });
          await authenticateRecord(retried, retried.identity);
          const retryFilename = transitionPath(store, latest.identity);
          const claimed = await readTransitionFile(
            retryFilename, latest.identity, { missing: true });
          if (claimed === null) {
            await atomicWrite(store, retryFilename, {
              schema_version: TRANSITION_SCHEMA,
              source_identity: latest.identity,
              target_record: retried
            }, locked.record.token);
            await continuationPersistenceBoundary("transition_written", {
              source_identity: latest.identity, target_identity: retried.identity,
              target_status: retried.workbench.status
            });
            return reportTransition
              ? Object.freeze({ record: retried, changed: true }) : retried;
          }
        }
      }
      if (existing.target.identity === updated.identity &&
          sameJsonValue(existing.target, updated)) {
        await continuationPersistenceBoundary("equivalent_transition_observed", {
          source_identity: identity, target_identity: updated.identity
        });
        return reportTransition
          ? Object.freeze({ record: existing.target, changed: false }) : existing.target;
      }
      await continuationPersistenceBoundary("conflicting_transition_observed", {
        source_identity: identity, selected_identity: existing.target.identity,
        rejected_identity: updated.identity
      });
      continuationFailure("stale",
        "proof-graph continuation already has a different durable update");
    }
    await atomicWrite(store, filename, {
      schema_version: TRANSITION_SCHEMA,
      source_identity: identity,
      target_record: updated
    }, locked.record.token);
    await continuationPersistenceBoundary("transition_written", {
      source_identity: identity, target_identity: updated.identity
    });
    const target = (await readTransitionFile(filename, identity)).target;
    return reportTransition ? Object.freeze({ record: target, changed: true }) : target;
  } finally {
    await releaseStoreLock(locked);
  }
}

function pendingPublicationMatchesCanonical(record, canonicalSet) {
  const expected = record.proof_graph.result_member_digests;
  return record.proof_graph.status === "publishing" && isPlainObject(expected) &&
    canonicalSet?.source === "manifest" &&
    Object.keys(expected).length === canonicalSet.members.length &&
    Object.entries(expected).every(([basename, digest]) =>
      canonicalSet.members_by_basename[basename]?.content_digest === digest);
}

export async function reconcileControlledContractAuthoringProofGraphPublication({
  repoRoot, wkId, focus = null, identity, canonicalSet
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await continuationStore(repoRoot);
  const pending = await readTransitionFile(
    transitionPath(store, identity), identity, { missing: true });
  if (pending === null || !pendingPublicationMatchesCanonical(pending.target, canonicalSet)) {
    return null;
  }
  const record = pending.target;
  if (await readTransitionFile(transitionPath(store, record.identity),
    record.identity, { missing: true }) !== null) return null;
  if (record.wk_id !== wkId || record.focus !== (focus ?? null)) {
    continuationFailure("tampered", "pending publication scope changed");
  }
  return updateControlledContractAuthoringProofGraphContinuation({
    repoRoot, wkId, focus, identity: record.identity,
    changes: {
      status: "published",
      unresolved_pointers: [],
      missing_graph_identities: [],
      result_manifest_content_digest: canonicalSet.manifest_content_digest,
      publication: {
        schema_version: record.proof_graph.publication_schema_version,
        profile: "canonical_authoring",
        wk_id: wkId,
        focus: focus ?? null,
        generation: canonicalSet.generation,
        manifest_digest: canonicalSet.manifest_digest,
        manifest_content_digest: canonicalSet.manifest_content_digest,
        carrier_count: canonicalSet.members.length,
        written: true,
        no_op: false
      }
    }
  });
}

export async function clearControlledContractAuthoringContinuationsForTest(input = null) {
  return clearControlledContractAuthoringContinuationStorage(input);
}
