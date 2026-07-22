import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { ensureLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";

export const EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION =
  "workspace-agent-exact-slice-review-receipt.v1";

const RECEIPT_DIRECTORY = "exact-slice-review-receipts";
const STORE_EVENT_SCHEMA_VERSION = "workspace-agent-exact-slice-review-receipt-event.v1";
const EVENT_FILE_RE = /^event-([0-9]{16})-([0-9a-f]{64})-([0-9a-f]{64})\.json$/u;
const LOCK_DIRECTORY = ".receipt-store.lock";
const LOCK_OWNER_FILE = "owner.json";
const RECEIPT_OUTCOMES = new Set(["clean", "changes_requested"]);
const RECEIPT_STATES = new Set(["available", "reserved", "consumed"]);
const RUN_STATUSES = new Set(["launching", "running", "succeeded", "failed", "cancelled"]);
const PROOF_STATES = new Set(["unminted", "minted"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const UNIT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const FINDING_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const FINDING_COUNT_FIELDS = Object.freeze([
  "total", "blocking", "critical", "high", "medium", "low", "info"
]);
const REVIEW_RESULT_FIELDS = Object.freeze([
  "review_outcome", "clean_review", "no_findings", "blocking_finding_count",
  "medium_finding_count", "reviewed_controls"
]);
const RECEIPT_FIELDS = Object.freeze([
  "schema_version", "unit_address", "record_id", "slice_id", "initiative",
  "canonical_parent_wk_contract", "canonical_parent_contract_digest",
  "slice_review_contract", "slice_review_contract_digest",
  "source_worker_run_id", "source_worker_monitor_handle", "review_run_id",
  "review_monitor_handle", "reviewer_role", "slice_ref", "worktree_path",
  "worktree_identity", "worktree_identity_digest", "reviewed_sha",
  "diff_base_sha", "frozen_context_state", "terminal_run_status",
  "structured_outcome", "proof_state", "trusted_evidence_digest", "receipt_digest"
]);
const IMMUTABLE_RECEIPT_FIELDS = Object.freeze(RECEIPT_FIELDS.filter((field) => ![
  "frozen_context_state", "terminal_run_status", "structured_outcome", "proof_state",
  "trusted_evidence_digest", "receipt_digest"
].includes(field)));
const V1_WORKTREE_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address", "initiative",
  "record_id", "slice_id", "base_ref", "base_sha", "output_branch", "worktree_path",
  "read_scope", "repo_paths", "write_scope", "write_scope_source", "selected_unit",
  "source_digest", "source_version", "cone_dirs", "index_sparse"
]);
const V2_WORKTREE_FIELDS = Object.freeze([
  ...V1_WORKTREE_FIELDS.filter((field) => field !== "cone_dirs" && field !== "index_sparse"),
  "checkout_mode"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length &&
    actual.every((field, index) => field === required[index]);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestTrustedExactReviewEvidence(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function assertString(value, field, pattern = null) {
  if (typeof value !== "string" || value.length === 0 ||
      (pattern !== null && !pattern.test(value))) {
    throw new Error(`exact slice review receipt requires canonical ${field}`);
  }
}

function assertExactKeys(value, expected, label) {
  if (!hasExactKeys(value, expected)) {
    throw new Error(`exact slice review receipt ${label} must carry exactly ${expected.join(", ")}`);
  }
}

function assertCanonicalRepoPaths(value, field, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((entry) =>
    typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
    path.posix.isAbsolute(entry) || entry.includes("\\") || path.posix.normalize(entry) !== entry ||
    entry === "." || entry.split("/").some((part) => !part || part === "." || part === "..")
  ) || value.some((entry, index) => index > 0 && value[index - 1] >= entry)) {
    throw new Error(`exact slice review receipt worktree_identity ${field} is not canonical`);
  }
}

function assertWorktreeIdentity(receipt) {
  const identity = receipt.worktree_identity;
  const expectedFields = identity?.schema_version === "worktree-identity-binding.v1"
    ? V1_WORKTREE_FIELDS
    : identity?.schema_version === "worktree-identity-binding.v2"
      ? V2_WORKTREE_FIELDS
      : null;
  if (expectedFields === null) {
    throw new Error("exact slice review receipt worktree_identity schema is unsupported");
  }
  assertExactKeys(identity, expectedFields, "worktree_identity");
  const unit = UNIT_RE.exec(receipt.unit_address);
  const identityUnit = new RegExp(`^${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}$`, "u");
  const branch = `slice/${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}`;
  const selected = identity.selected_unit;
  if (!unit || identity.unit_address.match(identityUnit) === null ||
      identity.initiative !== receipt.initiative || identity.record_id !== receipt.record_id ||
      identity.slice_id !== receipt.slice_id || identity.launch_ref !== receipt.source_worker_monitor_handle ||
      identity.run_id !== `${receipt.source_worker_run_id}.slice` || identity.retry_id !== 0 ||
      identity.base_ref !== `wk/${receipt.initiative}/${receipt.record_id}` ||
      identity.base_sha !== receipt.diff_base_sha ||
      (identity.output_branch !== branch && identity.output_branch !== `refs/heads/${branch}`) ||
      identity.worktree_path !== receipt.worktree_path || !path.isAbsolute(identity.worktree_path) ||
      identity.write_scope_source !== `wiki/work-records/${receipt.record_id}.json#${receipt.slice_id}` ||
      !isPlainObject(selected) || selected.kind !== "slice" ||
      selected.address !== receipt.unit_address || selected.record_id !== receipt.record_id ||
      selected.slice_id !== receipt.slice_id ||
      !Object.prototype.hasOwnProperty.call(selected, "repo") ||
      !(selected.repo === null || (typeof selected.repo === "string" && selected.repo.length > 0))) {
    throw new Error("exact slice review receipt worktree_identity does not match the exact review binding");
  }
  assertCanonicalRepoPaths(identity.read_scope, "read_scope");
  assertCanonicalRepoPaths(identity.repo_paths, "repo_paths");
  assertCanonicalRepoPaths(identity.write_scope, "write_scope", { nonEmpty: true });
  if (identity.schema_version === "worktree-identity-binding.v1") {
    assertCanonicalRepoPaths(identity.cone_dirs, "cone_dirs", { nonEmpty: true });
    if (identity.index_sparse !== false) {
      throw new Error("exact slice review receipt sparse worktree_identity must pin index_sparse=false");
    }
  } else if (identity.checkout_mode !== "full") {
    throw new Error("exact slice review receipt full worktree_identity must pin checkout_mode=full");
  }
  assertString(identity.source_digest, "worktree_identity.source_digest", DIGEST_RE);
  if (!(identity.source_version === null ||
        (typeof identity.source_version === "string" && identity.source_version.length > 0))) {
    throw new Error("exact slice review receipt worktree_identity source_version is invalid");
  }
  if (digestTrustedExactReviewEvidence(identity) !== receipt.worktree_identity_digest) {
    throw new Error("exact slice review receipt worktree identity digest mismatch");
  }
}

function assertFindingCounts(counts, findings) {
  assertExactKeys(counts, FINDING_COUNT_FIELDS, "finding_counts");
  for (const field of FINDING_COUNT_FIELDS) {
    if (!Number.isInteger(counts[field]) || counts[field] < 0) {
      throw new Error("exact slice review receipt finding_counts are invalid");
    }
  }
  const recomputed = Object.fromEntries(FINDING_COUNT_FIELDS.map((field) => [field, 0]));
  recomputed.total = findings.length;
  for (const finding of findings) {
    recomputed[finding.severity] += 1;
    if (finding.blocking) recomputed.blocking += 1;
  }
  if (FINDING_COUNT_FIELDS.some((field) => counts[field] !== recomputed[field])) {
    throw new Error("exact slice review receipt finding_counts do not match findings");
  }
}

function assertFindings(outcome) {
  if (!Array.isArray(outcome.findings) || outcome.findings.length === 0) {
    throw new Error("changes_requested receipt lacks structured findings");
  }
  const ids = new Set();
  for (const finding of outcome.findings) {
    const keys = Object.keys(finding ?? {}).sort();
    const required = ["affected_paths", "blocking", "id", "severity", "title"];
    const allowed = new Set([...required, "control_id"]);
    if (!isPlainObject(finding) || required.some((field) => !Object.prototype.hasOwnProperty.call(finding, field)) ||
        keys.some((field) => !allowed.has(field)) || typeof finding.id !== "string" || !finding.id.trim() ||
        ids.has(finding.id) || typeof finding.title !== "string" || !finding.title.trim() ||
        !FINDING_SEVERITIES.has(finding.severity) || typeof finding.blocking !== "boolean" ||
        !Array.isArray(finding.affected_paths) || finding.affected_paths.some((entry) =>
          !hasExactKeys(entry, ["path", "line"]) || typeof entry.path !== "string" || !entry.path ||
          path.posix.isAbsolute(entry.path) || path.posix.normalize(entry.path) !== entry.path ||
          !(entry.line === null || (Number.isInteger(entry.line) && entry.line > 0))
        )) {
      throw new Error("changes_requested receipt carries malformed structured findings");
    }
    ids.add(finding.id);
  }
  assertFindingCounts(outcome.finding_counts, outcome.findings);
}

function assertCleanReviewResult(result) {
  assertExactKeys(result, REVIEW_RESULT_FIELDS, "clean review_result");
  if (!new Set(["no_findings", "passed_no_blocking_or_medium_findings"]).has(result.review_outcome) ||
      result.clean_review !== true || typeof result.no_findings !== "boolean" ||
      result.no_findings !== (result.review_outcome === "no_findings") ||
      result.blocking_finding_count !== 0 || result.medium_finding_count !== 0 ||
      !Array.isArray(result.reviewed_controls) ||
      result.reviewed_controls.some((entry) => typeof entry !== "string") ||
      result.reviewed_controls.some((entry, index) => index > 0 && result.reviewed_controls[index - 1] >= entry)) {
    throw new Error("clean exact slice review receipt carries malformed review_result");
  }
}

function receiptBody(receipt) {
  const { receipt_digest: _digest, ...body } = receipt;
  return body;
}

function normalizedEvidenceFromReceipt(receipt) {
  return {
    unit_address: receipt.unit_address,
    source_worker_run_id: receipt.source_worker_run_id,
    source_worker_monitor_handle: receipt.source_worker_monitor_handle,
    review_run_id: receipt.review_run_id,
    review_monitor_handle: receipt.review_monitor_handle,
    reviewer_role: receipt.reviewer_role,
    reviewed_sha: receipt.reviewed_sha,
    diff_base_sha: receipt.diff_base_sha,
    terminal_run_status: receipt.terminal_run_status,
    structured_outcome: receipt.structured_outcome
  };
}

export function validateExactSliceReviewReceipt(receipt, selector = {}) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION) {
    throw new Error("exact slice review receipt is malformed or has an unsupported schema");
  }
  assertExactKeys(receipt, RECEIPT_FIELDS, "top-level schema");
  const unit = UNIT_RE.exec(receipt.unit_address);
  if (!unit || receipt.record_id !== unit[1] || receipt.slice_id !== unit[2]) {
    throw new Error("exact slice review receipt unit identity is inconsistent");
  }
  assertString(receipt.initiative, "initiative", INITIATIVE_RE);
  assertString(receipt.canonical_parent_wk_contract, "canonical_parent_wk_contract");
  assertString(receipt.slice_review_contract, "slice_review_contract");
  for (const field of ["canonical_parent_contract_digest", "slice_review_contract_digest",
    "worktree_identity_digest", "trusted_evidence_digest", "receipt_digest"]) {
    assertString(receipt[field], field, DIGEST_RE);
  }
  if (digestTrustedExactReviewEvidence(receipt.canonical_parent_wk_contract) !==
        receipt.canonical_parent_contract_digest ||
      digestTrustedExactReviewEvidence(receipt.slice_review_contract) !==
        receipt.slice_review_contract_digest) {
    throw new Error("exact slice review receipt frozen contract digest mismatch");
  }
  for (const field of ["source_worker_run_id", "source_worker_monitor_handle", "review_run_id",
    "review_monitor_handle"]) assertString(receipt[field], field, OPAQUE_ID_RE);
  assertString(receipt.reviewed_sha, "reviewed_sha", OID_RE);
  assertString(receipt.diff_base_sha, "diff_base_sha", OID_RE);
  assertString(receipt.worktree_path, "worktree_path");
  if (!path.isAbsolute(receipt.worktree_path) || path.normalize(receipt.worktree_path) !== receipt.worktree_path) {
    throw new Error("exact slice review receipt worktree_path must be normalized and absolute");
  }
  const expectedRef = `refs/heads/slice/${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}`;
  if (receipt.slice_ref !== expectedRef || receipt.reviewer_role !== "reviewer" ||
      !RECEIPT_STATES.has(receipt.frozen_context_state) ||
      !RUN_STATUSES.has(receipt.terminal_run_status) || !PROOF_STATES.has(receipt.proof_state)) {
    throw new Error("exact slice review receipt carries invalid closed vocabulary");
  }
  assertWorktreeIdentity(receipt);
  if (receipt.structured_outcome !== null) {
    const expected = receipt.structured_outcome.outcome === "clean"
      ? ["outcome", "clean_review", "review_result"]
      : receipt.structured_outcome.outcome === "changes_requested"
        ? ["outcome", "clean_review", "findings", "finding_counts"]
        : null;
    if (expected === null || !RECEIPT_OUTCOMES.has(receipt.structured_outcome.outcome)) {
      throw new Error("exact slice review receipt carries invalid closed vocabulary");
    }
    assertExactKeys(receipt.structured_outcome, expected, "structured_outcome");
    if (receipt.terminal_run_status !== "succeeded") {
      throw new Error("non-succeeded exact slice review receipt cannot carry a structured outcome");
    }
    if (receipt.structured_outcome.outcome === "clean") {
      if (receipt.structured_outcome.clean_review !== true) {
        throw new Error("clean exact slice review receipt lacks validated clean outcome");
      }
      assertCleanReviewResult(receipt.structured_outcome.review_result);
    } else {
      if (receipt.structured_outcome.clean_review !== false) {
        throw new Error("changes_requested receipt cannot claim a clean review");
      }
      assertFindings(receipt.structured_outcome);
    }
  }
  if (receipt.proof_state === "minted" &&
      (receipt.frozen_context_state !== "consumed" || receipt.terminal_run_status !== "succeeded" ||
       receipt.structured_outcome?.outcome !== "clean" || receipt.structured_outcome.clean_review !== true)) {
    throw new Error("minted proof_state requires an exact consumed clean terminal review");
  }
  if (selector.unit_address !== undefined && selector.unit_address !== receipt.unit_address) {
    throw new Error("exact slice review receipt unit selector mismatch");
  }
  if (selector.review_run_id !== undefined && selector.review_run_id !== receipt.review_run_id) {
    throw new Error("exact slice review receipt run selector mismatch");
  }
  if (selector.monitor_handle !== undefined && selector.monitor_handle !== receipt.review_monitor_handle) {
    throw new Error("exact slice review receipt monitor selector mismatch");
  }
  const evidenceDigest = digestTrustedExactReviewEvidence(normalizedEvidenceFromReceipt(receipt));
  if (evidenceDigest !== receipt.trusted_evidence_digest) {
    throw new Error("exact slice review receipt trusted evidence digest mismatch");
  }
  const receiptDigest = digestTrustedExactReviewEvidence(receiptBody(receipt));
  if (receiptDigest !== receipt.receipt_digest) {
    throw new Error("exact slice review receipt digest mismatch");
  }
  return Object.freeze(receipt);
}

export function createExactSliceReviewReceipt(fields) {
  const unknown = Object.keys(fields ?? {}).find((field) =>
    !RECEIPT_FIELDS.includes(field) || field === "schema_version" ||
    field === "trusted_evidence_digest" || field === "receipt_digest");
  if (unknown !== undefined) {
    throw new Error(`exact slice review receipt carries forbidden field: ${unknown}`);
  }
  const bodyWithoutEvidence = canonicalize({
    schema_version: EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION,
    ...fields
  });
  const body = canonicalize({
    ...bodyWithoutEvidence,
    trusted_evidence_digest: digestTrustedExactReviewEvidence(
      normalizedEvidenceFromReceipt(bodyWithoutEvidence)
    )
  });
  return validateExactSliceReviewReceipt(Object.freeze({
    ...body,
    receipt_digest: digestTrustedExactReviewEvidence(body)
  }));
}

export function reviseExactSliceReviewReceipt(receipt, patch) {
  validateExactSliceReviewReceipt(receipt);
  const allowed = new Set(["frozen_context_state", "terminal_run_status", "structured_outcome", "proof_state"]);
  const forbidden = Object.keys(patch ?? {}).find((field) => !allowed.has(field));
  if (forbidden !== undefined) {
    throw new Error(`exact slice review receipt revision cannot change immutable field: ${forbidden}`);
  }
  const {
    schema_version: _schemaVersion,
    receipt_digest: _receiptDigest,
    trusted_evidence_digest: _evidenceDigest,
    ...fields
  } = receipt;
  return createExactSliceReviewReceipt({ ...fields, ...patch });
}

function immutableIdentity(receipt) {
  return Object.fromEntries(IMMUTABLE_RECEIPT_FIELDS.map((field) => [field, receipt[field]]));
}

function identityDigest(receipt) {
  return digestTrustedExactReviewEvidence(immutableIdentity(receipt)).slice("sha256:".length);
}

function sameImmutableIdentity(left, right) {
  return canonicalJson(immutableIdentity(left)) === canonicalJson(immutableIdentity(right));
}

function assertMonotonicTransition(prior, next) {
  if (!sameImmutableIdentity(prior, next)) {
    throw new Error("exact slice review receipt transition changes immutable identity");
  }
  const stateRank = { available: 0, reserved: 1, consumed: 2 };
  const runRank = { launching: 0, running: 1, succeeded: 2, failed: 2, cancelled: 2 };
  if (stateRank[next.frozen_context_state] < stateRank[prior.frozen_context_state] ||
      runRank[next.terminal_run_status] < runRank[prior.terminal_run_status] ||
      (TERMINAL_STATUSES.has(prior.terminal_run_status) &&
       prior.terminal_run_status !== next.terminal_run_status) ||
      (prior.structured_outcome !== null &&
       canonicalJson(prior.structured_outcome) !== canonicalJson(next.structured_outcome)) ||
      (prior.proof_state === "minted" && next.proof_state !== "minted")) {
    throw new Error("exact slice review receipt transition is non-monotonic or conflicts with terminal state");
  }
}

async function inject(faultInjector, boundary) {
  if (typeof faultInjector === "function") await faultInjector(boundary);
}

async function writeAtomicImmutable(targetPath, contents, faultInjector) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await inject(faultInjector, "event_temp_created");
    await handle.writeFile(contents, "utf8");
    await inject(faultInjector, "event_written");
    await handle.sync();
    await inject(faultInjector, "event_file_synced");
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, targetPath);
  await inject(faultInjector, "event_published");
  const directoryHandle = await open(path.dirname(targetPath), "r");
  try {
    await directoryHandle.sync();
    await inject(faultInjector, "event_directory_synced");
  } finally {
    await directoryHandle.close();
  }
}

async function syncDirectory(dir) {
  const directoryHandle = await open(dir, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function acquireStoreLock(dir, faultInjector) {
  const lockPath = path.join(dir, LOCK_DIRECTORY);
  const token = randomBytes(16).toString("hex");
  const owner = Object.freeze({ pid: process.pid, token });
  const candidatePath = path.join(
    dir,
    `${LOCK_DIRECTORY}.candidate-${process.pid}-${token}`
  );
  await mkdir(candidatePath, { mode: 0o700 });
  const ownerHandle = await open(path.join(candidatePath, LOCK_OWNER_FILE), "wx", 0o600);
  try {
    await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await ownerHandle.sync();
  } finally {
    await ownerHandle.close();
  }
  await syncDirectory(candidatePath);
  await syncDirectory(dir);

  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await rename(candidatePath, lockPath);
      await syncDirectory(dir);
      try {
        await inject(faultInjector, "lock_acquired");
      } catch (error) {
        const abandonedPath = path.join(dir, `${LOCK_DIRECTORY}.released-${token}`);
        await rename(lockPath, abandonedPath);
        await syncDirectory(dir);
        await rm(abandonedPath, { recursive: true });
        await syncDirectory(dir);
        throw error;
      }
      return async () => {
        const current = JSON.parse(await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8"));
        if (current.token !== token) {
          throw new Error("exact slice review receipt store lock ownership changed");
        }
        const releasedPath = path.join(dir, `${LOCK_DIRECTORY}.released-${token}`);
        await rename(lockPath, releasedPath);
        await syncDirectory(dir);
        await rm(releasedPath, { recursive: true });
        await syncDirectory(dir);
      };
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") {
        await rm(candidatePath, { recursive: true, force: true });
        throw error;
      }
      let currentOwner;
      try {
        currentOwner = JSON.parse(await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8"));
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        await rm(candidatePath, { recursive: true, force: true });
        throw new Error("exact slice review receipt store lock is malformed", { cause: readError });
      }
      if (!currentOwner || !Number.isInteger(currentOwner.pid) || currentOwner.pid <= 0 ||
          typeof currentOwner.token !== "string" || !/^[0-9a-f]{32}$/u.test(currentOwner.token)) {
        await rm(candidatePath, { recursive: true, force: true });
        throw new Error("exact slice review receipt store lock is malformed");
      }
      if (!(await processIsAlive(currentOwner.pid))) {

        const reapedPath = path.join(
          dir,
          `${LOCK_DIRECTORY}.reaped-${currentOwner.token}`
        );
        try {
          await rename(lockPath, reapedPath);
          await syncDirectory(dir);
        } catch (reapError) {
          if (reapError?.code !== "ENOENT" && reapError?.code !== "EEXIST" &&
              reapError?.code !== "ENOTEMPTY") {
            await rm(candidatePath, { recursive: true, force: true });
            throw reapError;
          }
        }
        continue;
      }
      await delay(10);
    }
  }
  await rm(candidatePath, { recursive: true, force: true });
  throw new Error("exact slice review receipt store lock acquisition timed out");
}

function validateStoreEvent(event, fileName) {
  if (!hasExactKeys(event, ["schema_version", "generation", "identity_digest", "receipt"]) ||
      event.schema_version !== STORE_EVENT_SCHEMA_VERSION ||
      !Number.isInteger(event.generation) || event.generation < 1 ||
      typeof event.identity_digest !== "string" || !/^[0-9a-f]{64}$/u.test(event.identity_digest)) {
    throw new Error(`exact slice review receipt event is malformed: ${fileName}`);
  }
  const receipt = validateExactSliceReviewReceipt(event.receipt);
  if (event.identity_digest !== identityDigest(receipt)) {
    throw new Error(`exact slice review receipt event identity digest mismatch: ${fileName}`);
  }
  const fileMatch = EVENT_FILE_RE.exec(fileName);
  if (!fileMatch || Number(fileMatch[1]) !== event.generation ||
      fileMatch[2] !== event.identity_digest ||
      fileMatch[3] !== receipt.receipt_digest.slice("sha256:".length)) {
    throw new Error(`exact slice review receipt event filename binding mismatch: ${fileName}`);
  }
  return Object.freeze({ ...event, receipt });
}

function assertConsistentEventHistory(events) {
  const generations = new Set();
  const histories = new Map();
  for (const event of [...events].sort((left, right) => left.generation - right.generation)) {
    if (generations.has(event.generation)) {
      throw new Error("exact slice review receipt store carries a duplicate generation");
    }
    generations.add(event.generation);
    const history = histories.get(event.identity_digest) ?? [];
    const prior = history.at(-1) ?? null;
    if (prior !== null) assertMonotonicTransition(prior.receipt, event.receipt);
    history.push(event);
    histories.set(event.identity_digest, history);
  }
  const latest = [...histories.values()].map((history) => history.at(-1));
  for (let leftIndex = 0; leftIndex < latest.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < latest.length; rightIndex += 1) {
      const left = latest[leftIndex].receipt;
      const right = latest[rightIndex].receipt;
      if (left.review_run_id === right.review_run_id ||
          left.review_monitor_handle === right.review_monitor_handle) {
        throw new Error("exact slice review receipt store carries conflicting selector histories");
      }
    }
  }
}

export function createExactSliceReviewReceiptStore({
  workspaceDir,
  env = process.env,
  ensureRuntimeStateDir = ensureLauncherRuntimeStateDir,
  faultInjector = null
} = {}) {
  async function receiptDirectory() {
    const ensured = await ensureRuntimeStateDir({ workspaceDir, env });
    if (ensured?.ok !== true) {
      throw new Error(ensured?.reason ?? "launcher runtime state unavailable for exact review receipts");
    }

    await mkdir(ensured.dir, { recursive: true, mode: 0o700 });
    const dir = path.join(ensured.dir, RECEIPT_DIRECTORY);
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    await syncDirectory(dir);
    await syncDirectory(ensured.dir);
    return dir;
  }

  async function readEvents(dir) {
    const names = (await readdir(dir)).filter((name) => EVENT_FILE_RE.test(name)).sort();
    const events = [];
    for (const name of names) {
      const parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      events.push(validateStoreEvent(parsed, name));
    }
    assertConsistentEventHistory(events);
    return events;
  }

  function latestByIdentity(events) {
    const latest = new Map();
    for (const event of events) {
      const prior = latest.get(event.identity_digest);
      if (!prior || event.generation > prior.generation) latest.set(event.identity_digest, event);
    }
    return [...latest.values()];
  }

  async function persist(receipt) {
    const validated = validateExactSliceReviewReceipt(receipt);
    const dir = await receiptDirectory();
    const release = await acquireStoreLock(dir, faultInjector);
    try {
      const events = await readEvents(dir);
      const current = latestByIdentity(events);
      const exact = current.find((event) => event.identity_digest === identityDigest(validated)) ?? null;
      for (const event of current) {
        const existing = event.receipt;
        const sharesSelector = existing.review_run_id === validated.review_run_id ||
          existing.review_monitor_handle === validated.review_monitor_handle;
        if (sharesSelector && !sameImmutableIdentity(existing, validated)) {
          throw new Error("exact slice review receipt conflicts with an existing immutable selector binding");
        }
      }
      if (exact !== null) {
        if (exact.receipt.receipt_digest === validated.receipt_digest) return validated;
        assertMonotonicTransition(exact.receipt, validated);
      }
      const generation = events.reduce((max, event) => Math.max(max, event.generation), 0) + 1;
      const identity = identityDigest(validated);
      const event = {
        schema_version: STORE_EVENT_SCHEMA_VERSION,
        generation,
        identity_digest: identity,
        receipt: validated
      };
      const fileName = `event-${String(generation).padStart(16, "0")}-${identity}-${validated.receipt_digest.slice("sha256:".length)}.json`;
      await writeAtomicImmutable(path.join(dir, fileName), `${JSON.stringify(event, null, 2)}\n`, faultInjector);
      return validated;
    } finally {
      await release();
    }
  }

  async function select(selector) {
    assertString(selector?.unit_address, "unit_address selector", UNIT_RE);
    const hasRun = selector.review_run_id !== undefined;
    const hasMonitor = selector.monitor_handle !== undefined;
    if (hasRun === hasMonitor) {
      throw new Error("receipt lookup requires exactly one bounded reviewer run or monitor selector");
    }
    assertString(hasRun ? selector.review_run_id : selector.monitor_handle,
      hasRun ? "run selector" : "monitor selector", OPAQUE_ID_RE);
    const dir = await receiptDirectory();
    const release = await acquireStoreLock(dir, faultInjector);
    try {
      const events = latestByIdentity(await readEvents(dir));
      const matches = events.filter(({ receipt }) => receipt.unit_address === selector.unit_address &&
        (hasRun ? receipt.review_run_id === selector.review_run_id :
          receipt.review_monitor_handle === selector.monitor_handle));
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw new Error("exact slice review receipt selector is conflicting");
      return validateExactSliceReviewReceipt(matches[0].receipt, selector);
    } finally {
      await release();
    }
  }

  async function loadLatest(unitAddress) {
    assertString(unitAddress, "unit_address selector", UNIT_RE);
    const dir = await receiptDirectory();
    const release = await acquireStoreLock(dir, faultInjector);
    try {
      const matches = latestByIdentity(await readEvents(dir))
        .filter(({ receipt }) => receipt.unit_address === unitAddress)
        .sort((left, right) => right.generation - left.generation);
      return matches.length === 0
        ? null
        : validateExactSliceReviewReceipt(matches[0].receipt, { unit_address: unitAddress });
    } finally {
      await release();
    }
  }

  return Object.freeze({ persist, load: select, loadLatest });
}
