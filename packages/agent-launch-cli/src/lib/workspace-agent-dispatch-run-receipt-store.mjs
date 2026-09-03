

import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import {
  ensureLauncherOwnedWorkspaceDurableStateRoot
} from "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";
import {
  withStoreLock,
  inject,
  publishImmutableEvidenceOnce,
  syncDirectory,
  typedRefusal,
  unitPartitionDigest,
  writeAtomicImmutable,
  writeAtomicPublished
} from "./workspace-agent-dispatch-run-receipt-store-io.mjs";
import {
  createExactSliceReviewReceiptSelectorJournal,
} from "./workspace-agent-dispatch-run-receipt-selector-journal.mjs";
import {
  DIGEST_RE,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4,
  OPAQUE_ID_RE,
  RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD,
  RECEIPT_DIRECTORY,
  UNIT_RE
} from "./workspace-agent-dispatch-run-receipt-schema.mjs";
import {
  assertString,
  canonicalize,
  digestTrustedExactReviewEvidence,
  hasExactKeys,
  validateExactSliceReviewReceipt
} from "./workspace-agent-dispatch-run-receipt-validation.mjs";
import {
  assertMonotonicTransition,
  identityDigest
} from "./workspace-agent-dispatch-run-receipt-transitions.mjs";
import {
  validateWorkspaceAgentResultModeEnvelope,
  workspaceAgentResultModeEnvelopesEqual
} from "./workspace-agent-dispatch-result-mode.mjs";

const TERMINAL_RESULT_DIRECTORY = "terminal-run-results";
const TERMINAL_RESULT_SCHEMA_VERSION =
  "workspace-agent-exact-slice-review-terminal-result.v1";
const TERMINAL_RESULT_SCHEMA_VERSION_V2 =
  "workspace-agent-exact-slice-review-terminal-result.v2";
const RECOVERED_FINAL_RESULT_SCHEMA_VERSION =
  "workspace-agent-recovered-terminal-result.v1";
const TERMINAL_RESULT_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const FINAL_RESULT_KINDS = new Set(["findings", "no_findings", "missing_result"]);

const STORE_OWNED_RECEIPT_OCCURRENCES = new WeakSet();

function assertImmutableDependencyProjectionEvidence(prior, next) {
  const priorEvidence = canonicalize(
    prior[RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD] ?? null
  );
  const nextEvidence = canonicalize(
    next[RECEIPT_DEPENDENCY_PROJECTION_EVIDENCE_FIELD] ?? null
  );
  if (JSON.stringify(priorEvidence) !== JSON.stringify(nextEvidence)) {
    throw new Error("exact slice review receipt cannot rewrite dependency projection evidence");
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isExactSliceReviewReceiptStoreOccurrence(value) {
  return isPlainObject(value) && STORE_OWNED_RECEIPT_OCCURRENCES.has(value);
}

function resultModeFailure(message, code, cause = undefined) {
  const failure = new Error(message, cause === undefined ? undefined : { cause });
  failure.code = code;
  return failure;
}

function exactResultModeEnvelope(finalResult, receipt) {
  let observed;
  let recorded;
  try {
    observed = validateWorkspaceAgentResultModeEnvelope(finalResult?.result_mode);
    recorded = validateWorkspaceAgentResultModeEnvelope(receipt?.result_mode);
  } catch (error) {
    throw resultModeFailure(
      "exact slice review terminal result requires complete result-mode evidence",
      "exact_slice_review_terminal_result_mode_invalid",
      error
    );
  }
  if (!workspaceAgentResultModeEnvelopesEqual(observed, recorded)) {
    throw resultModeFailure(
      "exact slice review terminal result mode conflicts with its receipt",
      "exact_slice_review_terminal_result_mode_conflict"
    );
  }
  return observed;
}

function boundedFinalResult(finalResult, receipt) {
  const kind = typeof finalResult?.kind === "string" && finalResult.kind.length > 0
    ? finalResult.kind
    : null;
  return Object.freeze(canonicalize({
    ...finalResult,
    schema_version: RECOVERED_FINAL_RESULT_SCHEMA_VERSION,
    original_schema_version: typeof finalResult?.schema_version === "string"
      ? finalResult.schema_version
      : "workspace-agent-dispatch-final-result.v1",
    kind,
    result_mode: exactResultModeEnvelope(finalResult, receipt),
    structured_role_result: isPlainObject(finalResult?.structured_role_result)
      ? canonicalize(finalResult.structured_role_result)
      : null
  }));
}

function terminalResultBody(receipt, finalResult, repositoryPath) {
  if (receipt.schema_version !== EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 ||
      typeof repositoryPath !== "string" || !path.isAbsolute(repositoryPath) ||
      path.normalize(repositoryPath) !== repositoryPath) {
    throw new Error("terminal run-result evidence lacks exact repository or lineage identity");
  }
  if (!isPlainObject(finalResult) || !FINAL_RESULT_KINDS.has(finalResult.kind)) {
    throw new Error("terminal run-result evidence lacks the exact launcher final result");
  }
  exactResultModeEnvelope(finalResult, receipt);
  return canonicalize({
    schema_version: TERMINAL_RESULT_SCHEMA_VERSION_V2,
    repository_path: repositoryPath,
    unit_address: receipt.unit_address,
    review_admission_kind: receipt.review_admission_kind,
    committed_target_digest: receipt.committed_target_digest,
    review_run_id: receipt.review_run_id,
    review_monitor_handle: receipt.review_monitor_handle,
    reviewer_role: receipt.reviewer_role,
    reviewed_sha: receipt.reviewed_sha,
    diff_base_sha: receipt.diff_base_sha,
    lineage_identity_digest: identityDigest(receipt),
    target_identity: receipt.attempt_lineage_identity.target,
    attempt_lineage_identity: receipt.attempt_lineage_identity,
    terminal_run_status: receipt.terminal_run_status,
    structured_outcome: receipt.structured_outcome,
    final_result: boundedFinalResult(finalResult, receipt)
  });
}

function validateTerminalResultEvidence(evidence, receipt, repositoryPath = null) {
  const commonKeys = [
    "schema_version", "unit_address", "review_admission_kind",
    "committed_target_digest", "review_run_id", "review_monitor_handle",
    "reviewer_role", "reviewed_sha", "diff_base_sha",
    "lineage_identity_digest", "terminal_run_status", "structured_outcome",
    "final_result", "evidence_digest"
  ];
  const v2 = evidence?.schema_version === TERMINAL_RESULT_SCHEMA_VERSION_V2;
  const expectedKeys = v2
    ? [...commonKeys, "repository_path", "target_identity", "attempt_lineage_identity"]
    : commonKeys;
  if (!hasExactKeys(evidence, expectedKeys) ||
      !new Set([TERMINAL_RESULT_SCHEMA_VERSION, TERMINAL_RESULT_SCHEMA_VERSION_V2])
        .has(evidence.schema_version) ||
      !TERMINAL_RESULT_STATUSES.has(evidence.terminal_run_status) ||
      typeof evidence.evidence_digest !== "string") {
    throw new Error("exact slice review terminal result evidence is malformed");
  }
  const { evidence_digest: _digest, ...body } = evidence;
  if (digestTrustedExactReviewEvidence(body) !== evidence.evidence_digest) {
    throw new Error("exact slice review terminal result evidence digest mismatch");
  }
  const identityFields = [
    "unit_address", "review_admission_kind", "committed_target_digest",
    "review_run_id", "review_monitor_handle", "reviewer_role", "reviewed_sha",
    "diff_base_sha"
  ];
  if (identityFields.some((field) => evidence[field] !== receipt[field]) ||
      evidence.lineage_identity_digest !== identityDigest(receipt)) {
    throw new Error("exact slice review terminal result evidence identity mismatch");
  }
  if (v2 && (receipt.schema_version !== EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 ||
      typeof evidence.repository_path !== "string" ||
      !path.isAbsolute(evidence.repository_path) ||
      path.normalize(evidence.repository_path) !== evidence.repository_path ||
      (repositoryPath !== null && evidence.repository_path !== repositoryPath) ||
      JSON.stringify(evidence.target_identity) !==
        JSON.stringify(canonicalize(receipt.attempt_lineage_identity.target)) ||
      JSON.stringify(evidence.attempt_lineage_identity) !==
        JSON.stringify(canonicalize(receipt.attempt_lineage_identity)))) {
    throw new Error("exact slice review terminal result repository or lineage mismatch");
  }
  const mode = evidence.final_result?.result_mode;
  const legacyFinalResultKeys = v2
    ? ["schema_version", "kind", "result_mode", "structured_role_result"]
    : ["schema_version", "kind", "result_mode"];
  const enrichedV2 = v2 && isPlainObject(evidence.final_result) &&
    typeof evidence.final_result.original_schema_version === "string";
  if ((!enrichedV2 && !hasExactKeys(evidence.final_result, legacyFinalResultKeys)) ||
      evidence.final_result.schema_version !== RECOVERED_FINAL_RESULT_SCHEMA_VERSION ||
      (enrichedV2 && evidence.final_result.original_schema_version.length === 0) ||
      !FINAL_RESULT_KINDS.has(evidence.final_result.kind) ||
      (v2 && !(evidence.final_result.structured_role_result === null ||
        isPlainObject(evidence.final_result.structured_role_result)))) {
    throw new Error("exact slice review terminal result projection is malformed");
  }
  try {
    validateWorkspaceAgentResultModeEnvelope(mode);
  } catch (error) {
    throw resultModeFailure(
      "exact slice review terminal result projection has invalid result-mode evidence",
      "exact_slice_review_terminal_result_mode_invalid",
      error
    );
  }
  return Object.freeze(canonicalize(evidence));
}

export {
  EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE,
  EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE
} from "./workspace-agent-dispatch-run-receipt-store-io.mjs";

async function ensureDurableExactSliceReviewReceiptRoot({ workspaceDir } = {}) {
  return ensureLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
}

export function createExactSliceReviewReceiptStore({
  workspaceDir,
  env = process.env,
  ensureRuntimeStateDir = ensureDurableExactSliceReviewReceiptRoot,
  faultInjector = null
} = {}) {
  const journal = createExactSliceReviewReceiptSelectorJournal({ faultInjector });

  async function receiptDirectory() {
    const ensured = await ensureRuntimeStateDir({ workspaceDir, env });
    if (ensured?.ok !== true) {

      const failure = new Error(
        ensured?.reason ?? "launcher runtime state unavailable for exact review receipts"
      );
      if (typeof ensured?.code === "string" && ensured.code.length > 0) {
        failure.code = ensured.code;
      }
      throw failure;
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

  async function reconciledJournal(dir) {
    return journal.ensurePartitionedLayout(dir);
  }

  async function ensureEvidenceDirectory(dir, name) {
    const evidenceDir = path.join(dir, name);
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await syncDirectory(evidenceDir);
    await syncDirectory(dir);
    return evidenceDir;
  }

  async function persist(receipt) {
    const validated = validateExactSliceReviewReceipt(receipt);
    const dir = await receiptDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      return await journal.persistUnderStoreLock(dir, validated, {
        guardTransition: async (current) => {
          assertImmutableDependencyProjectionEvidence(current, validated);
        }
      });
    });
  }

  async function persistTerminalRunResult({
    receipt,
    repository_path: repositoryPath,
    final_result: finalResult
  } = {}) {
    const validated = validateExactSliceReviewReceipt(receipt);
    if (!TERMINAL_RESULT_STATUSES.has(validated.terminal_run_status)) {
      throw new Error("terminal run-result evidence requires a terminal receipt candidate");
    }
    const dir = await receiptDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      await reconciledJournal(dir);
      const identity = identityDigest(validated);
      const current = journal.latestByIdentity(
        await journal.readPartitionEvents(dir, validated.unit_address)
      ).find((event) => event.identity_digest === identity)?.receipt ?? null;
      if (current === null) {
        throw new Error("terminal run-result evidence has no elected receipt lineage");
      }
      if (current.receipt_digest !== validated.receipt_digest) {
        assertImmutableDependencyProjectionEvidence(current, validated);
        assertMonotonicTransition(current, validated);
      }
      const body = terminalResultBody(validated, finalResult, repositoryPath);
      const evidence = Object.freeze(canonicalize({
        ...body,
        evidence_digest: digestTrustedExactReviewEvidence(body)
      }));
      validateTerminalResultEvidence(evidence, current, repositoryPath);
      const terminalDir = await ensureEvidenceDirectory(dir, TERMINAL_RESULT_DIRECTORY);
      const evidencePath = path.join(terminalDir, `${identity}.json`);
      try {
        const existing = JSON.parse(await readFile(evidencePath, "utf8"));
        const validatedExisting = validateTerminalResultEvidence(
          existing,
          current,
          repositoryPath
        );
        if (validatedExisting.evidence_digest !== evidence.evidence_digest) {
          throw new Error("exact slice review terminal result evidence conflicts with its immutable lineage");
        }
        return validatedExisting;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await writeAtomicPublished(
        evidencePath,
        `${JSON.stringify(evidence, null, 2)}\n`,
        faultInjector,
        "terminal_result"
      );
      return evidence;
    });
  }

  async function loadTerminalRunResult({ receipt, repository_path: repositoryPath = null } = {}) {
    const validated = validateExactSliceReviewReceipt(receipt);
    const dir = await receiptDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      await reconciledJournal(dir);
      const identity = identityDigest(validated);
      const current = journal.latestByIdentity(
        await journal.readPartitionEvents(dir, validated.unit_address)
      ).find((event) => event.identity_digest === identity)?.receipt ?? null;
      if (current === null || current.review_run_id !== validated.review_run_id ||
          current.review_monitor_handle !== validated.review_monitor_handle) {
        throw new Error("terminal run-result recovery lost the selected receipt lineage");
      }
      const evidencePath = path.join(dir, TERMINAL_RESULT_DIRECTORY, `${identity}.json`);
      let parsed;
      try {
        parsed = JSON.parse(await readFile(evidencePath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
      return validateTerminalResultEvidence(parsed, current, repositoryPath);
    });
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
    return withStoreLock(dir, faultInjector, async () => {
      await reconciledJournal(dir);
      const events = journal.latestByIdentity(await journal.readPartitionEvents(dir, selector.unit_address));
      const matches = events.filter(({ receipt }) => receipt.unit_address === selector.unit_address &&
        (hasRun ? receipt.review_run_id === selector.review_run_id :
          receipt.review_monitor_handle === selector.monitor_handle));
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw new Error("exact slice review receipt selector is conflicting");
      return validateExactSliceReviewReceipt(matches[0].receipt, selector);
    });
  }

  async function loadLatest(unitAddress) {
    assertString(unitAddress, "unit_address selector", UNIT_RE);
    const dir = await receiptDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      await reconciledJournal(dir);
      const matches = journal.latestByIdentity(await journal.readPartitionEvents(dir, unitAddress))
        .filter(({ receipt }) => receipt.unit_address === unitAddress)
        .sort((left, right) => right.generation - left.generation);
      return matches.length === 0
        ? null
        : validateExactSliceReviewReceipt(matches[0].receipt, { unit_address: unitAddress });
    });
  }

  async function loadAll({ unit_address: unitAddress, committed_target_digest: targetDigest } = {}) {
    assertString(unitAddress, "unit_address selector", UNIT_RE);
    if (targetDigest !== undefined) {
      assertString(targetDigest, "committed_target_digest selector", DIGEST_RE);
    }
    const dir = await receiptDirectory();
    return withStoreLock(dir, faultInjector, async () => {
      await reconciledJournal(dir);
      const receipts = journal.latestByIdentity(await journal.readPartitionEvents(dir, unitAddress))
        .filter(({ receipt }) => receipt.unit_address === unitAddress &&
          (targetDigest === undefined || receipt.committed_target_digest === targetDigest))
        .sort((left, right) => left.generation - right.generation)
        .map(({ receipt }) => validateExactSliceReviewReceipt(receipt, {
          unit_address: unitAddress
        }));
      for (const receipt of receipts) STORE_OWNED_RECEIPT_OCCURRENCES.add(receipt);
      return receipts;
    });
  }

  const store = Object.freeze({
    persist,
    persistTerminalRunResult,
    loadTerminalRunResult,
    load: select,
    loadLatest,
    loadAll
  });
  return store;
}
