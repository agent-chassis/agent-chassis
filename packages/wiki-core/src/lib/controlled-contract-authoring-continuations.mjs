import {
  clearControlledContractAuthoringContinuationStorage,
  continuationPersistenceBoundary,
  createControlledContractAuthoringContinuationStorage,
  setControlledContractAuthoringContinuationStorageHookForTest
} from "./controlled-contract-authoring-continuation-storage.mjs";
import {
  AUTHORING_CONTINUATION_PATTERN,
  loadControlledContractPackage,
  fail,
  isPlainObject,
  normalizeControlledContractIdentity,
  digestBytes,
  canonicalJsonBytes,
  deepFreezePlainData
} from "./controlled-contract-tool-shared.mjs";

const CONTINUATION_SCHEMA = "controlled-contract-authoring-continuation.v1";
const TRANSITION_SCHEMA = "controlled-contract-authoring-continuation-transition.v1";

export function setControlledContractAuthoringContinuationHookForTest(hook = null) {
  setControlledContractAuthoringContinuationStorageHookForTest(hook);
}

function continuationFailure(code, message, details = {}) {
  fail(`controlled_contract_authoring_continuation_${code}`, message, details);
}

function continuationHex(identity) {
  if (typeof identity !== "string" || !AUTHORING_CONTINUATION_PATTERN.test(identity)) {
    return null;
  }
  return identity.startsWith("sha256:") ? identity.slice(7) : identity;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export { sameJsonValue };

function assertServerOwnedSourceDeclaration(expectedSources, requiredKinds) {
  const invalid = (message, details = {}) => continuationFailure("invalid", message, details);
  if (!Array.isArray(expectedSources)) invalid(
    "a public continuation requires the server-owned source declaration");
  const declared = expectedSources.map((expectation) => expectation?.carrier_kind ?? null);
  if (declared.length !== requiredKinds.length ||
      requiredKinds.some((kind, index) => declared[index] !== kind)) {
    invalid("the server-owned source declaration is not one expectation per addressable carrier", {
      required_expected_source_kinds: [...requiredKinds],
      declared_expected_source_kinds: declared
    });
  }
  for (const expectation of expectedSources) {
    const present = expectation.presence === "present";
    if (!present && expectation.presence !== "absent") invalid(
      "a server-owned source expectation declares neither presence nor absence", {
        carrier_kind: expectation.carrier_kind
      });
    if (present === (expectation.expected_content_digest === null)) invalid(
      "a server-owned source expectation carries the wrong content-digest shape", {
        carrier_kind: expectation.carrier_kind,
        presence: expectation.presence
      });
  }
}

export function assertOneControlledContractSemanticOwner(record) {
  const skeleton = record.skeleton;
  if (!isPlainObject(skeleton)) continuationFailure("invalid",
    "a continuation record carries no validated skeleton");
  if (record.skeleton_digest !== digestBytes(canonicalJsonBytes(skeleton))) {
    continuationFailure("tampered",
      "the stored validated skeleton does not match its recorded digest", {
        field: "skeleton_digest"
      });
  }
  if (!sameJsonValue(record.semantic_bindings, skeleton.evaluation_input)) {
    continuationFailure("tampered",
      "a semantic compatibility projection diverged from the validated skeleton", {
        field: "semantic_bindings"
      });
  }
  const identity = record.package_continuation?.identity;
  if (identity && (
    !sameJsonValue(identity.chosen_bindings, skeleton.evaluation_input) ||
      !sameJsonValue(identity.pack, skeleton.selected_pack) ||
      !sameJsonValue(identity.intents, skeleton.requested_intents) ||
      identity.package_version !== record.package_generation)) {
    continuationFailure("tampered",
      "the package continuation no longer authenticates the stored skeleton", {
        field: "package_continuation"
      });
  }
  return record;
}

function contentAddressedContinuation(value) {
  const body = structuredClone(value);
  delete body.identity;
  const identity = digestBytes(canonicalJsonBytes(body));
  return deepFreezePlainData({ identity, ...body });
}

const RECORD_KEYS = Object.freeze([
  "schema_version", "identity", "wk_id", "focus", "contract_content_digest",
  "package_generation", "package_continuation", "skeleton", "skeleton_digest",
  "semantic_bindings", "proof_graph"
].sort());
const REFACTOR_RECORD_KEYS = Object.freeze([
  "schema_version", "identity", "wk_id", "focus", "contract_content_digest",
  "package_generation", "refactor"
].sort());

function authenticateRefactorRecord(value, expectedIdentity) {
  if (JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(REFACTOR_RECORD_KEYS) || value.schema_version !== CONTINUATION_SCHEMA ||
      value.identity !== expectedIdentity || !isPlainObject(value.refactor) ||
      typeof value.contract_content_digest !== "string" ||
      typeof value.package_generation !== "string") {
    continuationFailure("tampered", "durable refactor continuation has an invalid shape");
  }
  try {
    normalizeControlledContractIdentity({ wkId: value.wk_id, focus: value.focus });
  } catch (error) {
    continuationFailure("tampered", "durable refactor continuation scope is invalid", {
      cause_code: error?.code ?? null
    });
  }
  const required = ["status", "source", "plan_identity", "snapshot_digest",
    "package_result", "coverage", "source_lease", "receipt"];
  if (JSON.stringify(Object.keys(value.refactor).sort()) !== JSON.stringify(required.sort()) ||
      !["planned", "publishing", "published"].includes(value.refactor.status) ||
      !isPlainObject(value.refactor.source) || !isPlainObject(value.refactor.package_result) ||
      !isPlainObject(value.refactor.coverage) ||
      typeof value.refactor.plan_identity !== "string" ||
      typeof value.refactor.snapshot_digest !== "string") {
    continuationFailure("tampered", "durable refactor continuation payload is malformed");
  }
  const recomputed = contentAddressedContinuation(value);
  if (recomputed.identity !== expectedIdentity) continuationFailure("tampered",
    "durable refactor continuation content does not match its identity");
  return deepFreezePlainData(structuredClone(value));
}

async function authenticateRecord(value, expectedIdentity) {
  if (isPlainObject(value) && isPlainObject(value.refactor)) {
    return authenticateRefactorRecord(value, expectedIdentity);
  }
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(RECORD_KEYS)) {
    continuationFailure("tampered", "durable continuation record has an invalid shape");
  }
  if (value.schema_version !== CONTINUATION_SCHEMA || value.identity !== expectedIdentity ||
      typeof value.contract_content_digest !== "string" ||
      typeof value.package_generation !== "string" ||
      !isPlainObject(value.package_continuation) || !isPlainObject(value.proof_graph)) {
    continuationFailure("tampered", "durable continuation record identity or fields are invalid");
  }
  try {
    normalizeControlledContractIdentity({ wkId: value.wk_id, focus: value.focus });
  } catch (error) {
    continuationFailure("tampered", "durable continuation record scope is invalid", {
      cause_code: error?.code ?? null
    });
  }
  assertOneControlledContractSemanticOwner(value);
  const pkg = await loadControlledContractPackage();
  assertServerOwnedSourceDeclaration(
    value.proof_graph.expected_sources, pkg.PROOF_GRAPH_CARRIER_KINDS);
  let admitted;
  try {
    admitted = pkg.validateProofGraphProposal(value.proof_graph.proposal);
  } catch (error) {
    continuationFailure("tampered", "durable continuation proposal is invalid", {
      cause_code: error?.code ?? null
    });
  }
  if (value.proof_graph.proposal_digest !==
      digestBytes(canonicalJsonBytes(admitted.server_projection))) {
    continuationFailure("tampered", "durable continuation proposal digest changed", {
      field: "proof_graph.proposal_digest"
    });
  }
  const recomputed = contentAddressedContinuation(value);
  if (recomputed.identity !== expectedIdentity) continuationFailure("tampered",
    "durable continuation content does not match its identity");
  return deepFreezePlainData(structuredClone(value));
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
  expectedSources = null
}) {
  normalizeControlledContractIdentity({ wkId, focus });
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
    skeleton_digest: digestBytes(canonicalJsonBytes(skeleton)),
    semantic_bindings: structuredClone(skeleton.evaluation_input),
    proof_graph: {
      status: "bound",
      proposal_digest: digestBytes(canonicalJsonBytes(admitted.server_projection)),
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

export async function rememberControlledContractRefactorContinuation({
  repoRoot, wkId, focus = null, contractContentDigest, packageGeneration,
  source, planIdentity, snapshotDigest, packageResult, coverage, sourceLease
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  if (typeof contractContentDigest !== "string" ||
      typeof packageGeneration !== "string" || !isPlainObject(source) ||
      typeof planIdentity !== "string" || typeof snapshotDigest !== "string" ||
      !isPlainObject(packageResult) || !isPlainObject(coverage) ||
      !isPlainObject(sourceLease)) continuationFailure("invalid",
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
      package_result: structuredClone(packageResult),
      coverage: structuredClone(coverage),
      source_lease: structuredClone(sourceLease),
      receipt: null
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
      typeof key !== "string" || !["status", "receipt"].includes(key))) {
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
  repoRoot, wkId, focus = null, identity, changes
}) {
  normalizeControlledContractIdentity({ wkId, focus });
  const store = await continuationStore(repoRoot);
  const locked = await acquireStoreLock(store, wkId);
  try {
    const current = await getControlledContractAuthoringContinuation({ repoRoot, identity });
    if (!current?.proof_graph) continuationFailure("unknown",
      "proof-graph continuation is unavailable");
    if (current.wk_id !== wkId || current.focus !== (focus ?? null)) {
      continuationFailure("tampered", "proof-graph continuation update scope changed");
    }
    const updated = contentAddressedContinuation({
      ...current,
      proof_graph: { ...current.proof_graph, ...structuredClone(changes) }
    });
    await authenticateRecord(updated, updated.identity);
    await continuationPersistenceBoundary("transition_cas_owner", {
      source_identity: identity, target_identity: updated.identity,
      target_status: updated.proof_graph.status,
      wk_id: wkId, focus: focus ?? null,
      owner_token: locked.record.token
    });
    const filename = transitionPath(store, identity);
    const existing = await readTransitionFile(filename, identity, { missing: true });
    if (existing !== null) {
      if (existing.target.identity === updated.identity &&
          sameJsonValue(existing.target, updated)) {
        await continuationPersistenceBoundary("equivalent_transition_observed", {
          source_identity: identity, target_identity: updated.identity
        });
        return existing.target;
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
    return (await readTransitionFile(filename, identity)).target;
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
