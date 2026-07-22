

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "@agent-chassis/wiki-core";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  WK_SUBJECT_RE,
  EXACT_IMPLEMENTATION_SLICE_RE,
  WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
  WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1,
  WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2,
  WORKTREE_CHECKOUT_MODE_FULL
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";

import {
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "./host-write-authority-substrate/terminal-review-materialization.mjs";
import { managedRefusal, MANAGED_LIFECYCLE_REQUIRED } from "./backend-provisioning-state.mjs";

export function scopeAuthorityRefusal(blocker, detail = null) {
  return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, { blocker, ...detail });
}

export function firstOwnField(source, fields) {
  if (!isPlainObject(source)) return null;
  return fields.find((field) => Object.prototype.hasOwnProperty.call(source, field)) ?? null;
}

function normalizeCanonicalScope(entries, label, recordPath, { required = true } = {}) {
  if (!Array.isArray(entries)) {
    if (!required && entries === undefined) return Object.freeze([]);
    throw new Error(`${label} for the exact selected unit must be an array in ${recordPath}`);
  }
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
        path.posix.isAbsolute(entry) || entry.startsWith("-") || entry.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(entry) || path.posix.normalize(entry) !== entry ||
        entry === "." || entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`${label} contains a non-canonical repository-relative path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    if (entry.split("/").includes(".git")) {
      throw new Error(`${label} contains a forbidden Git metadata path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    normalized.push(entry);
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function assertPathWithin(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes or aliases the canonical repository root`);
  }
}

function validateScopePathType(mainRepo, scopePath, label, { writable = false } = {}) {
  const wildcardIndex = scopePath.split("/").findIndex((part) => /[*?[]/.test(part));
  if (wildcardIndex === 0) {
    throw new Error(`${label} root-wide wildcard scope is unsupported: ${JSON.stringify(scopePath)}`);
  }
  if (writable && wildcardIndex !== -1) {
    throw new Error(`${label} wildcard write targets are unsupported: ${JSON.stringify(scopePath)}`);
  }
  const parts = wildcardIndex === -1 ? scopePath.split("/") : scopePath.split("/").slice(0, wildcardIndex);
  let current = mainRepo;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const final = index === parts.length - 1;
    if (!existsSync(current)) {
      if (writable && final && wildcardIndex === -1) return;
      throw new Error(`${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${JSON.stringify(current)}`);
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} crosses a symlink at ${JSON.stringify(current)}`);
    }
    if (!final && !stat.isDirectory()) {
      throw new Error(`${label} has a path-type conflict at non-directory ${JSON.stringify(current)}`);
    }
  }
  if (parts.length > 0) {
    assertPathWithin(mainRepo, realpathSync(current), label);
  }
}

export function resolveFrozenWorkerScopeAuthority({ mainRepo, subject, record, slice }) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match || record?.id !== match[1] || slice?.id !== match[2] || slice.work_kind !== "implementation") {
    throw new Error("exact canonical implementation slice identity is unresolved or mismatched");
  }
  const requestedRepo = path.resolve(mainRepo);
  const repo = realpathSync(requestedRepo);
  if (requestedRepo !== repo) {
    throw new Error("launcher-provisioned mainRepo must not contain a symlink or path alias");
  }
  const recordPath = path.join(repo, "wiki", "work-records", `${match[1]}.json`);
  validateScopePathType(repo, `wiki/work-records/${match[1]}.json`, "canonical work-record source");
  const recordRealPath = realpathSync(recordPath);
  assertPathWithin(repo, recordRealPath, "canonical work-record source");
  const readScope = normalizeCanonicalScope(slice.read_scope, "read_scope", recordPath, { required: false });
  const repoPaths = normalizeCanonicalScope(slice.repo_paths, "repo_paths", recordPath, { required: false });
  const writeScope = normalizeCanonicalScope(slice.write_scope, "write_scope", recordPath);
  for (const entry of readScope) validateScopePathType(repo, entry, "read_scope");
  for (const entry of repoPaths) validateScopePathType(repo, entry, "repo_paths");
  for (const entry of writeScope) validateScopePathType(repo, entry, "write_scope", { writable: true });
  if (record.schema_version !== undefined &&
      (typeof record.schema_version !== "string" || record.schema_version.length === 0)) {
    throw new Error("canonical work-record schema_version is incompatible");
  }
  const selectedUnit = Object.freeze({
    kind: "slice",
    address: subject,
    record_id: match[1],
    slice_id: match[2],
    repo: record.repo ?? null
  });
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
    unit_address: `${record.initiative}/${match[1]}/${match[2]}`,
    selected_unit: selectedUnit,
    source: `wiki/work-records/${match[1]}.json#${match[2]}`,
    source_digest: computeWorkRecordSourceDigest(record),
    source_version: record.schema_version ?? null,
    read_scope: readScope,
    repo_paths: repoPaths,
    readable_scope: Object.freeze([...new Set([...readScope, ...repoPaths])].sort()),
    write_scope: writeScope
  });
}

export function deepFreezeCanonicalSnapshot(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreezeCanonicalSnapshot(child);
  return Object.freeze(value);
}

export function sameStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index]);
}

export function assertProvisionedScopeAuthority(binding, authority) {
  if (!isPlainObject(binding)) throw new Error("launcher-provisioned exact-unit binding is absent");
  const selected = binding.selected_unit;
  const expectedSelected = authority.selected_unit;
  const scalarMismatch = [
    ["unit_address", binding.unit_address, authority.unit_address],
    ["write_scope_source", binding.write_scope_source, authority.source],
    ["source_digest", binding.source_digest, authority.source_digest],
    ["source_version", binding.source_version, authority.source_version]
  ].find(([, actual, expected]) => actual !== expected);
  if (scalarMismatch) {
    throw new Error(`launcher-provisioned authority mismatch at ${scalarMismatch[0]}`);
  }
  for (const [field, expected] of [
    ["read_scope", authority.read_scope],
    ["repo_paths", authority.repo_paths],
    ["write_scope", authority.write_scope]
  ]) {
    if (!sameStringArray(binding[field], expected)) {
      throw new Error(`launcher-provisioned authority mismatch at ${field}`);
    }
  }
  if (!isPlainObject(selected) || ["kind", "address", "record_id", "slice_id", "repo"]
    .some((field) => selected[field] !== expectedSelected[field])) {
    throw new Error("launcher-provisioned authority selected-unit identity mismatch");
  }

  if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1) {
    if (binding.index_sparse !== false || !Array.isArray(binding.cone_dirs) || binding.cone_dirs.length === 0 ||
        Object.prototype.hasOwnProperty.call(binding, "checkout_mode")) {
      throw new Error("launcher-provisioned sparse (v1) authority binding is incomplete or carries a full-mode checkout_mode");
    }
  } else if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2) {
    if (binding.checkout_mode !== WORKTREE_CHECKOUT_MODE_FULL ||
        Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
        Object.prototype.hasOwnProperty.call(binding, "index_sparse")) {
      throw new Error("launcher-provisioned full (v2) authority binding is incomplete or carries sparse cone facts");
    }
  } else {
    throw new Error("launcher-provisioned authority binding carries an unknown checkout-mode discriminant");
  }
  return binding;
}

export function readCanonicalWorkRecord(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(WK_SUBJECT_RE) : null;
  if (!match) return null;
  try {
    const requestedRepo = path.resolve(mainRepo);
    const repo = realpathSync(requestedRepo);
    if (requestedRepo !== repo) return null;
    const relativeRecordPath = `wiki/work-records/${match[1]}.json`;
    validateScopePathType(repo, relativeRecordPath, "canonical work-record source");
    return JSON.parse(readFileSync(path.join(repo, relativeRecordPath), "utf8"));
  } catch {
    return null;
  }
}

function isCanonicalFindingsOnlyReviewSlice(slice) {
  if (!isPlainObject(slice) || slice.work_kind !== "review" ||
      slice.review_purpose !== "terminal_whole_wk" ||
      !Array.isArray(slice.write_scope) || slice.write_scope.length !== 0 ||
      slice.dispatch_intent?.intended_agent_role !== "reviewer" ||
      slice.dispatch_intent?.target_unit !== "slice" ||
      slice.status === "done" || slice.status === "cancelled") {
    return false;
  }
  return true;
}

export function resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId) {
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId || !/^IN-\d{4}$/u.test(record.initiative ?? "") ||
      !Array.isArray(record.slices)) {
    throw new Error(`canonical ${wkId} record is unavailable for whole-WK review`);
  }
  const eligible = record.slices.filter(isCanonicalFindingsOnlyReviewSlice);
  if (eligible.length !== 1) {
    throw new Error(`canonical ${wkId} record must contain exactly one eligible findings-only review slice; found ${eligible.length}`);
  }
  const slice = eligible[0];

  const contracts = projectSliceReviewReceiptContracts(record, slice.id);
  if (contracts.slice_review_contract === null) {
    throw new Error(`canonical ${wkId} findings-only review slice is absent from its own review contract projection`);
  }
  return Object.freeze({
    record_id: wkId,
    slice_id: slice.id,
    subject: `${wkId}#${slice.id}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    review_unit_contract: contracts.slice_review_contract
  });
}

export function assertFrozenReviewTarget(target) {
  if (!isPlainObject(target) ||
      typeof target.ref !== "string" || !/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(target.ref) ||
      typeof target.sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.sha) ||
      target.diff_head_sha !== target.sha ||
      typeof target.diff_base_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.diff_base_sha) ||
      target.diff_range !== `${target.diff_base_sha}..${target.sha}` ||
      target.complete_parent_wk_contract !== true || target.accumulated_wk_diff !== true) {
    throw new Error("frozen whole-WK review target is incomplete or incompatible");
  }
  return target;
}

function runFrozenReviewTargetObjectStoreProbes({ mainRepo, probes, runGit }) {
  for (const probe of probes) {
    const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
    if (!result || result.ok !== true) {

      if (result && result.error != null && result.status == null) {
        return {
          ok: false,
          kind: "transport",
          detail: { probe: probe.name, rev: probe.rev, error: String(result.error) }
        };
      }
      return {
        ok: false,
        kind: "disagreement",
        detail: {
          probe: probe.name,
          rev: probe.rev,
          status: result?.status ?? null,
          stderr: result?.stderr ?? null
        }
      };
    }
    const actual = String(result.stdout ?? "").trim();
    if (actual !== probe.expect) {
      return {
        ok: false,
        kind: "disagreement",
        detail: { probe: probe.name, rev: probe.rev, expected: probe.expect, actual }
      };
    }
  }
  return { ok: true };
}

export { assertTerminalReviewMaterializationAttestation } from "./host-write-authority-substrate/terminal-review-materialization.mjs";

export function verifyFrozenWkReviewTargetAgainstObjectStore({ mainRepo, context, runGit = defaultRunGit }) {
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "wk_ref_resolves_to_frozen_sha", rev: `${context.wk_ref}^{commit}`, expect: context.wk_sha },
      { name: "frozen_commit_object_present", rev: `${context.wk_sha}^{commit}`, expect: context.wk_sha },
      { name: "frozen_diff_base_object_present", rev: `${context.diff_base_sha}^{commit}`, expect: context.diff_base_sha }
    ]
  });
}

const SLICE_REVIEW_TARGET_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function assertFrozenSliceReviewTarget(target) {
  if (!isPlainObject(target) ||
      typeof target.ref !== "string" || !SLICE_REVIEW_TARGET_REF_RE.test(target.ref) ||
      typeof target.sha !== "string" || !OID_RE.test(target.sha) ||
      target.diff_head_sha !== target.sha ||
      typeof target.diff_base_sha !== "string" || !OID_RE.test(target.diff_base_sha) ||
      target.diff_base_sha === target.sha ||
      target.diff_range !== `${target.diff_base_sha}..${target.sha}` ||
      target.slice_level_review !== true ||
      Object.prototype.hasOwnProperty.call(target, "complete_parent_wk_contract") ||
      Object.prototype.hasOwnProperty.call(target, "accumulated_wk_diff")) {
    throw new Error("frozen slice-level review target is incomplete or incompatible");
  }
  return target;
}

export function verifyFrozenSliceReviewTargetAgainstObjectStore({ mainRepo, context, runGit = defaultRunGit }) {
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "slice_ref_resolves_to_reviewed_sha", rev: `${context.slice_ref}^{commit}`, expect: context.reviewed_sha },
      { name: "reviewed_commit_object_present", rev: `${context.reviewed_sha}^{commit}`, expect: context.reviewed_sha },
      { name: "slice_diff_base_object_present", rev: `${context.diff_base_sha}^{commit}`, expect: context.diff_base_sha }
    ]
  });
}

export function resolveCanonicalSliceReviewUnit(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) {
    throw new Error(`canonical slice-review subject is not an exact implementation-slice address: ${JSON.stringify(subject)}`);
  }
  const wkId = match[1];
  const sliceId = match[2];
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId || !/^IN-\d{4}$/u.test(record.initiative ?? "") ||
      !Array.isArray(record.slices)) {
    throw new Error(`canonical ${wkId} record is unavailable for slice-level review`);
  }
  if (record.status === "review") {
    throw new Error(`canonical ${wkId} is in whole-WK review; a slice-level review requires an active parent`);
  }
  const slice = record.slices.find((entry) => entry?.id === sliceId);
  if (!isPlainObject(slice) || slice.work_kind !== "implementation" || slice.status !== "review") {
    throw new Error(`canonical slice ${wkId}#${sliceId} is not an implementation slice under slice-level review`);
  }

  const contracts = projectSliceReviewReceiptContracts(record, sliceId);
  if (contracts.slice_review_contract === null) {
    throw new Error(`canonical slice ${wkId}#${sliceId} is absent from its own review contract projection`);
  }
  return Object.freeze({
    record_id: wkId,
    slice_id: sliceId,
    subject: `${wkId}#${sliceId}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: contracts.canonical_parent_wk_contract,
    review_unit_contract: contracts.slice_review_contract
  });
}

export function resolveFrozenSliceReviewReceiptContract(receipt) {
  let record;
  let slice;
  try {
    record = JSON.parse(receipt?.canonical_parent_wk_contract);
    slice = JSON.parse(receipt?.slice_review_contract);
  } catch (error) {
    throw new Error("exact slice review receipt frozen contract is not valid JSON", { cause: error });
  }
  if (!isPlainObject(record) || record.id !== receipt.record_id ||
      record.initiative !== receipt.initiative || record.status === "review" ||
      !Array.isArray(record.slices) || !isPlainObject(slice) ||
      slice.id !== receipt.slice_id || slice.work_kind !== "implementation" ||
      slice.status !== "review") {
    throw new Error("exact slice review receipt frozen contract is not a pre-integration review unit");
  }
  const parentSlice = record.slices.find((entry) => entry?.id === receipt.slice_id);

  if (!isPlainObject(parentSlice) ||
      canonicalizeWorkRecordJson(parentSlice) !== canonicalizeWorkRecordJson(slice)) {
    throw new Error("exact slice review receipt parent and slice contracts disagree");
  }
  return Object.freeze({
    record_id: receipt.record_id,
    slice_id: receipt.slice_id,
    subject: receipt.unit_address,
    initiative: receipt.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
    review_unit_contract: receipt.slice_review_contract
  });
}

export function resolveCanonicalIntegratedSliceState(mainRepo, subject, frozenContract = null) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match) throw new Error("integrated slice subject is not canonical");
  const record = readCanonicalWorkRecord(mainRepo, match[1]);
  const slice = record?.slices?.find((entry) => entry?.id === match[2]);
  if (!record || record.id !== match[1] || !/^IN-\d{4}$/u.test(record.initiative ?? "") ||
      !isPlainObject(slice) || slice.work_kind !== "implementation") {
    throw new Error("canonical integrated slice identity is unavailable");
  }
  const incompleteSiblings = record.slices.filter((entry) =>
    entry?.id !== match[2] && entry?.work_kind === "implementation" &&
    entry.status !== "done" && entry.status !== "cancelled"
  );
  const final = record.status === "review";
  if (final) {
    if (incompleteSiblings.length !== 0 || (slice.status !== "review" && slice.status !== "done")) {
      throw new Error("canonical final integrated slice state is inconsistent");
    }
  } else if (slice.status !== "done" || incompleteSiblings.length === 0) {
    throw new Error("canonical non-final integrated slice state is inconsistent");
  }
  if (frozenContract !== null) {
    const frozenRecord = JSON.parse(frozenContract.canonical_parent_wk_contract);

    const normalizedCurrent = projectSliceReviewReceiptContracts(record, match[2]).parent;

    normalizedCurrent.status = frozenRecord.status;
    const normalizedSlice = normalizedCurrent.slices.find((entry) => entry?.id === match[2]);
    const frozenSlice = frozenRecord.slices.find((entry) => entry?.id === match[2]);
    if (!normalizedSlice || !frozenSlice) {
      throw new Error("canonical integrated slice is absent from the frozen receipt contract");
    }
    normalizedSlice.status = frozenSlice.status;

    if (canonicalizeWorkRecordJson(normalizedCurrent) !== frozenContract.canonical_parent_wk_contract) {
      throw new Error("canonical integrated state changed beyond the permitted lifecycle transition");
    }
  }
  return Object.freeze({
    record_id: match[1],
    slice_id: match[2],
    initiative: record.initiative,
    final,
    parent_status: record.status,
    slice_status: slice.status
  });
}

export function verifyFrozenReceiptObjectsAgainstObjectStore({ mainRepo, receipt, runGit = defaultRunGit }) {
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "reviewed_commit_object_present", rev: `${receipt.reviewed_sha}^{commit}`, expect: receipt.reviewed_sha },
      { name: "slice_diff_base_object_present", rev: `${receipt.diff_base_sha}^{commit}`, expect: receipt.diff_base_sha }
    ]
  });
}
