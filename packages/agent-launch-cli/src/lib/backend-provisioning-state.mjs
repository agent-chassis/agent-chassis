

import {
  RUNTIME_BLOCKER_CODES,
  getRuntimeBlockerEntry
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";
import {
  collectDeclaredInterRecordIds,
  resolveDependencyEvidenceVector
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch-dependencies.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import {
  defaultRunGit,
  perWkBranchRef,
  resolveIndependentUnitBase,
  sliceBranchRef
} from "./worktree-substrate.mjs";

import {
  SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES,
  SLICE_TIP_RECONCILE_STATES
} from "./worktree-substrate-exact-unit.mjs";
import {
  EXACT_IMPLEMENTATION_SLICE_RE,
  MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
  REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { readCanonicalWorkRecord } from "./backend-scope-authority.mjs";
import { buildServerGeneratedCommitMessage } from "./commit-tool-exposure-guard.mjs";
import { isForgeConfirmedLandedPublicationIdentity } from "./launcher-transition-plan.mjs";

import {
  SLICE_MARKER_EVIDENCE_STATES,
  authenticateZeroDeltaIntegrationEvidenceCandidate,
  boundedWkLifecycleObservation,
  classifySliceMarkerEvidenceFromRegion
} from "./slice-integration-authorization.mjs";

export function resolveProvisioningInitiative({ readiness, mainRepo, subject }) {
  const readinessCandidates = [
    readiness?.initiative,
    readiness?.unit?.initiative,
    readiness?.record?.initiative,
    readiness?.work_record?.initiative
  ];
  for (const candidate of readinessCandidates) {
    if (typeof candidate === "string" && /^IN-\d{4}$/.test(candidate)) {
      return candidate;
    }
  }
  const record = readCanonicalWorkRecord(mainRepo, subject);
  return typeof record?.initiative === "string" && /^IN-\d{4}$/.test(record.initiative)
    ? record.initiative
    : null;
}

export function normalizeProvisioningConfig(config) {
  if (!config || config.enabled === false) return null;
  if (!isPlainObject(config)) return null;
  if (REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(config, field)
  )) return null;
  if (typeof config.mainRepo !== "string" || config.mainRepo.length === 0) return null;
  if (typeof config.worktreeRoot !== "string" || config.worktreeRoot.length === 0) return null;
  return config;
}

export const MANAGED_LIFECYCLE_REQUIRED = RUNTIME_BLOCKER_CODES.MANAGED_LIFECYCLE_REQUIRED;
export const MANAGED_PROVISIONING_UNAVAILABLE = RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;

export const MANAGED_SLICE_TIP_RECONCILE_REQUIRED =
  RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED;
if (typeof MANAGED_LIFECYCLE_REQUIRED !== "string" || typeof MANAGED_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed-lifecycle blocker interface is absent or incompatible");
}
if (typeof MANAGED_SLICE_TIP_RECONCILE_REQUIRED !== "string") {
  throw new Error("WK-1694 slice-tip reconciliation blocker interface is absent or incompatible");
}

export function revalidateLauncherTransitionSettlement({
  settlement,
  plannedBase,
  observedBase = null,
  plannedBaseAncestry = null
} = {}) {
  const bindingMatches = Object.isFrozen(settlement) && settlement?.complete === true &&
    plannedBase?.base_ref === settlement?.slice_binding?.base_ref &&
    plannedBase?.base_sha === settlement?.slice_binding?.base_sha &&
    settlement?.wk_binding?.output_branch === plannedBase?.base_ref;
  const observedTipMatches = observedBase === null || (
    observedBase?.base_ref === plannedBase?.base_ref &&
    observedBase?.base_sha === settlement?.wk_binding?.wk_tip_sha &&
    plannedBaseAncestry?.state === "ancestor"
  );
  const ok = bindingMatches && observedTipMatches;
  return Object.freeze({
    ok,
    reason: ok ? null : "launcher_transition_planned_base_mismatch"
  });
}

const SLICE_TIP_RECONCILE_TAXONOMY_ENTRY =
  getRuntimeBlockerEntry(MANAGED_SLICE_TIP_RECONCILE_REQUIRED);
if (SLICE_TIP_RECONCILE_TAXONOMY_ENTRY?.actor_recovery !== "coordinator" ||
    typeof SLICE_TIP_RECONCILE_TAXONOMY_ENTRY?.recovery?.route !== "string") {
  throw new Error("WK-1694 slice-tip reconciliation blocker entry is absent or incompatible");
}

const SLICE_TIP_RECONCILE_BLOCKING_STATES = Object.freeze([
  SLICE_TIP_RECONCILE_STATES.ORPHANED
]);

function boundedString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function classifySliceTipReconcileRefusal(error) {
  if (error?.code !== SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED) return null;
  const detail = error.detail;
  if (!isPlainObject(detail)) return null;
  if (!SLICE_TIP_RECONCILE_BLOCKING_STATES.includes(detail.reconcile_state)) return null;
  const unit = typeof detail.unit_address === "string"
    ? detail.unit_address.match(/^IN-\d{4}\/(WK-\d{4})\/(SLICE-\d{3})$/u)
    : null;
  if (unit === null) return null;
  return {
    subject: `${unit[1]}#${unit[2]}`,
    reconcile_state: detail.reconcile_state,
    slice_tip: boundedString(detail.slice_tip),
    wk_base_ref: boundedString(detail.wk_base_ref),
    wk_base_sha: boundedString(detail.wk_base_sha)
  };
}

export function managedRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

const EXACT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_LITERAL_COMMITS = 100_000;

function authorityGit(runGit, mainRepo, args) {
  try {
    const result = runGit({ repo: mainRepo, args: ["--no-replace-objects", ...args] });
    if (!result || typeof result !== "object") {
      return { ok: false, error: "probe returned no result" };
    }
    if (result.ok !== true) return result;
    const stdout = result.stdout ?? "";
    if (typeof stdout !== "string") {
      return { ok: false, error: "probe returned non-string output" };
    }
    return { ...result, stdout };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

function resolveExactRefCommit(runGit, mainRepo, ref) {
  const exactRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
  const result = authorityGit(runGit, mainRepo, ["show-ref", "--verify", "--hash", exactRef]);
  if (!result || result.ok !== true || typeof result.stdout !== "string") return null;
  const sha = result.stdout.trim();
  return EXACT_OID_RE.test(sha) && !/^0+$/u.test(sha) ? sha : null;
}

function parseLiteralCommit(raw, oid) {
  if (typeof raw !== "string" || raw.includes("\uFFFD") || raw.includes("\0") || raw.includes("\r")) {
    return null;
  }
  const separator = raw.indexOf("\n\n");
  if (separator < 0) return null;
  const lines = raw.slice(0, separator).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) return null;
  const headers = [];
  let continuedKey = null;
  for (const line of lines) {
    if (line.startsWith(" ")) {
      if (continuedKey === null || continuedKey === "tree" || continuedKey === "parent" ||
          /[\x00-\x1f\x7f]/u.test(line.slice(1))) {
        return null;
      }
      continue;
    }
    const space = line.indexOf(" ");
    if (space <= 0 || space === line.length - 1) return null;
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (!/^[\x21-\x7e]+$/u.test(key) || value.startsWith(" ") || /[\x00-\x1f\x7f]/u.test(value)) {
      return null;
    }
    headers.push({ key, value });
    continuedKey = key;
  }
  const trees = headers.filter(({ key }) => key === "tree");
  const parents = headers.filter(({ key }) => key === "parent").map(({ value }) => value);
  if (trees.length !== 1) return null;
  const tree = trees[0].value;
  if (!EXACT_OID_RE.test(tree) || tree.length !== oid.length ||
      parents.some((parent) => !EXACT_OID_RE.test(parent) || parent.length !== oid.length)) return null;
  return Object.freeze({
    oid,
    tree,
    parents: Object.freeze(parents),
    message: raw.slice(separator + 2)
  });
}

function readLiteralCommit(runGit, mainRepo, oid, cache) {
  if (!EXACT_OID_RE.test(oid) || /^0+$/u.test(oid)) return null;
  if (cache.has(oid)) return cache.get(oid);
  const type = authorityGit(runGit, mainRepo, ["cat-file", "-t", oid]);
  if (type.ok !== true || type.stdout !== "commit\n") return null;
  const body = authorityGit(runGit, mainRepo, ["cat-file", "commit", oid]);
  if (body.ok !== true) return null;
  const commit = parseLiteralCommit(body.stdout, oid);
  if (commit === null) return null;
  cache.set(oid, commit);
  return commit;
}

function probeExactAncestry(runGit, mainRepo, ancestor, descendant, cache) {
  const visited = new Set();
  const active = new Set();
  const stack = [{ oid: descendant, exiting: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry.exiting) {
      active.delete(entry.oid);
      continue;
    }
    if (visited.has(entry.oid)) continue;
    if (active.has(entry.oid) || visited.size >= MAX_LITERAL_COMMITS) {
      return { state: "indeterminate", detail: active.has(entry.oid) ? "literal_parent_cycle" : "literal_traversal_bound" };
    }
    const commit = readLiteralCommit(runGit, mainRepo, entry.oid, cache);
    if (commit === null) return { state: "indeterminate", detail: "literal_commit_unreadable" };
    visited.add(entry.oid);
    active.add(entry.oid);
    stack.push({ oid: entry.oid, exiting: true });
    for (let index = commit.parents.length - 1; index >= 0; index -= 1) {
      const parent = commit.parents[index];
      if (active.has(parent)) return { state: "indeterminate", detail: "literal_parent_cycle" };
      if (!visited.has(parent)) stack.push({ oid: parent, exiting: false });
    }
  }
  return { state: visited.has(ancestor) ? "ancestor" : "not_ancestor" };
}

function canonicalRetainedMessage(commit, subject) {
  if (commit.parents.length !== 1) return null;
  const parent = commit.parents[0];
  const expected = `${buildServerGeneratedCommitMessage({ subject, base_sha: parent })}\n`;
  return commit.message === expected ? expected : null;
}

function parseGitQuotedPath(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  const bytes = [];
  if (!token.startsWith('"')) {
    for (const character of token) {
      const code = character.codePointAt(0);
      if (code < 0x20 || code > 0x7e || character === '"' || character === "\\") return null;
      bytes.push(code);
    }
  } else {
    if (token.length < 2 || !token.endsWith('"')) return null;
    const body = token.slice(1, -1);
    const namedEscapes = Object.freeze({
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      '"': 0x22,
      "\\": 0x5c
    });
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      const code = character.codePointAt(0);
      if (character !== "\\") {
        if (code < 0x20 || code > 0x7e || character === '"') return null;
        bytes.push(code);
        continue;
      }
      const escaped = body[index + 1];
      if (Object.prototype.hasOwnProperty.call(namedEscapes, escaped)) {
        bytes.push(namedEscapes[escaped]);
        index += 1;
        continue;
      }
      const octal = body.slice(index + 1, index + 4);
      if (!/^[0-7]{3}$/u.test(octal)) return null;
      const value = Number.parseInt(octal, 8);
      if (value > 0xff) return null;
      bytes.push(value);
      index += 3;
    }
  }
  if (bytes.length === 0 || bytes.includes(0)) return null;
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseRawObjectDelta(stdout, oidLength) {
  if (typeof stdout !== "string" || stdout.includes("\uFFFD")) return null;
  if (stdout.length === 0) return Object.freeze([]);
  if (!stdout.endsWith("\n")) return null;
  const records = [];
  for (const line of stdout.slice(0, -1).split("\n")) {
    const match = line.match(
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([ADMT])\t(.+)$/u
    );
    if (match === null || match[3].length !== oidLength || match[4].length !== oidLength) return null;
    const pathHex = parseGitQuotedPath(match[6]);
    if (pathHex === null) return null;
    records.push(`${match[1]} ${match[2]} ${match[3]} ${match[4]} ${match[5]} ${pathHex}`);
  }
  records.sort();
  if (new Set(records).size !== records.length) return null;
  return Object.freeze(records);
}

function fixedRawObjectDelta(runGit, mainRepo, parent, commit) {
  const result = authorityGit(runGit, mainRepo, [
    "-c", "core.quotePath=true",
    "-c", "color.ui=false",
    "diff-tree", "--raw", "-r", "--no-renames", "--no-abbrev",
    "--ignore-submodules=none", "--no-ext-diff", "--no-textconv", "--no-color",
    parent, commit
  ]);
  return result.ok === true ? parseRawObjectDelta(result.stdout, commit.length) : null;
}

function structuralDeltasEqual(left, right) {
  return left.length === right.length && left.every((record, index) => record === right[index]);
}

function replayEquivalentDependencyEvidence({
  runGit,
  mainRepo,
  observation,
  dependencyTip,
  record,
  slice,
  dependencyEvidence,
  literalCache
}) {
  const dependencyWkId = dependencyEvidence.record_id;
  const dependencySliceId = dependencyEvidence.slice_id;
  const canonicalAddress = dependencySliceId === null
    ? dependencyWkId
    : `${dependencyWkId}#${dependencySliceId}`;
  const addressMatches = dependencyEvidence.address === canonicalAddress ||
    (dependencyWkId === record.id && dependencyEvidence.address === dependencySliceId);
  if (dependencySliceId === null || dependencyWkId !== record.id) {
    return { admitted: false, evidence: "replay_marker_not_same_record_slice" };
  }
  if (dependencyEvidence.provenance !== "canonical_wk_json" ||
      dependencyEvidence.target_identity !== canonicalAddress ||
      !addressMatches || dependencyEvidence.target_initiative !== record.initiative) {
    return { admitted: false, evidence: "replay_marker_canonical_identity_mismatch" };
  }
  if (dependencySliceId === slice.id) {
    return { admitted: false, evidence: "replay_marker_self_edge_forbidden" };
  }
  let marker;
  try {
    marker = classifySliceMarkerEvidenceFromRegion({
      runGit,
      mainRepo,
      observation,
      wkId: dependencyWkId,
      sliceIds: [dependencySliceId]
    }).get(dependencySliceId);
  } catch (error) {
    return { admitted: false, evidence: "replay_marker_probe_faulted", detail: error?.message ?? String(error) };
  }
  if (marker?.state !== SLICE_MARKER_EVIDENCE_STATES.FOUND || !Array.isArray(marker.candidates)) {
    return {
      admitted: false,
      evidence: marker?.state === SLICE_MARKER_EVIDENCE_STATES.ABSENT
        ? "replay_marker_absent"
        : "replay_marker_indeterminate",
      detail: marker?.reason ?? null
    };
  }

  const retained = readLiteralCommit(runGit, mainRepo, dependencyTip, literalCache);
  const subject = `${dependencyWkId}#${dependencySliceId}`;
  const retainedMessage = retained === null ? null : canonicalRetainedMessage(retained, subject);
  if (retained === null || retainedMessage === null || retained.parents.length !== 1 ||
      readLiteralCommit(runGit, mainRepo, retained.parents[0], literalCache) === null) {
    return { admitted: false, evidence: "retained_delivery_not_canonical_single_parent" };
  }
  const retainedDelta = fixedRawObjectDelta(runGit, mainRepo, retained.parents[0], retained.oid);
  if (retainedDelta === null) {
    return { admitted: false, evidence: "retained_delivery_delta_indeterminate" };
  }

  const matches = [];
  for (const candidateOid of marker.candidates) {
    if (!EXACT_OID_RE.test(candidateOid) || /^0+$/u.test(candidateOid)) {
      return { admitted: false, evidence: "replay_candidate_indeterminate" };
    }
    const candidate = readLiteralCommit(runGit, mainRepo, candidateOid, literalCache);
    if (candidate === null || candidate.parents.length !== 1 ||
        readLiteralCommit(runGit, mainRepo, candidate.parents[0], literalCache) === null) {
      return { admitted: false, evidence: "replay_candidate_not_single_parent" };
    }
    const workerDeliveryMatch = candidate.message === retainedMessage;
    const zeroDeltaMatch = workerDeliveryMatch
      ? null
      : authenticateZeroDeltaIntegrationEvidenceCandidate({
          runGit,
          mainRepo,
          evidenceSha: candidate.oid,
          subject,
          deliverySha: retained.oid,
          baseSha: retained.parents[0]
        });
    if (!workerDeliveryMatch && zeroDeltaMatch === null) continue;
    const candidateDelta = fixedRawObjectDelta(runGit, mainRepo, candidate.parents[0], candidate.oid);
    if (candidateDelta === null) {
      return { admitted: false, evidence: "replay_candidate_delta_indeterminate" };
    }
    if (structuralDeltasEqual(candidateDelta, retainedDelta)) matches.push(candidate.oid);
  }
  return matches.length === 1
    ? {
        admitted: true,
        evidence: "replay_delivery_unique_match",
        marker_commit: matches[0],
        candidate_count: marker.candidates.length
      }
    : {
        admitted: false,
        evidence: matches.length === 0 ? "replay_delivery_zero_matches" : "replay_delivery_multiple_matches",
        detail: `matching_candidates:${matches.length}`
      };
}

function resolveScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip }) {
  if (wkTip !== null) return Object.freeze({ base_ref: wkRef, base_sha: wkTip });
  let resolved;
  try {
    resolved = resolveIndependentUnitBase({ mainRepo, deps: { runGit } });
  } catch {
    return null;
  }
  const baseRef = resolved?.base_ref;
  const baseSha = resolved?.base_sha;
  if (typeof baseRef !== "string" || baseRef.length === 0 || typeof baseSha !== "string" ||
      !EXACT_OID_RE.test(baseSha) || /^0+$/u.test(baseSha)) {
    return null;
  }
  return Object.freeze({ base_ref: baseRef, base_sha: baseSha });
}

function resolveStableScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip }) {
  const captured = resolveScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip });
  if (captured === null) {
    return { ok: false, reason: "scope_existence_base_unresolved", wk_ref: wkRef };
  }
  const observed = resolveScopeExistenceBase({
    runGit,
    mainRepo,
    wkRef,
    wkTip: resolveExactRefCommit(runGit, mainRepo, wkRef)
  });
  if (observed === null || observed.base_ref !== captured.base_ref ||
      observed.base_sha !== captured.base_sha) {
    return {
      ok: false,
      reason: "scope_existence_base_unstable",
      wk_ref: wkRef,
      captured_scope_existence_base: captured,
      observed_scope_existence_base: observed
    };
  }
  return { ok: true, scope_existence_base: captured };
}

export function resolveExactSliceDependencies(
  mainRepo,
  subject,
  deps = {},
  { settlement = null, plannedBase = null } = {}
) {
  const match = typeof subject === "string" ? subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/) : null;
  if (!match) return { ok: false, reason: "exact_slice_required" };
  const record = readCanonicalWorkRecord(mainRepo, subject);
  const slice = Array.isArray(record?.slices) ? record.slices.find((candidate) => candidate?.id === match[2]) : null;
  if (!record || !/^IN-\d{4}$/.test(record.initiative ?? "") || !slice || slice.work_kind !== "implementation") {
    return { ok: false, reason: "exact_implementation_slice_unresolved" };
  }
  const selectedUnit = { ...slice, kind: "slice" };
  const additionalRecords = new Map();
  for (const recordId of collectDeclaredInterRecordIds(record, selectedUnit)) {
    const dependencyRecord = readCanonicalWorkRecord(mainRepo, recordId);
    if (dependencyRecord !== null) additionalRecords.set(recordId, dependencyRecord);
  }
  const dependencyEvidence = resolveDependencyEvidenceVector({
    record,
    selectedUnit,
    dependencyStatuses: new Map(),
    additionalRecords
  });
  const dependencies = dependencyEvidence.map((entry) => entry.address);
  const settlementBound = settlement !== null || plannedBase !== null;
  if (settlementBound && !revalidateLauncherTransitionSettlement({ settlement, plannedBase }).ok) {
    return { ok: false, reason: "launcher_transition_settlement_unverifiable" };
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const wkRef = perWkBranchRef(record.initiative, record.id);

  const wkTip = resolveExactRefCommit(runGit, mainRepo, wkRef);
  const plannedBaseAncestry = settlementBound
    ? probeExactAncestry(runGit, mainRepo, plannedBase.base_sha, wkTip, new Map())
    : null;
  if (settlementBound && !revalidateLauncherTransitionSettlement({
    settlement,
    plannedBase,
    observedBase: { base_ref: wkRef, base_sha: wkTip },
    plannedBaseAncestry
  }).ok) {
    return {
      ok: false,
      reason: "launcher_transition_planned_base_mismatch",
      planned_base: plannedBase,
      observed_base: Object.freeze({ base_ref: wkRef, base_sha: wkTip })
    };
  }
  const publicationIdentities = new Map();
  if (settlementBound) {
    const publicationEvidence = dependencyEvidence.filter((evidence) =>
      evidence.target_work_kind === "implementation" &&
      evidence.target_status === "done" && evidence.record_id !== record.id
    );
    const resolver = deps.resolveForgeConfirmedLandedPublicationIdentity;
    if (publicationEvidence.length > 0 && typeof resolver !== "function") {
      return {
        ok: false,
        reason: "dependency_publication_identity_unavailable",
        dependency: publicationEvidence[0].address,
        owner: "WK-2313"
      };
    }
    const observations = publicationEvidence.map((evidence) =>
      resolver({ dependency: evidence, subject, settlement })
    );
    if (observations.some((observed) => typeof observed?.then === "function")) {
      return Promise.all(observations).then((resolved) => {
        const exactOutcomes = new Map(
          publicationEvidence.map((evidence, index) => [evidence.address, resolved[index]])
        );
        return resolveExactSliceDependencies(mainRepo, subject, {
          ...deps,
          resolveForgeConfirmedLandedPublicationIdentity: ({ dependency }) =>
            exactOutcomes.get(dependency.address) ?? null
        }, { settlement, plannedBase });
      }, () => ({
        ok: false,
        reason: "dependency_publication_identity_unavailable",
        dependency: publicationEvidence[0].address,
        owner: "WK-2313"
      }));
    }
    for (let index = 0; index < publicationEvidence.length; index += 1) {
      const evidence = publicationEvidence[index];
      const observed = observations[index];
      const identity = observed?.result ?? observed;
      if (!isForgeConfirmedLandedPublicationIdentity(identity) || identity.wk !== evidence.record_id) {
        return {
          ok: false,
          reason: "dependency_publication_identity_mismatch",
          dependency: evidence.address,
          owner: "WK-2313"
        };
      }
      publicationIdentities.set(evidence.record_id, identity);
    }
  }
  const publicationProjection = settlementBound
    ? { publication_identities: Object.freeze([...publicationIdentities.values()]) }
    : {};
  if (dependencies.length === 0) {
    const stable = resolveStableScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip });
    if (!stable.ok) return stable;
    return {
      ok: true,
      record,
      slice,
      dependency_evidence: dependencyEvidence,
      scope_existence_base: stable.scope_existence_base,
      ...publicationProjection
    };
  }
  const unmet = [];
  const capturedDependencyRefs = new Map();
  const literalCache = new Map();
  let replayObservation = null;
  let replayObservationFailure = null;
  for (const evidence of dependencyEvidence) {
    const dependency = evidence.address;
    if (evidence.marker === "fact_resolution_failed") {
      unmet.push({
        dependency,
        reason: evidence.marker,
        failure_code: evidence.failure_code ?? null,
        refusal_limb: evidence.refusal_limb ?? "mechanical_failure",
        provenance: evidence.provenance ?? "none"
      });
      continue;
    }
    if (evidence.external_repo !== null || evidence.provenance !== "canonical_wk_json" ||
        typeof evidence.record_id !== "string" || typeof evidence.target_identity !== "string") {
      unmet.push({ dependency, reason: "dependency_identity_unresolved" });
      continue;
    }
    const dependencyWkId = evidence.record_id;
    const dependencySliceId = evidence.slice_id;
    const canonicalTargetIdentity = dependencySliceId === null
      ? dependencyWkId
      : `${dependencyWkId}#${dependencySliceId}`;
    const dependencyAddressMatches = evidence.address === canonicalTargetIdentity ||
      (dependencyWkId === record.id && evidence.address === dependencySliceId);
    if (evidence.target_identity !== canonicalTargetIdentity || !dependencyAddressMatches) {
      unmet.push({ dependency, reason: "dependency_identity_unresolved" });
      continue;
    }
    if (dependencyWkId === record.id && dependencySliceId === slice.id) {
      unmet.push({ dependency, reason: "dependency_self_edge_forbidden" });
      continue;
    }

    if (evidence.target_work_kind !== "implementation") continue;
    if (!/^IN-\d{4}$/.test(evidence.target_initiative ?? "")) {
      unmet.push({ dependency, reason: "dependency_identity_unresolved" });
      continue;
    }
    const dependencyRef = dependencySliceId === null
      ? perWkBranchRef(evidence.target_initiative, dependencyWkId)
      : sliceBranchRef(evidence.target_initiative, dependencyWkId, dependencySliceId);
    const dependencyTip = capturedDependencyRefs.has(dependencyRef)
      ? capturedDependencyRefs.get(dependencyRef)
      : resolveExactRefCommit(runGit, mainRepo, dependencyRef);
    if (!capturedDependencyRefs.has(dependencyRef)) capturedDependencyRefs.set(dependencyRef, dependencyTip);
    if (wkTip === null || dependencyTip === null) {
      unmet.push({
        dependency,
        reason: "dependency_not_present_on_wk_branch",
        wk_ref: wkRef,
        dependency_ref: dependencyRef,
        evidence: "exact_oid_unresolved"
      });
      continue;
    }

    const ancestry = probeExactAncestry(runGit, mainRepo, dependencyTip, wkTip, literalCache);
    if (ancestry.state === "ancestor") continue;
    if (ancestry.state !== "not_ancestor") {
      unmet.push({
        dependency,
        reason: "dependency_not_present_on_wk_branch",
        wk_ref: wkRef,
        dependency_ref: dependencyRef,
        evidence: "ancestry_indeterminate",
        detail: ancestry.detail ?? null
      });
      continue;
    }
    if (replayObservation === null && replayObservationFailure === null) {
      try {
        replayObservation = boundedWkLifecycleObservation({
          runGit,
          mainRepo,
          initiative: record.initiative,
          wkId: record.id,
          wkTipSha: wkTip,
          recordSourceDigest: computeWorkRecordSourceDigest(record)
        });
      } catch (error) {
        replayObservationFailure = error;
      }
    }
    const replay = replayObservation === null
      ? {
          admitted: false,
          evidence: "replay_marker_indeterminate",
          detail: replayObservationFailure?.detail?.reason ??
            replayObservationFailure?.message ?? "bounded_history_indeterminate"
        }
      : replayEquivalentDependencyEvidence({
          runGit,
          mainRepo,
          observation: replayObservation,
          dependencyTip,
          record,
          slice,
          dependencyEvidence: evidence,
          literalCache
        });
    if (replay.admitted) continue;
    unmet.push({
      dependency,
      reason: "dependency_not_present_on_wk_branch",
      wk_ref: wkRef,
      dependency_ref: dependencyRef,
      evidence: replay.evidence,
      detail: replay.detail ?? null
    });
  }
  if (unmet.length > 0) {
    return {
      ok: false,
      reason: "unit_dependencies_unmet",
      unmet: unmet.map((entry) => entry.dependency),
      dependency_diagnostics: unmet
    };
  }
  if (capturedDependencyRefs.size === 0) {
    const stable = resolveStableScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip });
    if (!stable.ok) return stable;
    return {
      ok: true,
      record,
      slice,
      dependency_evidence: dependencyEvidence,
      scope_existence_base: stable.scope_existence_base,
      ...publicationProjection
    };
  }

  for (const [dependencyRef, capturedDependencyTip] of capturedDependencyRefs) {
    const stableDependencyTip = resolveExactRefCommit(runGit, mainRepo, dependencyRef);
    if (capturedDependencyTip === null || stableDependencyTip === null ||
        stableDependencyTip !== capturedDependencyTip) {
      const affected = dependencyEvidence.filter((evidence) => {
        if (evidence.target_work_kind !== "implementation" ||
            !/^IN-\d{4}$/.test(evidence.target_initiative ?? "")) return false;
        const ref = evidence.slice_id === null
          ? perWkBranchRef(evidence.target_initiative, evidence.record_id)
          : sliceBranchRef(
              evidence.target_initiative,
              evidence.record_id,
              evidence.slice_id
            );
        return ref === dependencyRef;
      }).map((evidence) => evidence.address);
      return {
        ok: false,
        reason: "unit_dependencies_unmet",
        unmet: affected,
        dependency_diagnostics: affected.map((dependency) => ({
          dependency,
          reason: "dependency_ref_unstable",
          dependency_ref: dependencyRef,
          captured_dependency_tip: capturedDependencyTip,
          observed_dependency_tip: stableDependencyTip
        }))
      };
    }
  }
  const stableWkTip = resolveExactRefCommit(runGit, mainRepo, wkRef);
  if (wkTip === null || stableWkTip === null || stableWkTip !== wkTip) {
    return {
      ok: false,
      reason: "unit_dependencies_unmet",
      unmet: dependencies.slice(),
      dependency_diagnostics: dependencies.map((dependency) => ({
        dependency,
        reason: "subject_wk_tip_unstable",
        wk_ref: wkRef,
        captured_wk_tip: wkTip,
        observed_wk_tip: stableWkTip
      }))
    };
  }

  return {
    ok: true,
    record,
    slice,
    dependency_evidence: dependencyEvidence,
    scope_existence_base: Object.freeze({ base_ref: wkRef, base_sha: wkTip }),
    ...publicationProjection
  };
}

export function provisioningRefusal(error) {

  const sourceCode = typeof error?.code === "string" &&
      /^[a-z][a-z0-9_.-]{0,159}$/u.test(error.code)
    ? error.code
    : null;
  const cause = Object.freeze({
    type: "managed_wk_bootstrap_failure",
    code: sourceCode
  });

  const reconcile = classifySliceTipReconcileRefusal(error);
  if (reconcile !== null) {
    return {
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: MANAGED_SLICE_TIP_RECONCILE_REQUIRED,
        detail: Object.freeze({
          cause,

          reconcile_state: reconcile.reconcile_state,
          slice_tip: reconcile.slice_tip,
          wk_base_ref: reconcile.wk_base_ref,
          wk_base_sha: reconcile.wk_base_sha,
          actor_recovery: SLICE_TIP_RECONCILE_TAXONOMY_ENTRY.actor_recovery,
          next_action: SLICE_TIP_RECONCILE_TAXONOMY_ENTRY.recovery.route,
          next_action_args: Object.freeze({ role: "reviewer", subject: reconcile.subject })
        })
      }
    };
  }
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: MANAGED_PROVISIONING_UNAVAILABLE,
      detail: Object.freeze({
        cause,
        recovery: Object.freeze({
          state: "no_supported_route",
          route: null
        })
      })
    }
  };
}

function invalidProvisioningStateRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

function normalizeProvisioningRetryId(value) {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export async function resolveProvisioningAttemptState({ attemptStateAuthority, input, initiative }) {
  let resolved;
  try {
    resolved = await attemptStateAuthority.resolve({
      role: input.role,
      subject: input.subject,
      initiative,
      launchRef: input.monitor_handle,
      runId: input.run_id
    });
  } catch (error) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_threw",
        { message: error?.message ?? String(error) }
      )
    };
  }

  if (resolved === null || resolved === undefined) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_required" }
      )
    };
  }
  if (!isPlainObject(resolved)) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "resolver_must_return_plain_object" }
      )
    };
  }
  const retryId = normalizeProvisioningRetryId(resolved.retryId ?? resolved.retry_id);
  if (retryId === null) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "retry_id_must_be_non_negative_integer" }
      )
    };
  }
  const disposition = resolved.disposition;
  const priorIdentity = resolved.priorIdentity ?? resolved.prior_identity ?? null;
  const livenessDeps = resolved.livenessDeps ?? resolved.liveness_deps ?? null;
  if (resolved.schema_version !== MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION ||
      resolved.unit_address !== `${initiative}/${input.subject.replace("#", "/")}` ||
      (disposition !== "initial" && disposition !== "reissue") ||
      (disposition === "initial" && (retryId !== 0 || priorIdentity !== null)) ||
      (disposition === "reissue" && (retryId === 0 || !isPlainObject(priorIdentity) ||
        typeof livenessDeps?.confirmPriorWorkerTerminated !== "function"))) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_identity_mismatch" }
      )
    };
  }
  return {
    ok: true,
    state: {
      schemaVersion: resolved.schema_version,
      disposition,
      retryId,
      priorIdentity,
      livenessDeps
    }
  };
}

function isTerminalRunStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function createLauncherOwnedManagedAttemptStateAuthority() {
  const attempts = new Map();

  async function refreshPriorLiveness(prior) {
    if (prior.terminated === true) return true;
    if (typeof prior.probe !== "function") return false;
    try {
      const outcome = await prior.probe();
      if (isTerminalRunStatus(outcome?.status)) {
        prior.terminated = true;
      }
    } catch {
      return false;
    }
    return prior.terminated === true;
  }

  return Object.freeze({
    async resolve({ role, subject, initiative, launchRef, runId }) {
      if (role !== "worker" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") ||
          typeof launchRef !== "string" || launchRef.length === 0 ||
          typeof runId !== "string" || runId.length === 0) {
        return null;
      }
      const unitAddress = `${initiative}/${subject.replace("#", "/")}`;
      const prior = attempts.get(unitAddress) ?? null;
      if (prior === null) {
        return Object.freeze({
          schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
          disposition: "initial",
          unit_address: unitAddress,
          retryId: 0,
          priorIdentity: null,
          livenessDeps: null
        });
      }
      const terminated = await refreshPriorLiveness(prior);
      const priorIdentity = Object.freeze({
        launchRef: prior.launchRef,
        runId: prior.runId,
        retryId: prior.retryId
      });
      const livenessDeps = Object.freeze({
        confirmPriorWorkerTerminated(candidate) {
          const identity = candidate?.priorIdentity;
          return terminated === true && candidate?.unitAddress === unitAddress &&
            candidate?.launchRef === launchRef && candidate?.runId === runId &&
            candidate?.retryId === prior.retryId + 1 &&
            identity?.launchRef === prior.launchRef && identity?.runId === prior.runId &&
            identity?.retryId === prior.retryId;
        }
      });
      return Object.freeze({
        schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
        disposition: "reissue",
        unit_address: unitAddress,
        retryId: prior.retryId + 1,
        priorIdentity,
        livenessDeps
      });
    },
    recordProvisioned({ unitAddress, launchRef, runId, retryId }) {
      attempts.set(unitAddress, {
        unitAddress,
        launchRef,
        runId,
        retryId,
        provisioning: null,
        terminated: false,
        probe: null
      });
    },
    recordProvisioningBinding({ unitAddress, launchRef, runId, retryId, provisioning }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId ||
          current.retryId !== retryId || !isPlainObject(provisioning)) {
        throw new Error("launcher-owned managed attempt identity changed before provisioning binding recording");
      }
      current.provisioning = provisioning;
    },
    resolveProvisioningBinding(status) {
      for (const current of attempts.values()) {
        if (current.runId === status?.run_id && current.launchRef === status?.monitor_handle &&
            current.provisioning && current.provisioning.record_id &&
            status?.subject === `${current.provisioning.record_id}#${current.provisioning.slice_id}`) {
          return current.provisioning;
        }
      }
      throw new Error("terminal worker run has no exact launcher-owned provisioning binding");
    },
    recordExecutorResult({ unitAddress, launchRef, runId, retryId, result, threw = false }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId || current.retryId !== retryId) {
        throw new Error("launcher-owned managed attempt identity changed before executor result recording");
      }
      current.probe = typeof result?.probe === "function" ? result.probe : null;
      current.terminated = threw === true || result?.accepted === false || isTerminalRunStatus(result?.status);
    }
  });
}
