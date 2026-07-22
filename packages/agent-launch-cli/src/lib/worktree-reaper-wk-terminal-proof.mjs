

import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";

import { assertAbsolutePath, fail } from "./worktree-reaper-diagnostics.mjs";

export const WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION = "workspace-agent-wk-terminal-disposition.v1";

export const WK_TERMINAL_DISPOSITION_VALUES = Object.freeze([
  "landed",
  "terminal_cancelled",
  "terminal_reverted"
]);

export const WK_TERMINAL_PROOF_DIAGNOSTIC_CODES = Object.freeze({
  MISSING: "agent_launch.worktree_reaper.wk_terminal_proof_missing.v1",
  MALFORMED: "agent_launch.worktree_reaper.wk_terminal_proof_malformed.v1",
  BINDING_MISMATCH: "agent_launch.worktree_reaper.wk_terminal_proof_binding_mismatch.v1",
  WORKERS_NOT_TERMINATED: "agent_launch.worktree_reaper.wk_terminal_proof_workers_not_terminated.v1",
  REVIEW_UNRESOLVED: "agent_launch.worktree_reaper.wk_terminal_proof_review_unresolved.v1",
  UNINTEGRATED_WORK: "agent_launch.worktree_reaper.wk_terminal_proof_unintegrated_work.v1",
  DISPOSITION_UNPROVEN: "agent_launch.worktree_reaper.wk_terminal_proof_disposition_unproven.v1"
});
const PROOF_CODES = WK_TERMINAL_PROOF_DIAGNOSTIC_CODES;

export const WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS = Object.freeze([
  "canonical_record_digest",
  "disposition",
  "disposition_receipt_digest",
  "disposition_receipt_id",
  "initiative",
  "minted_at",
  "record_id",
  "relevant_run_ids",
  "terminal_run_ids",
  "unintegrated_units",
  "unresolved_review_units",
  "verified_wk_sha",
  "wk_ref"
]);

export const WK_TERMINAL_DISPOSITION_PROOF_FIELDS = Object.freeze(
  [...WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS, "proof_digest", "schema_version"].sort()
);

const WK_TERMINAL_DISPOSITION_RECEIPT_FIELDS = Object.freeze([
  "disposition",
  "disposition_receipt_id",
  "initiative",
  "record_id",
  "verified_wk_sha",
  "wk_ref"
]);

const RECORD_ID_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const WK_REF_RE = /^refs\/heads\/wk\/(IN-\d{4})\/(WK-\d{4})$/u;
const PROOF_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const BOUNDED_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const UNIT_REFERENCE_RE = /^WK-\d{4}(?:#SLICE-\d{3})?$/u;

const DISPOSITION_SET = new Set(WK_TERMINAL_DISPOSITION_VALUES);
const PROOF_INPUT_FIELD_SET = new Set(WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS);
const PROOF_ARRAY_FIELDS = Object.freeze([
  "relevant_run_ids",
  "terminal_run_ids",
  "unresolved_review_units",
  "unintegrated_units"
]);

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalDigestForm(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalDigestForm).join(",")}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalDigestForm(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256Of(value) {
  return `sha256:${createHash("sha256").update(canonicalDigestForm(value)).digest("hex")}`;
}

export function computeWkTerminalDispositionReceiptDigest(source) {
  if (!isPlainRecord(source)) return null;
  const facts = {};
  for (const field of WK_TERMINAL_DISPOSITION_RECEIPT_FIELDS) facts[field] = source[field] ?? null;
  return sha256Of(facts);
}

export function computeWkTerminalDispositionProofDigest(proof) {
  if (!isPlainRecord(proof)) return null;
  const facts = { schema_version: proof.schema_version ?? null };
  for (const field of WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS) facts[field] = proof[field] ?? null;
  return sha256Of(facts);
}

function refuseProof(code, reason) {
  return { ok: false, decision_code: code, reasons: [reason], proof: null };
}

function denyProof(code, reason) {
  return { valid: false, decision_code: code, reasons: [reason] };
}

function normalizedTokenList(value, pattern) {
  if (!Array.isArray(value)) return null;
  const entries = value.map((entry) => (typeof entry === "string" ? entry.trim() : entry));
  if (entries.some((entry) => typeof entry !== "string" || !pattern.test(entry))) return null;
  return Object.freeze([...new Set(entries)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
}

export function buildWkTerminalDispositionProof(input) {
  if (!isPlainRecord(input)) return refuseProof(PROOF_CODES.MALFORMED, "input is not an object");

  const unknownKeys = Object.keys(input)
    .filter((key) => !PROOF_INPUT_FIELD_SET.has(key))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (unknownKeys.length > 0) {
    return refuseProof(
      PROOF_CODES.MALFORMED,
      `wk terminal-disposition proof input accepts a closed field set; unexpected: ${unknownKeys.join(", ")}`
    );
  }

  const recordId = typeof input.record_id === "string" ? input.record_id.trim() : null;
  const initiative = typeof input.initiative === "string" ? input.initiative.trim() : null;
  const wkRef = typeof input.wk_ref === "string" ? input.wk_ref.trim() : null;
  const verifiedWkSha = typeof input.verified_wk_sha === "string" ? input.verified_wk_sha.trim() : null;
  const canonicalRecordDigest =
    typeof input.canonical_record_digest === "string" ? input.canonical_record_digest.trim() : null;
  const disposition = typeof input.disposition === "string" ? input.disposition.trim() : null;
  const receiptId =
    typeof input.disposition_receipt_id === "string" ? input.disposition_receipt_id.trim() : null;
  const receiptDigest =
    typeof input.disposition_receipt_digest === "string" ? input.disposition_receipt_digest.trim() : null;
  const mintedAt = typeof input.minted_at === "string" ? input.minted_at.trim() : null;

  if (!recordId || !RECORD_ID_RE.test(recordId)) {
    return refuseProof(PROOF_CODES.MALFORMED, "record_id must be a WK-NNNN identifier");
  }
  if (!initiative || !INITIATIVE_RE.test(initiative)) {
    return refuseProof(PROOF_CODES.MALFORMED, "initiative must be an IN-NNNN identifier");
  }
  const refMatch = WK_REF_RE.exec(wkRef ?? "");
  if (!refMatch || refMatch[1] !== initiative || refMatch[2] !== recordId) {
    return refuseProof(
      PROOF_CODES.MALFORMED,
      "wk_ref must be the canonical per-WK branch ref for this record and initiative"
    );
  }
  if (!verifiedWkSha || !PROOF_OID_RE.test(verifiedWkSha)) {
    return refuseProof(PROOF_CODES.MALFORMED, "verified_wk_sha must be a Git object id");
  }
  if (!canonicalRecordDigest || !SHA256_DIGEST_RE.test(canonicalRecordDigest)) {
    return refuseProof(PROOF_CODES.MALFORMED, "canonical_record_digest must be a sha256 digest");
  }
  if (!mintedAt || !ISO_UTC_RE.test(mintedAt) || !Number.isFinite(Date.parse(mintedAt))) {
    return refuseProof(PROOF_CODES.MALFORMED, "minted_at must be an ISO-8601 UTC timestamp");
  }

  const relevantRunIds = normalizedTokenList(input.relevant_run_ids, BOUNDED_TOKEN_RE);
  const terminalRunIds = normalizedTokenList(input.terminal_run_ids, BOUNDED_TOKEN_RE);
  if (relevantRunIds === null || terminalRunIds === null) {
    return refuseProof(PROOF_CODES.MALFORMED, "relevant_run_ids and terminal_run_ids must be bounded run-id arrays");
  }
  const unresolvedReviewUnits = normalizedTokenList(input.unresolved_review_units, UNIT_REFERENCE_RE);
  const unintegratedUnits = normalizedTokenList(input.unintegrated_units, UNIT_REFERENCE_RE);
  if (unresolvedReviewUnits === null || unintegratedUnits === null) {
    return refuseProof(
      PROOF_CODES.MALFORMED,
      "unresolved_review_units and unintegrated_units must be arrays of WK-NNNN[#SLICE-NNN] references"
    );
  }

  if (!disposition || !DISPOSITION_SET.has(disposition)) {
    return refuseProof(
      PROOF_CODES.DISPOSITION_UNPROVEN,
      `disposition must be one of ${WK_TERMINAL_DISPOSITION_VALUES.join("|")}`
    );
  }
  if (!receiptId || !BOUNDED_TOKEN_RE.test(receiptId)) {
    return refuseProof(PROOF_CODES.DISPOSITION_UNPROVEN, "disposition_receipt_id must be a bounded receipt identifier");
  }
  if (!receiptDigest || !SHA256_DIGEST_RE.test(receiptDigest)) {
    return refuseProof(PROOF_CODES.DISPOSITION_UNPROVEN, "disposition_receipt_digest must be a sha256 digest");
  }
  const expectedReceiptDigest = computeWkTerminalDispositionReceiptDigest({
    record_id: recordId,
    initiative,
    wk_ref: wkRef,
    verified_wk_sha: verifiedWkSha,
    disposition,
    disposition_receipt_id: receiptId
  });
  if (receiptDigest !== expectedReceiptDigest) {
    return refuseProof(
      PROOF_CODES.DISPOSITION_UNPROVEN,
      "disposition_receipt_digest does not re-derive from the bound disposition facts"
    );
  }

  const proof = {
    schema_version: WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION,
    record_id: recordId,
    initiative,
    wk_ref: wkRef,
    verified_wk_sha: verifiedWkSha,
    canonical_record_digest: canonicalRecordDigest,
    disposition,
    disposition_receipt_id: receiptId,
    disposition_receipt_digest: receiptDigest,
    relevant_run_ids: relevantRunIds,
    terminal_run_ids: terminalRunIds,
    unresolved_review_units: unresolvedReviewUnits,
    unintegrated_units: unintegratedUnits,
    minted_at: mintedAt,
    proof_digest: null
  };
  proof.proof_digest = computeWkTerminalDispositionProofDigest(proof);
  return { ok: true, decision_code: null, reasons: [], proof: JSON.parse(JSON.stringify(proof)) };
}

function proofStructureFailure(proof) {
  if (!isPlainRecord(proof)) return "proof is not an object";
  if (proof.schema_version !== WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION) {
    return `proof schema_version must be ${WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION}`;
  }
  const keys = Object.keys(proof).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (keys.length !== WK_TERMINAL_DISPOSITION_PROOF_FIELDS.length ||
      keys.some((key, index) => key !== WK_TERMINAL_DISPOSITION_PROOF_FIELDS[index])) {
    return "proof does not carry the exact closed field set";
  }
  for (const field of PROOF_ARRAY_FIELDS) {
    if (!Array.isArray(proof[field]) || proof[field].some((entry) => typeof entry !== "string")) {
      return `${field} must be an array of strings`;
    }
  }
  if (!SHA256_DIGEST_RE.test(String(proof.proof_digest ?? ""))) return "proof_digest must be a sha256 digest";
  return null;
}

export function validateWkTerminalDispositionProof(proof, expectation = {}) {
  if (proof === null || proof === undefined) {
    return denyProof(PROOF_CODES.MISSING, "no WK terminal-disposition proof is persisted for this WK branch");
  }
  const structureFailure = proofStructureFailure(proof);
  if (structureFailure !== null) return denyProof(PROOF_CODES.MALFORMED, structureFailure);

  if (typeof proof.disposition !== "string" || !DISPOSITION_SET.has(proof.disposition)) {
    return denyProof(PROOF_CODES.DISPOSITION_UNPROVEN, "proof does not carry an enumerated terminal disposition");
  }
  if (computeWkTerminalDispositionProofDigest(proof) !== proof.proof_digest) {
    return denyProof(PROOF_CODES.MALFORMED, "proof_digest does not re-derive from the proof's bound facts");
  }

  const rebuilt = buildWkTerminalDispositionProof(
    Object.fromEntries(WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS.map((field) => [field, proof[field]]))
  );
  if (rebuilt.ok !== true) {

    return denyProof(rebuilt.decision_code ?? PROOF_CODES.MALFORMED, rebuilt.reasons[0] ?? "proof violates the canonical contract");
  }
  if (rebuilt.proof.proof_digest !== proof.proof_digest) {
    return denyProof(PROOF_CODES.MALFORMED, "proof does not rebuild to itself under the canonical contract");
  }

  if (!isPlainRecord(expectation)) {
    return denyProof(PROOF_CODES.BINDING_MISMATCH, "expectation binding context is required");
  }
  for (const field of ["record_id", "initiative", "wk_ref", "verified_wk_sha", "canonical_record_digest"]) {
    const expected = typeof expectation[field] === "string" ? expectation[field].trim() : null;
    if (!expected) return denyProof(PROOF_CODES.BINDING_MISMATCH, `expectation.${field} is required`);
    if (expected !== proof[field]) {
      return denyProof(PROOF_CODES.BINDING_MISMATCH, `${field} does not match the resolved WK binding`);
    }
  }

  const terminal = new Set(proof.terminal_run_ids);
  const stillRunning = proof.relevant_run_ids.filter((runId) => !terminal.has(runId));
  if (stillRunning.length > 0) {
    return denyProof(
      PROOF_CODES.WORKERS_NOT_TERMINATED,
      `relevant worker/reviewer runs are not proven terminated: ${stillRunning.join(", ")}`
    );
  }
  if (proof.unresolved_review_units.length > 0) {
    return denyProof(
      PROOF_CODES.REVIEW_UNRESOLVED,
      `units remain in unresolved review: ${proof.unresolved_review_units.join(", ")}`
    );
  }
  if (proof.unintegrated_units.length > 0) {
    return denyProof(
      PROOF_CODES.UNINTEGRATED_WORK,
      `needed implementation work is neither integrated nor explicitly cancelled/reverted: ${proof.unintegrated_units.join(", ")}`
    );
  }

  const expectedReceiptDigest = computeWkTerminalDispositionReceiptDigest(proof);
  if (proof.disposition_receipt_digest !== expectedReceiptDigest) {
    return denyProof(
      PROOF_CODES.DISPOSITION_UNPROVEN,
      "disposition_receipt_digest does not re-derive from the proof's bound disposition facts"
    );
  }
  return { valid: true, decision_code: null, reasons: [] };
}

export function wkTerminalDispositionProofPath(mainRepo, initiative, recordId) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  if (!INITIATIVE_RE.test(String(initiative)) || !RECORD_ID_RE.test(String(recordId))) {
    fail(
      PROOF_CODES.BINDING_MISMATCH,
      `cannot address a terminal-disposition proof for (${initiative}, ${recordId})`,
      { initiative, record_id: recordId }
    );
  }
  return path.join(repo, ".agent-launch", "wk-terminal-disposition", `${initiative}.${recordId}.json`);
}

export function defaultResolveWkTerminalDispositionProof({ mainRepo, initiative, recordId }) {
  const filePath = wkTerminalDispositionProofPath(mainRepo, initiative, recordId);
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {

    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(
      PROOF_CODES.MALFORMED,
      `persisted WK terminal-disposition proof is not valid JSON: ${filePath}`,
      { proof_path: filePath },
      err
    );
  }
}

function readBranchTip(runGit, mainRepo, branch) {
  const res = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`] });
  if (!res || res.ok !== true) return null;
  const sha = (res.stdout ?? "").trim();
  return PROOF_OID_RE.test(sha) ? sha : null;
}

function readCanonicalRecordDigest(mainRepo, recordId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${recordId}.json`);
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch {
    return null;
  }
  if (!isPlainRecord(record) || record.id !== recordId) return null;
  return computeWorkRecordSourceDigest(record);
}

export function assertWkTerminalDisposition({ mainRepo, binding, runGit, resolveProof }) {
  const initiative = binding.initiative ?? null;

  const recordId = binding.wk_id ?? binding.record_id ?? null;
  if (!INITIATIVE_RE.test(String(initiative)) || !RECORD_ID_RE.test(String(recordId))) {
    fail(
      PROOF_CODES.BINDING_MISMATCH,
      "resolved binding does not name a canonical initiative + work record, so no terminal disposition can be proven",
      { initiative, record_id: recordId }
    );
  }
  const wkRef = `refs/heads/${binding.output_branch}`;
  const refMatch = WK_REF_RE.exec(wkRef);
  if (!refMatch || refMatch[1] !== initiative || refMatch[2] !== recordId) {
    fail(
      PROOF_CODES.BINDING_MISMATCH,
      `resolved branch ${binding.output_branch} does not agree with the binding's ${initiative}/${recordId}`,
      { wk_ref: wkRef, initiative, record_id: recordId }
    );
  }

  const currentTip = readBranchTip(runGit, mainRepo, binding.output_branch);
  if (currentTip === null) {
    fail(
      PROOF_CODES.BINDING_MISMATCH,
      `cannot resolve the current tip of ${binding.output_branch}, so no proof can be bound to it`,
      { wk_ref: wkRef }
    );
  }
  const canonicalRecordDigest = readCanonicalRecordDigest(mainRepo, recordId);
  if (canonicalRecordDigest === null) {
    fail(
      PROOF_CODES.BINDING_MISMATCH,
      `cannot read the canonical work record for ${recordId}, so no proof can be bound to it`,
      { record_id: recordId }
    );
  }

  const proof = resolveProof({ mainRepo, initiative, recordId, binding }) ?? null;
  const verdict = validateWkTerminalDispositionProof(proof, {
    record_id: recordId,
    initiative,
    wk_ref: wkRef,
    verified_wk_sha: currentTip,
    canonical_record_digest: canonicalRecordDigest
  });
  if (verdict.valid !== true) {
    fail(
      verdict.decision_code,
      `refusing to reap ${binding.output_branch}: ${verdict.reasons.join("; ")}`,
      {
        wk_ref: wkRef,
        record_id: recordId,
        initiative,
        current_tip: currentTip,
        decision_code: verdict.decision_code
      }
    );
  }
  return Object.freeze({
    schema_version: proof.schema_version,
    disposition: proof.disposition,
    disposition_receipt_id: proof.disposition_receipt_id,
    proof_digest: proof.proof_digest,
    verified_wk_sha: proof.verified_wk_sha,
    canonical_record_digest: proof.canonical_record_digest
  });
}
