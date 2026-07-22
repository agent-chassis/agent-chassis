

import { lifecycleError } from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { assertTerminalReviewMaterializationAttestation } from "../../../agent-launch-cli/src/lib/backend-scope-authority.mjs";
import { SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE } from
  "../../../agent-launch-cli/src/lib/host-write-authority-substrate/broker-slice-integration.mjs";
import { TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";

import {
  HOST_WRITE_AUTHORITY_TERMINAL_REVIEW_EVIDENCE_FIELDS,
  TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION,
  TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/request-envelopes-integrate-slice.mjs";

export const TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE =
  "agent_launch.terminal_review_materialization.materializer_unavailable.v1";

export const TERMINAL_REVIEW_EVIDENCE_MODES = Object.freeze({

  LIVE_MATERIALIZER: "live_materializer",

  TRANSPORTED_ATTESTATION: "transported_attestation"
});

export const TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES = Object.freeze({

  MODE_UNAVAILABLE:
    "agent_launch.terminal_review_materialization.evidence_mode_unavailable.v1",

  UNEXPECTED_TRANSPORTED_EVIDENCE:
    "agent_launch.terminal_review_materialization.unexpected_transported_evidence.v1",
  UNEXPECTED_MATERIALIZER:
    "agent_launch.terminal_review_materialization.unexpected_materializer.v1",

  TRANSPORTED_EVIDENCE_MISSING:
    "agent_launch.terminal_review_materialization.transported_evidence_missing.v1",
  TRANSPORTED_EVIDENCE_MALFORMED:
    "agent_launch.terminal_review_materialization.transported_evidence_malformed.v1",

  TRANSPORTED_EVIDENCE_BINDING_MISMATCH:
    "agent_launch.terminal_review_materialization.transported_evidence_binding_mismatch.v1"
});

export const TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES = Object.freeze([
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_TRANSPORTED_EVIDENCE,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_MATERIALIZER,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID
]);

const TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODE_SET =
  new Set(TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES);

const TERMINAL_REVIEW_ADAPTER_ISSUE_CLASSIFICATION = Object.freeze({
  integration_terminal_review_evidence_fields_not_exact:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_schema_unknown:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_target_fields_not_exact:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_run_fields_not_exact:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_wk_binding_fields_not_exact:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_wk_binding_schema_unknown:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_wk_binding_malformed:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
  integration_terminal_review_evidence_target_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_run_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_wk_binding_run_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_wk_binding_unit_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_wk_binding_branch_invalid:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_wk_binding_branch_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_evidence_wk_binding_path_mismatch:
    TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
  integration_terminal_review_materialization_fields_not_exact:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
  integration_terminal_review_materialization_not_verified:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
  integration_terminal_review_materialization_object_id_malformed:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
  integration_terminal_review_materialization_worktree_path_invalid:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
  integration_terminal_review_materialization_ref_mismatch:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
  integration_terminal_review_materialization_sha_mismatch:
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID
});

const POLICY_DETAIL_MAX_DEPTH = 4;
const POLICY_DETAIL_MAX_KEYS = 32;
const POLICY_DETAIL_MAX_ITEMS = 32;
const POLICY_DETAIL_MAX_STRING = 1024;

function boundedPolicyDetail(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length <= POLICY_DETAIL_MAX_STRING
      ? value
      : `${value.slice(0, POLICY_DETAIL_MAX_STRING)}…[truncated]`;
  }
  if (depth >= POLICY_DETAIL_MAX_DEPTH) return "[depth-capped]";
  if (Array.isArray(value)) {
    return value.slice(0, POLICY_DETAIL_MAX_ITEMS)
      .map((entry) => boundedPolicyDetail(entry, depth + 1));
  }
  if (!isPlainLifecycleObject(value)) return `[${typeof value}]`;
  const output = {};
  for (const key of Object.keys(value).sort().slice(0, POLICY_DETAIL_MAX_KEYS)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      output[key] = boundedPolicyDetail(descriptor.value, depth + 1);
    }
  }
  return output;
}

function ownData(value, field) {
  if (!isPlainLifecycleObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function policyCause({ code, message, detail, origin, originalRefusal = null }) {
  return Object.freeze({
    code,
    message: boundedPolicyDetail(typeof message === "string" ? message : String(message ?? code)),
    detail: boundedPolicyDetail(detail ?? null),
    origin,
    ...(originalRefusal === null
      ? {}
      : { original_refusal: Object.freeze(boundedPolicyDetail(originalRefusal)) })
  });
}

export function classifyTerminalReviewPolicyRefusal(error) {
  const directCode = ownData(error, "code");
  if (TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODE_SET.has(directCode)) {
    return policyCause({
      code: directCode,
      message: ownData(error, "message"),
      detail: ownData(error, "detail"),
      origin: "terminal_review_evidence_gate"
    });
  }

  const lifecycleDetail = ownData(error, "detail");
  const brokerRefusal = ownData(lifecycleDetail, "broker_refusal");
  if (ownData(brokerRefusal, "reason") !== "broker_refused") return null;
  const adapterDetail = ownData(brokerRefusal, "detail");

  const brokerDetail = ownData(adapterDetail, "broker_refusal_detail");
  const brokerWrappedCode = ownData(brokerDetail, "code");
  const brokerErrorDetail = ownData(brokerDetail, "error_detail");
  const materializationCode = ownData(brokerErrorDetail, "materialization_code");
  if (brokerWrappedCode === SLICE_INTEGRATION_REVIEW_FREEZE_FAILED_CODE &&
      TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODE_SET.has(materializationCode)) {
    return policyCause({
      code: materializationCode,
      message: ownData(brokerDetail, "message"),
      detail: ownData(brokerErrorDetail, "materialization_detail"),
      origin: "upstream_broker_materialization",
      originalRefusal: brokerRefusal
    });
  }

  const issue = ownData(adapterDetail, "issue");
  const classifiedCode = typeof issue === "string" &&
      Object.prototype.hasOwnProperty.call(TERMINAL_REVIEW_ADAPTER_ISSUE_CLASSIFICATION, issue)
    ? TERMINAL_REVIEW_ADAPTER_ISSUE_CLASSIFICATION[issue]
    : null;
  if (classifiedCode !== null) {
    return policyCause({
      code: classifiedCode,
      message: `host adapter refused terminal-review evidence (${issue})`,
      detail: adapterDetail,
      origin: "upstream_adapter_evidence",
      originalRefusal: brokerRefusal
    });
  }
  return null;
}

function isPlainLifecycleObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactLifecycleFields(value, fields) {
  if (!isPlainLifecycleObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

const TRANSPORTED_REVIEW_TARGET_FIELDS = Object.freeze([
  "schema_version",
  "unit_address",
  "ref",
  "sha",
  "diff_base_sha",
  "diff_head_sha",
  "diff_range",
  "complete_parent_wk_contract",
  "accumulated_wk_diff"
]);

const TRANSPORTED_RUN_FIELDS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

function verifyTransportedTerminalReviewEvidence({ evidence, integration, bindings, status, wkRef }) {
  const worktreePath = bindings.provisioning.validation_worktree_path;
  const refuse = (code, message, detail) => {
    throw lifecycleError(code, message, {
      worktree_path: worktreePath,
      wk_ref: wkRef,
      frozen_sha: integration.review_target.sha,
      ...detail
    });
  };

  if (!hasExactLifecycleFields(evidence, HOST_WRITE_AUTHORITY_TERMINAL_REVIEW_EVIDENCE_FIELDS)) {
    refuse(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
      "the broker-transported terminal review attestation does not carry the exact closed field set",
      { keys: isPlainLifecycleObject(evidence) ? Object.keys(evidence).sort() : null }
    );
  }
  if (evidence.schema_version !== TERMINAL_REVIEW_EVIDENCE_SCHEMA_VERSION) {
    refuse(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
      "the broker-transported terminal review attestation carries an unknown schema version",
      { schema_version: evidence.schema_version ?? null }
    );
  }
  if (!hasExactLifecycleFields(evidence.review_target, TRANSPORTED_REVIEW_TARGET_FIELDS) ||
      !hasExactLifecycleFields(evidence.run, TRANSPORTED_RUN_FIELDS) ||
      !hasExactLifecycleFields(evidence.wk_binding, TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS)) {
    refuse(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MALFORMED,
      "the broker-transported terminal review attestation carries a malformed bound subtree",
      {
        review_target_keys: isPlainLifecycleObject(evidence.review_target)
          ? Object.keys(evidence.review_target).sort()
          : null,
        run_keys: isPlainLifecycleObject(evidence.run) ? Object.keys(evidence.run).sort() : null,
        wk_binding_keys: isPlainLifecycleObject(evidence.wk_binding)
          ? Object.keys(evidence.wk_binding).sort()
          : null
      }
    );
  }

  assertTerminalReviewMaterializationAttestation(evidence.materialization, {
    worktreePath,
    wkRef,
    wkSha: integration.review_target.sha
  });

  const run = evidence.run;
  const expectedRun = {
    assigned_unit: status.subject,
    launch_ref: status.monitor_handle,
    run_id: status.run_id,
    retry_id: bindings.wk.retry_id
  };
  for (const field of Object.keys(expectedRun)) {
    if (run[field] !== expectedRun[field]) {
      refuse(
        TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
        "the transported attestation was minted under a different run identity",
        { field }
      );
    }
  }

  for (const field of TERMINAL_REVIEW_EVIDENCE_WK_BINDING_FIELDS) {
    if (evidence.wk_binding[field] !== bindings.wk[field]) {
      refuse(
        TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_BINDING_MISMATCH,
        "the transported attestation was minted against a different WK worktree binding",
        { field }
      );
    }
  }
  return evidence.materialization;
}

export function resolveTerminalReviewEvidence({ deps, integration, bindings, status, wkRef, runGit, workspaceDir }) {
  const mode = deps.terminalReviewEvidenceMode ?? null;
  const materializer = deps.materializeTerminalReviewWorktree;
  const transported = integration.terminal_review_evidence ?? null;
  const refusalDetail = {
    worktree_path: bindings.provisioning.validation_worktree_path,
    wk_ref: wkRef,
    frozen_sha: integration.review_target.sha,
    evidence_mode: mode
  };

  if (mode !== TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER &&
      mode !== TERMINAL_REVIEW_EVIDENCE_MODES.TRANSPORTED_ATTESTATION) {
    throw lifecycleError(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE,
      "no launcher-owned terminal review evidence mode is composed, so the persistent review worktree cannot be proven current",
      refusalDetail
    );
  }

  if (mode === TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER) {
    if (typeof materializer !== "function") {
      throw lifecycleError(
        TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE,
        "the terminal review materialize/verify step is not composed, so the persistent review worktree cannot be proven current",
        refusalDetail
      );
    }

    if (transported !== null) {
      throw lifecycleError(
        TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_TRANSPORTED_EVIDENCE,
        "the direct writable-host route verifies the worktree itself and does not accept a transported attestation",
        refusalDetail
      );
    }
    const materialization = materializer({
      mainRepo: workspaceDir,
      worktreePath: bindings.provisioning.validation_worktree_path,
      wkRef,
      frozenSha: integration.review_target.sha,
      runGit
    });

    assertTerminalReviewMaterializationAttestation(materialization, {
      worktreePath: bindings.provisioning.validation_worktree_path,
      wkRef,
      wkSha: integration.review_target.sha
    });
    return materialization;
  }

  if (materializer !== undefined) {
    throw lifecycleError(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_MATERIALIZER,
      "the broker route cannot run a live materialize in this read-only namespace, so a composed materializer is a wiring fault",
      refusalDetail
    );
  }

  if (transported === null) {
    throw lifecycleError(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.TRANSPORTED_EVIDENCE_MISSING,
      "the broker route requires a bound terminal review attestation and this integration result carries none",
      { ...refusalDetail, recovered: integration.recovered === true }
    );
  }
  return verifyTransportedTerminalReviewEvidence({ evidence: transported, integration, bindings, status, wkRef });
}
