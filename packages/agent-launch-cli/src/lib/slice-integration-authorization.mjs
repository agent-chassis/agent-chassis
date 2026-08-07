

import { readFileSync } from "node:fs";
import path from "node:path";

import { buildWkSliceMarkerTrailer } from "./commit-tool-exposure-guard.mjs";

export const SLICE_INTEGRATION_SCHEMA_VERSION = "slice-integration.v1";
export const SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION =
  "slice-integration-boundary-authorization.v1";
export const SLICE_INTEGRATION_POLICY_POSTURES = Object.freeze({
  FREE_SUBSTRATE: "free_substrate",
  CCE_POLICY: "cce_policy"
});

export const SLICE_INTEGRATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.slice_integration.invalid_arg.v1",
  BINDING_MISMATCH: "agent_launch.slice_integration.binding_mismatch.v1",
  WORKER_NOT_TERMINATED: "agent_launch.slice_integration.worker_not_terminated.v1",
  INDEX_RECONCILE_FAILED: "agent_launch.slice_integration.index_reconcile_failed.v1",
  SLICE_COMMIT_CONFLICT: "agent_launch.slice_integration.slice_commit_conflict.v1",
  SLICE_COMMIT_READ_INDETERMINATE:
    "agent_launch.slice_integration.slice_commit_read_indeterminate.v1",
  SLICE_COMMIT_COMPENSATION_CAS_LOST:
    "agent_launch.slice_integration.slice_commit_compensation_cas_lost.v1",
  SLICE_COMMIT_COMPENSATION_FAILED:
    "agent_launch.slice_integration.slice_commit_compensation_failed.v1",
  REBASE_CONFLICT: "agent_launch.slice_integration.rebase_conflict.v1",
  REBASE_RESTORE_FAILED: "agent_launch.slice_integration.rebase_restore_failed.v1",
  WK_ADVANCE_CONFLICT: "agent_launch.slice_integration.wk_advance_conflict.v1",
  REVIEW_FREEZE_FAILED: "agent_launch.slice_integration.review_freeze_failed.v1",
  BOUNDARY_AUTHORIZATION_MISSING:
    "agent_launch.slice_integration.boundary_authorization_missing.v1",
  BOUNDARY_AUTHORIZATION_MALFORMED:
    "agent_launch.slice_integration.boundary_authorization_malformed.v1",
  CCE_POLICY_DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  CCE_POLICY_UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",

  RECORD_CAS_EXHAUSTED: "agent_launch.slice_integration.record_cas_exhausted.v1",
  RECORD_WRITE_FAILED: "agent_launch.slice_integration.record_write_failed.v1",
  ZERO_DELTA_EVIDENCE_INDETERMINATE:
    "agent_launch.slice_integration.zero_delta_evidence_indeterminate.v1",
  ZERO_DELTA_EVIDENCE_AMBIGUOUS:
    "agent_launch.slice_integration.zero_delta_evidence_ambiguous.v1",
  ZERO_DELTA_STATUS_WITHOUT_EVIDENCE:
    "agent_launch.slice_integration.zero_delta_status_without_evidence.v1",
  ZERO_DELTA_LIFECYCLE_CONTRADICTION:
    "agent_launch.slice_integration.zero_delta_lifecycle_contradiction.v1",
  GIT_FAILED: "agent_launch.slice_integration.git_failed.v1"
});

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const EXACT_SLICE_SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;
export const SLICE_REF_RE = /^refs\/heads\/slice\/(IN-\d{4})\/(WK-\d{4})\/(SLICE-\d{3})$/;
export const WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/;

export class SliceIntegrationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "SliceIntegrationError";
    this.code = code ?? SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new SliceIntegrationError(`agent-launch slice-integration: ${message}`, {
    code,
    detail,
    cause
  });
}

export function assertOid(value, label) {
  if (typeof value !== "string" || !OID_RE.test(value) || /^0+$/u.test(value)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-zero git object id`);
  }
  return value;
}

function parseLiteralCommitBytes(raw, oid) {
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
  const treeHeaders = headers.filter(({ key }) => key === "tree");
  const parentHeaders = headers.filter(({ key }) => key === "parent");
  if (treeHeaders.length !== 1) return null;
  const tree = treeHeaders[0].value;
  const parents = parentHeaders.map(({ value }) => value);
  if (!OID_RE.test(tree) || tree.length !== oid.length ||
      parents.some((parent) => !OID_RE.test(parent) || parent.length !== oid.length)) {
    return null;
  }
  return Object.freeze({
    oid,
    tree,
    parents: Object.freeze(parents),
    message: raw.slice(separator + 2)
  });
}

export function normalizeRef(value, pattern, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  const ref = value.startsWith("refs/heads/") ? value : `refs/heads/${value}`;
  const match = ref.match(pattern);
  if (!match) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, `${label} is outside its exact-unit ref namespace`, { ref });
  }
  return { ref, match };
}

export function git(runGit, repo, args, label, code = SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(code, label, {
      args,
      status: result?.status ?? null,
      stderr: result?.stderr ?? result?.error ?? null
    });
  }
  return result;
}

export function revParse(runGit, repo, value) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${value}^{commit}`], `could not resolve ${value}`).stdout.trim();
  return assertOid(oid, value);
}

export function resolveTree(runGit, repo, rev) {
  const oid = git(runGit, repo, ["rev-parse", "--verify", `${rev}^{tree}`], `could not resolve the tree of ${rev}`).stdout.trim();
  return assertOid(oid, `${rev} tree`);
}

function assertEvidenceSubject(subject) {
  if (typeof subject !== "string" || !EXACT_SLICE_SUBJECT_RE.test(subject)) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "zero-delta evidence subject must be an exact canonical slice identity"
    );
  }
  return subject;
}

function assertEvidenceOidSet({ deliverySha, baseSha, wkParentSha }) {
  assertOid(deliverySha, "zero-delta evidence delivery");
  assertOid(baseSha, "zero-delta evidence base");
  assertOid(wkParentSha, "zero-delta evidence WK parent");
  if (deliverySha.length !== baseSha.length || deliverySha.length !== wkParentSha.length) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "zero-delta evidence object ids must use one repository object format"
    );
  }
}

export function buildZeroDeltaIntegrationEvidenceMessage({
  subject,
  deliverySha,
  baseSha,
  wkParentSha
}) {
  assertEvidenceSubject(subject);
  assertEvidenceOidSet({ deliverySha, baseSha, wkParentSha });
  return `agent-launch zero-delta integration evidence: ${subject}\n\n` +
    `Wk-Slice: ${subject}\n` +
    "Wk-Slice-Integration: v1\n" +
    `Wk-Slice-Delivery: ${deliverySha}\n` +
    `Wk-Slice-Base: ${baseSha}\n` +
    `Wk-Slice-Wk-Parent: ${wkParentSha}\n` +
    "Wk-Slice-Empty: true\n";
}

function exactReviewedDeliveryIdentity(runGit, mainRepo, subject, deliverySha, baseSha, cache = new Map()) {
  const delivery = readLiteralCommit(runGit, mainRepo, deliverySha, cache);
  if (delivery === null) return false;
  const expectedMessage =
    `agent-launch worker delivery: ${subject} (base ${baseSha.slice(0, 12)})\n\n` +
    `${buildWkSliceMarkerTrailer(subject)}\n`;
  return delivery.parents.length === 1 && delivery.parents[0] === baseSha &&
    OID_RE.test(delivery.tree ?? "") && delivery.tree.length === deliverySha.length &&
    delivery.message === expectedMessage;
}

export function resolveAuthenticatedExactSliceDeliveryBase({
  runGit,
  mainRepo,
  subject,
  deliverySha
}) {
  assertEvidenceSubject(subject);
  assertOid(deliverySha, "reviewed zero-delta delivery");
  const cache = new Map();
  const delivery = readLiteralCommit(runGit, mainRepo, deliverySha, cache);
  if (delivery === null) return null;
  if (delivery.parents.length !== 1) return null;
  const baseSha = delivery.parents[0];
  if (!OID_RE.test(baseSha) || baseSha.length !== deliverySha.length) return null;
  return exactReviewedDeliveryIdentity(runGit, mainRepo, subject, deliverySha, baseSha, cache)
    ? baseSha
    : null;
}

const ZERO_DELTA_EVIDENCE_MESSAGE_RE =
  /^agent-launch zero-delta integration evidence: ([^\n]+)\n\nWk-Slice: ([^\n]+)\nWk-Slice-Integration: ([^\n]+)\nWk-Slice-Delivery: ([^\n]+)\nWk-Slice-Base: ([^\n]+)\nWk-Slice-Wk-Parent: ([^\n]+)\nWk-Slice-Empty: ([^\n]+)\n$/u;

function classifyExactZeroDeltaEvidence({
  runGit,
  mainRepo,
  candidate,
  subject,
  deliverySha = null,
  expectedBaseSha = null,
  cache = new Map()
}) {
  const parsedObject = readLiteralCommit(runGit, mainRepo, candidate, cache);
  if (parsedObject === null || /[^\x00-\x7f]/u.test(parsedObject.message)) return null;
  const object = { ...parsedObject, message: Buffer.from(parsedObject.message, "utf8") };
  const message = parsedObject.message;
  const fields = message.match(ZERO_DELTA_EVIDENCE_MESSAGE_RE);
  if (fields === null) return null;
  const deliveryMismatch = deliverySha !== null && (
    fields[4] !== deliverySha || fields[4].length !== deliverySha.length
  );
  if (fields[1] !== subject || fields[2] !== subject ||
      fields[3] !== "v1" || fields[7] !== "true" ||
      deliveryMismatch ||
      (expectedBaseSha !== null && fields[5] !== expectedBaseSha)) {
    return null;
  }
  const encodedDeliverySha = fields[4];
  const baseSha = fields[5];
  const wkParentSha = fields[6];
  if (!OID_RE.test(encodedDeliverySha) || /^0+$/u.test(encodedDeliverySha) ||
      !OID_RE.test(baseSha) || /^0+$/u.test(baseSha) ||
      !OID_RE.test(wkParentSha) || /^0+$/u.test(wkParentSha) ||
      baseSha.length !== encodedDeliverySha.length || wkParentSha.length !== encodedDeliverySha.length ||
      candidate.length !== encodedDeliverySha.length || object.tree?.length !== encodedDeliverySha.length) {
    return null;
  }
  if (object.parents.length !== 1 || object.parents[0] !== wkParentSha ||
      !exactReviewedDeliveryIdentity(
        runGit, mainRepo, subject, encodedDeliverySha, baseSha, cache
      )) {
    return null;
  }
  let parentTree;
  let empty;
  try {
    parentTree = readLiteralCommit(runGit, mainRepo, wkParentSha, cache)?.tree ?? null;
    empty = sliceHasNoRemainingDelta({
      runGit,
      mainRepo,
      baseSha,
      commit: encodedDeliverySha,
      wkTip: wkParentSha
    });
  } catch {
    return null;
  }
  if (object.tree !== parentTree || !empty) {
    return null;
  }
  const expectedMessage = buildZeroDeltaIntegrationEvidenceMessage({
    subject,
    deliverySha: encodedDeliverySha,
    baseSha,
    wkParentSha
  });
  if (Buffer.compare(object.message, Buffer.from(expectedMessage, "utf8")) !== 0) {
    return null;
  }
  return Object.freeze({
    evidence_sha: candidate,
    delivery_sha: encodedDeliverySha,
    base_sha: baseSha,
    wk_parent_sha: wkParentSha,
    tree: object.tree
  });
}

export function authenticateZeroDeltaIntegrationEvidenceCandidate({
  runGit,
  mainRepo,
  evidenceSha,
  subject,
  deliverySha = null,
  baseSha = null
}) {
  assertOid(evidenceSha, "zero-delta evidence candidate");
  assertEvidenceSubject(subject);
  if (deliverySha !== null) assertOid(deliverySha, "zero-delta evidence delivery");
  if (baseSha !== null) assertOid(baseSha, "zero-delta evidence base");
  if (deliverySha !== null && baseSha !== null && deliverySha.length !== baseSha.length) return null;
  try {
    return classifyExactZeroDeltaEvidence({
      runGit,
      mainRepo,
      candidate: evidenceSha,
      subject,
      deliverySha,
      expectedBaseSha: baseSha
    });
  } catch {
    return null;
  }
}

export function authenticateZeroDeltaIntegrationEvidenceCommit({
  runGit,
  mainRepo,
  evidenceSha,
  subject,
  deliverySha,
  baseSha,
  wkParentSha
}) {
  assertEvidenceOidSet({ deliverySha, baseSha, wkParentSha });
  assertOid(evidenceSha, "zero-delta evidence commit");
  const match = classifyExactZeroDeltaEvidence({
    runGit,
    mainRepo,
    candidate: evidenceSha,
    subject: assertEvidenceSubject(subject),
    deliverySha,
    expectedBaseSha: baseSha
  });
  return match !== null && match.wk_parent_sha === wkParentSha ? match : null;
}

export function resolveZeroDeltaIntegrationEvidence({
  runGit,
  mainRepo,
  wkTip,
  subject,
  deliverySha,
  baseSha = null
}) {
  assertEvidenceSubject(subject);
  assertOid(wkTip, "zero-delta evidence history tip");
  assertOid(deliverySha, "zero-delta evidence delivery");
  if (wkTip.length !== deliverySha.length) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "zero-delta evidence history and delivery use different object formats"
    );
  }
  if (baseSha !== null) {
    assertOid(baseSha, "zero-delta evidence expected base");
    if (baseSha.length !== deliverySha.length) {
      fail(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
        "zero-delta evidence base uses a different object format"
      );
    }
  }
  const listed = authorityProbe(runGit, mainRepo, ["rev-list", wkTip]);
  if (listed.outcome !== "ok") {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "zero-delta evidence literal history is indeterminate"
    );
  }
  const candidates = String(listed.stdout).split(/\r?\n/u).filter((value) => value.length > 0);
  if (candidates.some((value) => !OID_RE.test(value) || value.length !== wkTip.length)) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "zero-delta evidence literal history returned a malformed object id"
    );
  }
  const matches = [];
  for (const candidate of candidates) {
    const match = classifyExactZeroDeltaEvidence({
      runGit,
      mainRepo,
      candidate,
      subject,
      deliverySha,
      expectedBaseSha: baseSha
    });
    if (match !== null) matches.push(match);
  }
  return Object.freeze({
    count: matches.length,
    matches: Object.freeze(matches),
    match: matches.length === 1 ? matches[0] : null
  });
}

export function sliceHasNoRemainingDelta({ runGit, mainRepo, baseSha, commit, wkTip }) {
  const merged = runGit({
    repo: mainRepo,
    args: [
      "--no-replace-objects",
      "merge-tree", "--write-tree", "--no-messages",
      "--merge-base", baseSha,
      wkTip,
      commit
    ]
  });
  if (!merged || merged.ok !== true) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT,
      "the immutable exact-slice delivery conflicts with the current WK tip",
      {
        base_sha: baseSha,
        slice_sha: commit,
        wk_sha: wkTip,
        stdout: String(merged?.stdout ?? "").slice(0, 8192),
        stderr: String(merged?.stderr ?? merged?.error ?? "").slice(0, 8192)
      }
    );
  }
  const appliedTree = assertOid(
    String(merged.stdout ?? "").split(/\r?\n/u)[0].trim(),
    "applied slice tree"
  );
  const wkCommit = readLiteralCommit(runGit, mainRepo, wkTip, new Map());
  if (wkCommit === null) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "the zero-delta WK parent is not a literal commit"
    );
  }
  return appliedTree === wkCommit.tree;
}

export function assertExactWorktreeBinding(runGit, worktreePath, sliceRef, expectedHead) {
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG, "bound slice worktree path must be absolute");
  }
  const branch = git(runGit, worktreePath, ["symbolic-ref", "-q", "HEAD"], "slice worktree is detached or unreadable").stdout.trim();
  const head = revParse(runGit, worktreePath, "HEAD");
  const refTip = revParse(runGit, worktreePath, sliceRef);
  if (branch !== sliceRef || head !== expectedHead || refTip !== expectedHead) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice ref/worktree binding does not match the committed slice", {
      expected_ref: sliceRef,
      actual_ref: branch,
      expected_head: expectedHead,
      actual_head: head,
      ref_tip: refTip
    });
  }
}

export function parseCanonicalRecord(mainRepo, wkId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (!record || record.id !== wkId || !Array.isArray(record.slices)) throw new Error("record identity/slices invalid");
    return record;
  } catch (error) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, `canonical ${wkId} record is unavailable or incompatible`, { record_path: recordPath }, error);
  }
}

function isImplementationSlice(slice) {
  const kind = typeof slice?.work_kind === "string" && slice.work_kind.length > 0
    ? slice.work_kind
    : "implementation";
  return kind === "implementation";
}

export const SLICE_MARKER_EVIDENCE_STATES = Object.freeze({
  FOUND: "found",
  ABSENT: "absent",
  INDETERMINATE: "indeterminate"
});

const WK_SLICE_MARKER_KEY_RE = /^[ \t]*wk-slice[ \t]*:/iu;
const MAX_LITERAL_COMMITS = 100_000;

function markerEvidence(state, { candidates = [], reason = null } = {}) {
  const authenticated = Object.freeze(candidates.slice().sort());
  return Object.freeze({
    state,
    candidates: authenticated,
    commit: authenticated.length === 1 ? authenticated[0] : null,
    reason
  });
}

function authorityProbe(runGit, mainRepo, args) {
  let result;
  try {
    result = runGit({ repo: mainRepo, args: ["--no-replace-objects", ...args] });
  } catch (error) {
    return { outcome: "faulted", error: error?.message ?? String(error) };
  }
  if (result === null || typeof result !== "object") {
    return { outcome: "faulted", error: "probe returned no result" };
  }
  if (result.ok !== true) {
    return {
      outcome: "failed",
      status: typeof result.status === "number" ? result.status : null,
      signal: result.signal ?? null,
      error: result.error ?? null,
      stdout: typeof result.stdout === "string" ? result.stdout : ""
    };
  }
  const stdout = result.stdout ?? "";
  if (typeof stdout !== "string") {
    return { outcome: "faulted", error: "probe returned non-string output" };
  }
  return { outcome: "ok", stdout };
}

function parseLiteralCommit(raw, oid) {
  return parseLiteralCommitBytes(raw, oid);
}

function readLiteralCommit(runGit, mainRepo, oid, cache) {
  if (!OID_RE.test(oid) || /^0+$/u.test(oid)) return null;
  if (cache.has(oid)) return cache.get(oid);
  const type = authorityProbe(runGit, mainRepo, ["cat-file", "-t", oid]);
  if (type.outcome !== "ok" || type.stdout !== "commit\n") return null;
  const body = authorityProbe(runGit, mainRepo, ["cat-file", "commit", oid]);
  if (body.outcome !== "ok") return null;
  const commit = parseLiteralCommit(body.stdout, oid);
  if (commit === null) return null;
  cache.set(oid, commit);
  return commit;
}

function literalReachable(runGit, mainRepo, start, cache) {
  const visited = new Set();
  const active = new Set();
  const stack = [{ oid: start, exiting: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry.exiting) {
      active.delete(entry.oid);
      continue;
    }
    if (visited.has(entry.oid)) continue;
    if (active.has(entry.oid) || visited.size >= MAX_LITERAL_COMMITS) return null;
    const commit = readLiteralCommit(runGit, mainRepo, entry.oid, cache);
    if (commit === null) return null;
    visited.add(entry.oid);
    active.add(entry.oid);
    stack.push({ oid: entry.oid, exiting: true });
    for (let index = commit.parents.length - 1; index >= 0; index -= 1) {
      const parent = commit.parents[index];
      if (active.has(parent)) return null;
      if (!visited.has(parent)) stack.push({ oid: parent, exiting: false });
    }
  }
  return visited;
}

function markerLines(message) {
  return String(message).split("\n").filter((line) => WK_SLICE_MARKER_KEY_RE.test(line));
}

function claimsIdentity(message, identity) {
  const expected = identity.toLowerCase();
  return markerLines(message).some((line) => line.toLowerCase().includes(expected));
}

function isCanonicalLauncherMarkerMessage(message, wkId, sliceId) {
  const subject = `${wkId}#${sliceId}`;
  const trailer = buildWkSliceMarkerTrailer(subject);
  if (trailer === null || typeof message !== "string" || /[^\x00-\x7f]/u.test(message)) return false;
  const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedTrailer = trailer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^agent-launch worker delivery: ${escapedSubject} \\(base [0-9a-f]{12}\\)\\n\\n${escapedTrailer}\\n$`,
    "u"
  ).test(message);
}

function canonicalMarkerMessageFamily(runGit, mainRepo, commit, wkId, sliceId, cache) {
  if (isCanonicalLauncherMarkerMessage(commit.message, wkId, sliceId)) return "worker_delivery";
  try {
    const zeroDelta = classifyExactZeroDeltaEvidence({
      runGit,
      mainRepo,
      candidate: commit.oid,
      subject: `${wkId}#${sliceId}`,
      cache
    });
    return zeroDelta === null ? null : "zero_delta_evidence";
  } catch {
    return null;
  }
}

export function resolveSliceMarkerEvidence(runGit, mainRepo, wkTipSha, wkId, sliceId) {
  const trailer = buildWkSliceMarkerTrailer(`${wkId}#${sliceId}`);
  if (trailer === null) {
    return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, { reason: "marker_identity_unmintable" });
  }
  if (typeof wkTipSha !== "string" || !OID_RE.test(wkTipSha) || /^0+$/u.test(wkTipSha)) {
    return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, { reason: "wk_tip_not_exact_oid" });
  }
  const cache = new Map();
  const wkReachable = literalReachable(runGit, mainRepo, wkTipSha, cache);
  if (wkReachable === null) {
    return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, { reason: "history_probe_indeterminate" });
  }
  const candidates = [];
  const identity = `${wkId}#${sliceId}`;
  for (const oid of wkReachable) {
    const commit = cache.get(oid);
    if (!claimsIdentity(commit.message, identity)) continue;
    if (commit.parents.length !== 1 ||
        readLiteralCommit(runGit, mainRepo, commit.parents[0], cache) === null) {
      return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, { reason: "marker_parent_indeterminate" });
    }
    if (canonicalMarkerMessageFamily(runGit, mainRepo, commit, wkId, sliceId, cache) === null) {
      return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, { reason: "marker_message_not_canonical" });
    }
    candidates.push(oid);
  }
  if (candidates.length === 0) {
    return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.ABSENT, { reason: "marker_absent" });
  }
  return markerEvidence(SLICE_MARKER_EVIDENCE_STATES.FOUND, { candidates });
}

export function resolveSliceMarkerCommit(runGit, mainRepo, wkTipSha, wkId, sliceId) {
  const evidence = resolveSliceMarkerEvidence(runGit, mainRepo, wkTipSha, wkId, sliceId);
  return evidence.state === SLICE_MARKER_EVIDENCE_STATES.FOUND && evidence.candidates.length === 1
    ? evidence.candidates[0]
    : null;
}

function sliceMarkerPresentInWkTip(runGit, mainRepo, wkTipSha, wkId, sliceId) {
  const evidence = resolveSliceMarkerEvidence(runGit, mainRepo, wkTipSha, wkId, sliceId);
  return evidence.state === SLICE_MARKER_EVIDENCE_STATES.FOUND && evidence.candidates.length > 0;
}

function isSiblingImplementationComplete(entry, runGit, mainRepo, wkTipSha, wkId) {
  if (entry.status === "cancelled") return true;
  if (entry.status !== "done") return false;
  return sliceMarkerPresentInWkTip(runGit, mainRepo, wkTipSha, wkId, entry.id);
}

const INITIATIVE_ID_RE = /^IN-\d{4}$/u;
const WK_ID_RE = /^WK-\d{4}$/u;
const FIXED_FORK_REF_FORMAT = "%(refname)%00%(objectname)%00%(objecttype)%00%(symref)";

export function resolveFixedWkForkCommit({ runGit, mainRepo, initiative, wkId }) {
  if (!INITIATIVE_ID_RE.test(initiative ?? "") || !WK_ID_RE.test(wkId ?? "")) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "fixed WK fork identity must be a canonical initiative and WK id"
    );
  }
  const ref = `refs/agent-launch/wk-forks/${initiative}/${wkId}`;
  const observed = authorityProbe(runGit, mainRepo, [
    "for-each-ref", `--format=${FIXED_FORK_REF_FORMAT}`, "--count=2", "--", ref
  ]);

  if (observed.outcome !== "ok") {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED,
      "the launcher-owned fixed WK fork ref could not be observed",
      {
        fork_ref: ref,
        status: observed.status ?? null,
        stderr: observed.error ?? null
      }
    );
  }
  if (!(observed.stdout === "" || observed.stdout.endsWith("\n"))) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "the launcher-owned fixed WK fork ref observation is malformed",
      { fork_ref: ref }
    );
  }
  if (observed.stdout === "") {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "the launcher-owned fixed WK fork ref is missing",
      { fork_ref: ref }
    );
  }
  const records = observed.stdout.slice(0, -1).split("\n");
  const fields = records.length === 1 ? records[0].split("\0") : [];
  if (fields.length !== 4 || fields[0] !== ref || fields[3] !== "" ||
      fields[2] !== "commit" || !OID_RE.test(fields[1]) || /^0+$/u.test(fields[1])) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "the launcher-owned fixed WK fork ref is not one exact direct commit",
      { fork_ref: ref }
    );
  }
  return Object.freeze({ ref, sha: fields[1] });
}

function boundedWkLifecycleRegion(runGit, mainRepo, wkTipSha, forkSha, cache) {
  if (typeof wkTipSha !== "string" || !OID_RE.test(wkTipSha) || /^0+$/u.test(wkTipSha)) return null;
  if (typeof forkSha !== "string" || !OID_RE.test(forkSha) || /^0+$/u.test(forkSha)) return null;
  if (wkTipSha.length !== forkSha.length) return null;

  if (wkTipSha === forkSha) return new Set();
  const visited = new Set();
  const active = new Set();
  const stack = [{ oid: wkTipSha, exiting: false }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry.exiting) {
      active.delete(entry.oid);
      continue;
    }
    if (visited.has(entry.oid)) continue;
    if (active.has(entry.oid) || visited.size >= MAX_LITERAL_COMMITS) return null;
    const commit = readLiteralCommit(runGit, mainRepo, entry.oid, cache);
    if (commit === null) return null;

    if (commit.parents.length === 0) return null;
    visited.add(entry.oid);
    active.add(entry.oid);
    stack.push({ oid: entry.oid, exiting: true });
    for (let index = commit.parents.length - 1; index >= 0; index -= 1) {
      const parent = commit.parents[index];

      if (parent === forkSha) continue;
      if (active.has(parent)) return null;
      if (!visited.has(parent)) stack.push({ oid: parent, exiting: false });
    }
  }
  return visited;
}

function boundedSiblingMarkerEvidence({ runGit, mainRepo, region, cache, wkId, sliceIds }) {
  const targets = [];
  const evidence = new Map();
  for (const id of sliceIds) {
    if (buildWkSliceMarkerTrailer(`${wkId}#${id}`) === null) {
      evidence.set(id, markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, {
        reason: "marker_identity_unmintable"
      }));
      continue;
    }
    targets.push({ id, needle: `${wkId}#${id}`.toLowerCase(), candidates: [], reason: null });
  }
  for (const oid of region) {
    const commit = cache.get(oid);
    const claimed = markerLines(commit.message).map((line) => line.toLowerCase());
    if (claimed.length === 0) continue;
    for (const target of targets) {
      if (target.reason !== null) continue;
      if (!claimed.some((line) => line.includes(target.needle))) continue;
      if (commit.parents.length !== 1 ||
          readLiteralCommit(runGit, mainRepo, commit.parents[0], cache) === null) {
        target.reason = "marker_parent_indeterminate";
        continue;
      }
      if (canonicalMarkerMessageFamily(runGit, mainRepo, commit, wkId, target.id, cache) === null) {
        target.reason = "marker_message_not_canonical";
        continue;
      }
      target.candidates.push(oid);
    }
  }
  for (const target of targets) {
    if (target.reason !== null) {
      evidence.set(target.id, markerEvidence(SLICE_MARKER_EVIDENCE_STATES.INDETERMINATE, {
        reason: target.reason
      }));
    } else if (target.candidates.length === 0) {
      evidence.set(target.id, markerEvidence(SLICE_MARKER_EVIDENCE_STATES.ABSENT, {
        reason: "marker_absent"
      }));
    } else {
      evidence.set(target.id, markerEvidence(SLICE_MARKER_EVIDENCE_STATES.FOUND, {
        candidates: target.candidates
      }));
    }
  }
  return evidence;
}

export function isLastIncompleteImplementationSlice(
  record, sliceId, runGit, mainRepo, wkTipSha, wkId, options = null
) {
  const fixedForkSha = typeof options?.fixedForkSha === "string" ? options.fixedForkSha : null;
  if (fixedForkSha === null) {
    return !record.slices.some((entry) =>
      entry &&
      entry.id !== sliceId &&
      isImplementationSlice(entry) &&
      !isSiblingImplementationComplete(entry, runGit, mainRepo, wkTipSha, wkId)
    );
  }

  const proofNeeded = [];
  for (const entry of record.slices) {
    if (!entry || entry.id === sliceId || !isImplementationSlice(entry)) continue;
    if (entry.status === "cancelled") continue;
    if (entry.status !== "done") return false;
    proofNeeded.push(entry.id);
  }
  if (proofNeeded.length === 0) return true;
  const cache = new Map();
  const region = boundedWkLifecycleRegion(runGit, mainRepo, wkTipSha, fixedForkSha, cache);
  if (region === null) return false;
  const evidence = boundedSiblingMarkerEvidence({
    runGit, mainRepo, region, cache, wkId, sliceIds: proofNeeded
  });
  return proofNeeded.every((id) => {
    const found = evidence.get(id);
    return found.state === SLICE_MARKER_EVIDENCE_STATES.FOUND && found.candidates.length > 0;
  });
}

export function buildCompleteWkReviewTarget({ runGit, mainRepo, initiative, wkId, wkRef, wkTip }) {
  const mainSha = revParse(runGit, mainRepo, "refs/heads/main");
  const diffBaseSha = git(runGit, mainRepo, ["merge-base", mainSha, wkTip], "could not derive complete-WK review diff base").stdout.trim();
  assertOid(diffBaseSha, "diffBaseSha");
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    unit_address: `${initiative}/${wkId}`,
    ref: wkRef,
    sha: wkTip,
    diff_base_sha: diffBaseSha,
    diff_head_sha: wkTip,
    diff_range: `${diffBaseSha}..${wkTip}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
}

export function isStaleSourceDigestResult(result) {
  if (!result || result.valid !== false) return false;
  if (typeof result.current_source_digest === "string") return true;
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  return diagnostics.some((entry) => entry?.code === "stale_source_digest");
}

export function replayCommitRangeOnto({ runGit, mainRepo, baseSha, commit, onto }) {
  const ancestry = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", baseSha, commit] });
  if (!ancestry || ancestry.ok !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "the exact slice target is not descended from its authenticated base", {
        base_sha: baseSha,
        commit
      });
  }
  const range = git(
    runGit,
    mainRepo,
    ["rev-list", "--reverse", "--topo-order", `${baseSha}..${commit}`],
    "could not enumerate the exact authenticated delivery range"
  ).stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  let originalParent = baseSha;
  let replayedParent = onto;
  for (const originalCommit of range) {
    const parentLine = git(
      runGit,
      mainRepo,
      ["rev-list", "-n", "1", "--parents", originalCommit],
      "could not resolve an exact-slice delivery parent"
    ).stdout.trim().split(/\s+/u);
    if (parentLine.length !== 2 || parentLine[1] !== originalParent) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "the exact slice delivery range must be one linear commit chain", {
          commit: originalCommit,
          expected_parent: originalParent,
          parents: parentLine.slice(1)
        });
    }
    const merge = runGit({
      repo: mainRepo,
      args: [
        "merge-tree", "--write-tree", "--no-messages",
        "--merge-base", originalParent,
        replayedParent,
        originalCommit
      ]
    });
    if (!merge || merge.ok !== true) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REBASE_CONFLICT,
        "the immutable exact-slice delivery conflicts with the current WK tip", {
          base_sha: originalParent,
          slice_sha: originalCommit,
          wk_sha: replayedParent,
          stdout: String(merge?.stdout ?? "").slice(0, 8192),
          stderr: String(merge?.stderr ?? merge?.error ?? "").slice(0, 8192)
        });
    }
    const tree = assertOid(String(merge.stdout ?? "").split(/\r?\n/u)[0].trim(), "replayed tree");
    const message = git(
      runGit,
      mainRepo,
      ["show", "-s", "--format=%B", originalCommit],
      "could not read exact-slice delivery markers"
    ).stdout.trimEnd();
    replayedParent = git(
      runGit,
      mainRepo,
      [
        "-c", "user.name=Agent Chassis",
        "-c", "user.email=agent-chassis@localhost",
        "commit-tree", tree, "-p", replayedParent, "-m", message
      ],
      "could not materialize the replayed exact-slice commit"
    ).stdout.trim();
    assertOid(replayedParent, "replayed commit");
    originalParent = originalCommit;
  }
  return replayedParent;
}
