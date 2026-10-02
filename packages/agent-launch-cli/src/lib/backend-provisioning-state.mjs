

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
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
import { parseLiteralCommitObject } from "./literal-commit-object.mjs";
import {
  EXACT_IMPLEMENTATION_SLICE_RE,
  MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
  REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { readCanonicalWorkRecord } from "./backend-scope-authority.mjs";
import { isLandedPublicationIdentity } from "./launcher-transition-plan.mjs";
import { projectProvisioningRefusal } from "./backend-provisioning-refusal-projection.mjs";

import { runMaybeAsyncGenerator } from "./slice-integration-authorization.mjs";
import {
  INTEGRATED_DELIVERY_OBSERVATION_STATES,
  classifyExactDirectCommitRef,
  observeIntegratedSliceDelivery
} from "./slice-integration.mjs";

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
  void plannedBaseAncestry;
  if (!Object.isFrozen(settlement) || settlement?.complete !== true ||
      !isPlainObject(settlement.slice_binding) || !isPlainObject(settlement.wk_binding) ||
      !isPlainObject(plannedBase) || typeof plannedBase.base_ref !== "string" ||
      !EXACT_OID_RE.test(plannedBase.base_sha ?? "")) {
    return Object.freeze({
      ok: false,
      reason: "launcher_transition_settlement_unverifiable"
    });
  }
  const expectedRef = observedBase?.base_ref ?? plannedBase.base_ref;
  const expectedSha = observedBase?.base_sha ?? plannedBase.base_sha;
  if (typeof expectedRef !== "string" || !EXACT_OID_RE.test(expectedSha ?? "")) {
    return Object.freeze({
      ok: false,
      reason: "launcher_transition_settlement_unverifiable"
    });
  }
  const mismatches = [
    ["slice_binding.base_ref", expectedRef, settlement.slice_binding.base_ref],
    ["slice_binding.base_sha", expectedSha, settlement.slice_binding.base_sha],
    ["wk_binding.output_branch", expectedRef, settlement.wk_binding.output_branch],
    ["wk_binding.wk_tip_sha", expectedSha, settlement.wk_binding.wk_tip_sha]
  ];
  const mismatch = mismatches.find(([, expected, actual]) => expected !== actual);
  if (mismatch) {
    return Object.freeze({
      ok: false,
      reason: "launcher_transition_planned_base_mismatch",
      mismatch_field: mismatch[0],
      expected: mismatch[1],
      actual: mismatch[2] ?? null
    });
  }
  return Object.freeze({ ok: true, reason: null });
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

function observeExactWkTip(runGit, mainRepo, wkRef) {
  return runMaybeAsyncGenerator(function* exactWkTipSteps() {
    const sha = resolveExactRefCommit(runGit, mainRepo, wkRef);
    if (sha !== null) return Object.freeze({ state: "present", sha });
    const exactRef = wkRef.startsWith("refs/") ? wkRef : `refs/heads/${wkRef}`;
    const classified = yield classifyExactDirectCommitRef(runGit, mainRepo, exactRef);
    if (classified.refusal === "missing") return Object.freeze({ state: "absent", sha: null });
    return Object.freeze({
      state: "unreadable",
      sha: null,
      cause: Object.freeze({
        show_ref: "unresolved",
        exact_ref: classified.refusal ?? "resolved_after_show_ref_unresolved",
        ...(classified.read === undefined ? {} : { read: classified.read })
      })
    });
  });
}

function unreadableWkTipFailure(wkRef, observed, observationPoint) {
  return exactSliceResolutionFailure("scope_existence_base_unresolved", {
    wk_ref: wkRef,
    wk_tip_observation: "unreadable",
    observation_point: observationPoint,
    wk_tip_read_cause: observed.cause
  });
}

function literalReadFailure(detail, oid, parseReason = null) {
  return {
    commit: null,
    failure: { detail, object: oid, ...(parseReason === null ? {} : { parse_reason: parseReason }) }
  };
}

function readLiteralCommitOutcome(runGit, mainRepo, oid, cache) {
  if (!EXACT_OID_RE.test(oid) || /^0+$/u.test(oid)) {
    return literalReadFailure("literal_object_id_invalid", oid);
  }
  if (cache.has(oid)) return { commit: cache.get(oid), failure: null };
  const type = authorityGit(runGit, mainRepo, ["cat-file", "-t", oid]);
  if (type.ok !== true) return literalReadFailure("literal_commit_read_failed", oid);
  if (type.stdout !== "commit\n") return literalReadFailure("literal_object_not_commit", oid);
  const body = authorityGit(runGit, mainRepo, ["cat-file", "commit", oid]);
  if (body.ok !== true) return literalReadFailure("literal_commit_read_failed", oid);
  const parsed = parseLiteralCommitObject(body.stdout, oid);
  if (!parsed.ok) return literalReadFailure("literal_commit_malformed", oid, parsed.reason);
  cache.set(oid, parsed.commit);
  return { commit: parsed.commit, failure: null };
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
    const { commit, failure } = readLiteralCommitOutcome(runGit, mainRepo, entry.oid, cache);
    if (commit === null) return { state: "indeterminate", ...failure };
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

function resolveScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip, baseBranch }) {
  if (wkTip !== null) return Object.freeze({ base_ref: wkRef, base_sha: wkTip });
  let resolved;
  try {
    resolved = resolveIndependentUnitBase({ mainRepo, base: baseBranch, deps: { runGit } });
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

function resolveStableScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip, baseBranch }) {
  return runMaybeAsyncGenerator(function* stableScopeExistenceBaseSteps() {
  const captured = resolveScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip, baseBranch });
  if (captured === null) {
    return exactSliceResolutionFailure("scope_existence_base_unresolved", { wk_ref: wkRef });
  }
  const recheck = yield observeExactWkTip(runGit, mainRepo, wkRef);
  if (recheck.state === "unreadable") return unreadableWkTipFailure(wkRef, recheck, "recheck");
  const observed = resolveScopeExistenceBase({
    runGit,
    mainRepo,
    wkRef,
    wkTip: recheck.sha,
    baseBranch
  });
  if (observed === null || observed.base_ref !== captured.base_ref ||
      observed.base_sha !== captured.base_sha) {
    return exactSliceResolutionFailure("scope_existence_base_unstable", {
      wk_ref: wkRef,
      captured_scope_existence_base: captured,
      observed_scope_existence_base: observed,
      mismatch_field: "current_wk_tip",
      expected: captured.base_sha,
      actual: observed?.base_sha ?? null
    });
  }
  return { ok: true, scope_existence_base: captured };
  });
}

export const EXACT_SLICE_RESOLUTION_FAILURE_CLASSES = Object.freeze({
  LIFECYCLE: "lifecycle",
  DEPENDENCY: "dependency",

  DEPENDENCY_OBSERVATION: "dependency_observation",
  PUBLICATION: "publication"
});

export const EXACT_SLICE_RESOLUTION_FAILURE_REASONS = Object.freeze({
  [EXACT_SLICE_RESOLUTION_FAILURE_CLASSES.LIFECYCLE]: Object.freeze([
    "exact_slice_required",
    "exact_implementation_slice_unresolved",
    "exact_slice_accumulated_implementation_requires_integration",
    "launcher_transition_settlement_unverifiable",
    "launcher_transition_planned_base_mismatch",
    "scope_existence_base_unresolved",
    "scope_existence_base_selection_missing",
    "scope_existence_base_unstable"
  ]),
  [EXACT_SLICE_RESOLUTION_FAILURE_CLASSES.DEPENDENCY]: Object.freeze([
    "unit_dependencies_unmet",
    "dependency_identity_unresolved",
    "dependency_self_edge_forbidden",
    "dependency_not_present_on_wk_branch"
  ]),
  [EXACT_SLICE_RESOLUTION_FAILURE_CLASSES.DEPENDENCY_OBSERVATION]: Object.freeze([
    "dependency_observation_indeterminate"
  ]),
  [EXACT_SLICE_RESOLUTION_FAILURE_CLASSES.PUBLICATION]: Object.freeze([
    "dependency_publication_identity_unavailable",
    "dependency_publication_identity_mismatch",
    "dependency_publication_not_landed"
  ])
});

const EXACT_SLICE_FAILURE_CLASS_BY_REASON = new Map(
  Object.entries(EXACT_SLICE_RESOLUTION_FAILURE_REASONS).flatMap(
    ([failureClass, reasons]) => reasons.map((reason) => [reason, failureClass])
  )
);

export function resolveProspectiveScopeExistenceBase({
  mainRepo, initiative, recordId, baseBranch, deps = {}
}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const wkRef = perWkBranchRef(initiative, recordId);
  return runMaybeAsyncGenerator(function* prospectiveScopeExistenceBaseSteps() {
  const capturedWk = yield observeExactWkTip(runGit, mainRepo, wkRef);
  if (capturedWk.state === "unreadable") return unreadableWkTipFailure(wkRef, capturedWk, "capture");
  const wkTip = capturedWk.sha;
  if (wkTip === null && (typeof baseBranch !== "string" || baseBranch.length === 0)) {
    return exactSliceResolutionFailure("scope_existence_base_selection_missing", {
      wk_ref: wkRef,
      required_field: "base_branch"
    });
  }
  const stable = yield resolveStableScopeExistenceBase({ runGit, mainRepo, wkRef, wkTip, baseBranch });
  if (!stable.ok) return stable;
  return Object.freeze({
    ok: true,
    scope_existence_base: stable.scope_existence_base,
    source: wkTip === null ? "configured_base" : "wk_tip"
  });
  });
}

function exactSliceResolutionFailure(reason, detail = {}) {
  const failureClass = EXACT_SLICE_FAILURE_CLASS_BY_REASON.get(reason);
  if (failureClass === undefined) {
    throw new TypeError(`exact slice dependency resolution reason is unclassified: ${reason}`);
  }
  return Object.freeze({ ok: false, reason, failure_class: failureClass, ...detail });
}

export function resolveExactSliceDependencies(
  mainRepo,
  subject,
  deps = {},
  { settlement = null, plannedBase = null } = {}
) {
  const match = typeof subject === "string" ? subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/) : null;
  if (!match) return exactSliceResolutionFailure("exact_slice_required");
  const record = readCanonicalWorkRecord(mainRepo, subject);
  const slice = Array.isArray(record?.slices) ? record.slices.find((candidate) => candidate?.id === match[2]) : null;
  if (!record || !/^IN-\d{4}$/.test(record.initiative ?? "") || !slice || slice.work_kind !== "implementation") {
    return exactSliceResolutionFailure("exact_implementation_slice_unresolved");
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
  if (settlementBound) {
    const initialSettlement = revalidateLauncherTransitionSettlement({ settlement, plannedBase });
    if (!initialSettlement.ok) {
      return exactSliceResolutionFailure(initialSettlement.reason, {
        ...(initialSettlement.mismatch_field === undefined ? {} : {
          mismatch_field: initialSettlement.mismatch_field,
          expected: initialSettlement.expected,
          actual: initialSettlement.actual
        })
      });
    }
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const wkRef = perWkBranchRef(record.initiative, record.id);

  return runMaybeAsyncGenerator(function* capturedWkTipSteps() {
  const capturedWk = yield observeExactWkTip(runGit, mainRepo, wkRef);
  if (capturedWk.state === "unreadable") return unreadableWkTipFailure(wkRef, capturedWk, "capture");
  const wkTip = capturedWk.sha;
  if (settlementBound && wkTip === null) {
    return exactSliceResolutionFailure("scope_existence_base_unresolved", {
      wk_ref: wkRef,
      wk_tip_observation: "absent"
    });
  }
  const observedSettlement = settlementBound
    ? revalidateLauncherTransitionSettlement({
        settlement,
        plannedBase,
        observedBase: { base_ref: wkRef, base_sha: wkTip }
      })
    : Object.freeze({ ok: true });
  if (!observedSettlement.ok) {
    return exactSliceResolutionFailure(observedSettlement.reason, {
      ...(observedSettlement.mismatch_field === undefined ? {} : {
        mismatch_field: observedSettlement.mismatch_field,
        expected: observedSettlement.expected,
        actual: observedSettlement.actual
      })
    });
  }

  const continueResolution = (publicationEvidence, observations) =>
    runMaybeAsyncGenerator(function* continueResolutionSteps() {
    const publicationIdentities = new Map();
    for (let index = 0; index < publicationEvidence.length; index += 1) {
      const evidence = publicationEvidence[index];
      const observed = observations[index];

      if (observed?.ok === false && typeof observed.observation?.state === "string") {
        return exactSliceResolutionFailure("dependency_publication_not_landed", {
          dependency: evidence.address,
          owner: "landing_observer",
          landing_state: observed.observation.state,
          landing_cause: observed.observation.cause ?? null
        });
      }
      const identity = observed?.result ?? observed;
      if (!isLandedPublicationIdentity(identity) || identity.wk !== evidence.record_id) {
        return exactSliceResolutionFailure("dependency_publication_identity_mismatch", {
          dependency: evidence.address,
          owner: "WK-2313"
        });
      }
      publicationIdentities.set(evidence.record_id, identity);
    }
    const publicationProjection = settlementBound
      ? { publication_identities: Object.freeze([...publicationIdentities.values()]) }
      : {};
    if (dependencies.length === 0) {
      const stable = yield resolveStableScopeExistenceBase({
        runGit, mainRepo, wkRef, wkTip, baseBranch: record.base_branch
      });
      if (!stable.ok) return stable;
      return Object.freeze({
        ok: true,
        record,
        slice,
        dependency_evidence: dependencyEvidence,
        scope_existence_base: stable.scope_existence_base,
        ...publicationProjection
      });
    }
    const unmet = [];
    const indeterminate = [];
    const capturedDependencyRefs = new Map();
    const literalCache = new Map();
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

    if (wkTip !== null && dependencyTip === null && dependencyWkId === record.id &&
        dependencySliceId !== null) {
      const retained = yield classifyExactDirectCommitRef(runGit, mainRepo,
        dependencyRef.startsWith("refs/") ? dependencyRef : `refs/heads/${dependencyRef}`);
      if (retained.refusal !== "missing") {
        indeterminate.push({
          dependency,
          reason: "dependency_observation_indeterminate",
          wk_ref: wkRef,
          dependency_ref: dependencyRef,
          captured_wk_tip: wkTip,
          retained_delivery_sha: null,
          observation_state: INTEGRATED_DELIVERY_OBSERVATION_STATES.INDETERMINATE,
          observation_reason: "retained_delivery_ref_unobservable",
          retained_ref_refusal: retained.refusal,
          ...(retained.read === undefined ? {} : { failure: { read: retained.read } })
        });
        continue;
      }
    }
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

    if (dependencyWkId === record.id && dependencySliceId !== null) {
      let observed;
      try {
        observed = yield observeIntegratedSliceDelivery({
          mainRepo,
          unitAddress: `${record.initiative}/${record.id}/${dependencySliceId}`,
          sliceRef: dependencyRef,
          wkRef,
          capturedWkTip: wkTip,
          capturedDeliverySha: dependencyTip,
          record,
          deps: { runGit, loadCanonicalRecord: readCanonicalWorkRecord }
        });
      } catch (error) {
        observed = { state: null, reason: "integrated_delivery_observation_faulted",
          failure: { code: typeof error?.code === "string" ? error.code : null,
            message: String(error?.message ?? error).split("\n", 1)[0].slice(0, 240) } };
      }
      if (observed?.state === INTEGRATED_DELIVERY_OBSERVATION_STATES.PRESENT) continue;
      const observation = {
        dependency,
        wk_ref: wkRef,
        dependency_ref: dependencyRef,
        captured_wk_tip: wkTip,
        retained_delivery_sha: dependencyTip,
        observation_state: typeof observed?.state === "string" ? observed.state : null,
        observation_reason: typeof observed?.reason === "string"
          ? observed.reason
          : "integrated_delivery_observation_unresolved",
        ...(observed?.selector === undefined ? {} : { selector: observed.selector }),
        ...Object.fromEntries(["selector_sha", "authentication_reason", "inclusion_reason",
          "marker_reason", "marker_sha", "match_count", "ref", "expected", "observed", "failure"]
          .filter((field) => observed?.[field] !== undefined && field !== "selector_sha")
          .map((field) => [field, observed[field]]))
      };
      if (observed?.state === INTEGRATED_DELIVERY_OBSERVATION_STATES.ABSENT) {
        unmet.push({ ...observation, reason: "dependency_not_present_on_wk_branch",
          evidence: "integrated_delivery_absent" });
      } else {
        indeterminate.push({ ...observation, reason: "dependency_observation_indeterminate" });
      }
      continue;
    }

    const ancestry = probeExactAncestry(runGit, mainRepo, dependencyTip, wkTip, literalCache);
    if (ancestry.state === "ancestor") continue;
    unmet.push({
      dependency,
      reason: "dependency_not_present_on_wk_branch",
      wk_ref: wkRef,
      dependency_ref: dependencyRef,
      evidence: ancestry.state === "not_ancestor" ? "not_ancestor" : "ancestry_indeterminate",
      ...(ancestry.state === "not_ancestor" ? {} : {
        detail: ancestry.detail ?? null,
        ...(ancestry.object === undefined ? {} : { object: ancestry.object }),
        ...(ancestry.parse_reason === undefined ? {} : { parse_reason: ancestry.parse_reason })
      })
    });
    }

    if (indeterminate.length > 0) {
      return exactSliceResolutionFailure("dependency_observation_indeterminate", {
        indeterminate: indeterminate.map((entry) => entry.dependency),
        unmet: unmet.map((entry) => entry.dependency),
        dependency_diagnostics: [...indeterminate, ...unmet]
      });
    }
    if (unmet.length > 0) {
      return exactSliceResolutionFailure("unit_dependencies_unmet", {
        unmet: unmet.map((entry) => entry.dependency),
        dependency_diagnostics: unmet
      });
    }
    if (capturedDependencyRefs.size === 0) {
      const stable = yield resolveStableScopeExistenceBase({
        runGit, mainRepo, wkRef, wkTip, baseBranch: record.base_branch
      });
      if (!stable.ok) return stable;
      return Object.freeze({
        ok: true,
        record,
        slice,
        dependency_evidence: dependencyEvidence,
        scope_existence_base: stable.scope_existence_base,
        ...publicationProjection
      });
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
      return exactSliceResolutionFailure("unit_dependencies_unmet", {
        unmet: affected,
        dependency_diagnostics: affected.map((dependency) => ({
          dependency,
          reason: "dependency_ref_unstable",
          dependency_ref: dependencyRef,
          captured_dependency_tip: capturedDependencyTip,
          observed_dependency_tip: stableDependencyTip
        }))
      });
    }
    }
    const wkRecheck = yield observeExactWkTip(runGit, mainRepo, wkRef);
    if (wkRecheck.state === "unreadable") return unreadableWkTipFailure(wkRef, wkRecheck, "recheck");
    const stableWkTip = wkRecheck.sha;
    if (wkTip === null || stableWkTip === null || stableWkTip !== wkTip) {
      return exactSliceResolutionFailure("scope_existence_base_unstable", {
        wk_ref: wkRef,
        mismatch_field: "current_wk_tip",
        expected: wkTip,
        actual: stableWkTip
      });
    }

    return Object.freeze({
      ok: true,
      record,
      slice,
      dependency_evidence: dependencyEvidence,
      scope_existence_base: Object.freeze({ base_ref: wkRef, base_sha: wkTip }),
      ...publicationProjection
    });
    });

  const publicationEvidence = settlementBound
    ? dependencyEvidence.filter((evidence) =>
        evidence.target_work_kind === "implementation" &&
        evidence.target_status === "done" && evidence.record_id !== record.id
      )
    : [];
  const resolver = deps.resolveLandedPublicationIdentity;
  if (publicationEvidence.length > 0 && typeof resolver !== "function") {
    return exactSliceResolutionFailure("dependency_publication_identity_unavailable", {
      dependency: publicationEvidence[0].address,
      owner: "WK-2313"
    });
  }
  const observations = publicationEvidence.map((evidence) =>
    resolver({ dependency: evidence, subject, settlement })
  );
  if (observations.some((observed) => typeof observed?.then === "function")) {
    return Promise.all(observations).then(
      (resolved) => continueResolution(publicationEvidence, resolved),
      () => exactSliceResolutionFailure("dependency_publication_identity_unavailable", {
        dependency: publicationEvidence[0].address,
        owner: "WK-2313"
      })
    );
  }
  return continueResolution(publicationEvidence, observations);
  });
}

export function serializeManagedBootstrapFailure(error) {
  const diagnostic = serializeWorkRecordDiagnosticValue(error, {
    path: "managed_wk_bootstrap_failure"
  });
  const sourceCode = diagnostic !== null && typeof diagnostic === "object" &&
      typeof diagnostic.code === "string" &&
      /^[a-z][a-z0-9_.-]{0,159}$/u.test(diagnostic.code)
    ? diagnostic.code
    : null;
  return Object.freeze({
    cause: Object.freeze({
      type: "managed_wk_bootstrap_failure",
      code: sourceCode
    }),
    diagnostic
  });
}

export function provisioningRefusal(error, { requestedRepositoryAlias = null } = {}) {

  return projectProvisioningRefusal(error, serializeManagedBootstrapFailure(error), {
    requestedRepositoryAlias
  });
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
        serializeManagedBootstrapFailure(error)
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
