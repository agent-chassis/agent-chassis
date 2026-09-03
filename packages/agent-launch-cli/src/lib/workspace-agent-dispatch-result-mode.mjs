

import { isCleanupOnlyReviewerVerdict } from "./workspace-agent-dispatch-review-result.mjs";

export const WORKSPACE_AGENT_RESULT_MODE_SCHEMA_VERSION =
  "workspace-agent-result-mode.v1";
export const WORKSPACE_AGENT_RESULT_MODES = Object.freeze({
  STRUCTURED_RESULT: "structured_result",
  NEUTRAL_PROSE: "neutral_prose",
  LEGACY_COMPLETION: "legacy_completion",
  CONFIGURED_STRUCTURE_INVALID: "configured_structure_invalid",
  MISSING_OUTPUT: "missing_output",
  IDENTITY_UNRESOLVED: "identity_unresolved",
  CONFINEMENT_FAILURE: "confinement_failure",
  RUNTIME_FAILURE: "runtime_failure"
});
export const WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS = Object.freeze({
  FENCED: "fenced",
  SCHEMA_CONSTRAINED: "schema_constrained",
  FREE_PROSE: "free_prose"
});
export const WORKSPACE_AGENT_TERMINAL_RESULT_MODE_FACTS_SCHEMA_VERSION =
  "workspace-agent-terminal-result-mode-facts.v1";
const LAUNCHER_OBSERVED_TERMINAL_RESULT_MODE_FACTS = Symbol(
  "workspace-agent-launcher-observed-terminal-result-mode-facts"
);

const RESULT_MODE_KEYS = Object.freeze([
  "schema_version", "mode", "selected_contract", "authority", "prose_authority"
]);
const RESULT_MODE_DIAGNOSTIC_KEYS = Object.freeze([...RESULT_MODE_KEYS, "diagnostic"]);
const RESULT_MODE_VALUES = new Set(Object.values(WORKSPACE_AGENT_RESULT_MODES));
const SELECTED_RESULT_CONTRACT_VALUES = new Set(
  Object.values(WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS)
);
const PRE_EXPLICIT_RECEIPT_SCHEMA_VERSION =
  "workspace-agent-exact-slice-review-receipt.v3";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function isSelectedResultContract(value) {
  return value === null || SELECTED_RESULT_CONTRACT_VALUES.has(value);
}

function completeResultModeEnvelope(mode, selectedContract = null, diagnostic = null) {
  if (!RESULT_MODE_VALUES.has(mode) ||
      !isSelectedResultContract(selectedContract) ||
      !(diagnostic === null || typeof diagnostic === "string")) {
    throw new TypeError("workspace-agent result-mode facts are malformed");
  }
  const envelope = {
    schema_version: WORKSPACE_AGENT_RESULT_MODE_SCHEMA_VERSION,
    mode,
    selected_contract: selectedContract,
    authority: "launcher_observation_only",
    prose_authority: "none",
    ...(diagnostic === null ? {} : { diagnostic })
  };
  return Object.freeze(envelope);
}

export function isWorkspaceAgentResultModeEnvelope(value) {
  const keys = value?.diagnostic === undefined
    ? RESULT_MODE_KEYS
    : RESULT_MODE_DIAGNOSTIC_KEYS;
  return hasExactKeys(value, keys) &&
    value.schema_version === WORKSPACE_AGENT_RESULT_MODE_SCHEMA_VERSION &&
    RESULT_MODE_VALUES.has(value.mode) &&
    isSelectedResultContract(value.selected_contract) &&
    value.authority === "launcher_observation_only" &&
    value.prose_authority === "none" &&
    (value.diagnostic === undefined || typeof value.diagnostic === "string");
}

export function validateWorkspaceAgentResultModeEnvelope(value) {
  if (!isWorkspaceAgentResultModeEnvelope(value)) {
    throw new TypeError("workspace-agent result-mode envelope is malformed");
  }
  return value;
}

export function workspaceAgentResultModeEnvelopesEqual(left, right) {
  if (!isWorkspaceAgentResultModeEnvelope(left) ||
      !isWorkspaceAgentResultModeEnvelope(right)) return false;
  return RESULT_MODE_DIAGNOSTIC_KEYS.every((key) => left[key] === right[key]);
}

export function buildWorkspaceAgentResultModeEnvelope({
  mode, selected_contract: selectedContract = null, diagnostic = null
} = {}) {
  if (!RESULT_MODE_VALUES.has(mode) ||
      !isSelectedResultContract(selectedContract) ||
      !(diagnostic === null || typeof diagnostic === "string")) {
    throw new TypeError("workspace-agent result-mode facts are malformed");
  }
  return completeResultModeEnvelope(mode, selectedContract, diagnostic);
}

export function attachLauncherObservedTerminalResultModeFacts(result, facts) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
  if (!hasExactKeys(facts, ["selectedContract"]) ||
      !isSelectedResultContract(facts.selectedContract)) {
    throw new TypeError("workspace-agent terminal result-mode facts are malformed");
  }
  const carrier = Object.freeze({
    schema_version: WORKSPACE_AGENT_TERMINAL_RESULT_MODE_FACTS_SCHEMA_VERSION,
    selected_contract: facts.selectedContract
  });
  const attached = { ...result };
  Object.defineProperty(attached, LAUNCHER_OBSERVED_TERMINAL_RESULT_MODE_FACTS, {
    value: carrier,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return Object.freeze(attached);
}

export function readLauncherObservedTerminalResultModeFacts(result) {
  return result?.[LAUNCHER_OBSERVED_TERMINAL_RESULT_MODE_FACTS] ?? null;
}

export function readLauncherObservedTerminalResultMode(result) {
  return readLauncherObservedTerminalResultModeFacts(result)?.selected_contract ?? null;
}

const TERMINAL_REVIEW_ROLES = new Set(["reviewer", "redteam"]);

export function classifyWorkspaceAgentResultMode(facts = {}) {
  if (Object.hasOwn(facts, "terminalStructuredRoleResultMode")) {
    throw new TypeError("workspace-agent result-mode facts are malformed");
  }
  const {
    record,
    finalResult,
    structuredRoleResult,
    selectedContract = null,
    missingOutput: suppliedMissingOutput,
    confinementFailure: suppliedConfinementFailure
  } = facts;
  const hasMissingOutput = Object.hasOwn(facts, "missingOutput");
  const hasConfinementFailure = Object.hasOwn(facts, "confinementFailure");
  const missingOutput = hasMissingOutput ? suppliedMissingOutput : false;
  const confinementFailure = hasConfinementFailure ? suppliedConfinementFailure : false;
  if ((hasMissingOutput && typeof missingOutput !== "boolean") ||
      (hasConfinementFailure && typeof confinementFailure !== "boolean")) {
    throw new TypeError("workspace-agent result-mode facts are malformed");
  }
  if (!isSelectedResultContract(selectedContract)) {
    throw new TypeError("workspace-agent result-mode facts are malformed");
  }
  if (confinementFailure === true) {
    return completeResultModeEnvelope(
      WORKSPACE_AGENT_RESULT_MODES.CONFINEMENT_FAILURE,
      selectedContract,
      "launcher_confinement_failed"
    );
  }
  const cleanupOnlyStructuredReview = isCleanupOnlyReviewerVerdict(
    record,
    structuredRoleResult
  );
  if ((record?.status === "failed" && !cleanupOnlyStructuredReview) ||
      record?.status === "cancelled") {
    return completeResultModeEnvelope(
      WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE,
      selectedContract,
      finalResult?.missing_result?.reason ?? "terminal_run_failed"
    );
  }
  if (missingOutput === true || finalResult?.kind === "missing_result") {
    return completeResultModeEnvelope(
      WORKSPACE_AGENT_RESULT_MODES.MISSING_OUTPUT,
      selectedContract,
      finalResult?.missing_result?.reason ?? "terminal_output_missing"
    );
  }
  if (TERMINAL_REVIEW_ROLES.has(record?.role) &&
      record?.status === "succeeded" &&
      typeof finalResult?.full_response?.text === "string" &&
      finalResult.full_response.text.length > 0) {
    if (structuredRoleResult?.valid === true) {
      return completeResultModeEnvelope(
        WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT,
        selectedContract
      );
    }
    return completeResultModeEnvelope(
      WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE,
      selectedContract
    );
  }
  if (structuredRoleResult?.valid === true) {
    return completeResultModeEnvelope(
      WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT,
      selectedContract
    );
  }
  return completeResultModeEnvelope(
    WORKSPACE_AGENT_RESULT_MODES.CONFIGURED_STRUCTURE_INVALID,
    selectedContract,
    "configured_structured_result_unavailable_or_invalid"
  );
}

export function classifyExactSliceReviewReceiptResultMode(receipt) {
  const explicit = receipt?.result_mode;
  if (explicit !== undefined && explicit !== null) {
    if (typeof explicit === "string" && RESULT_MODE_VALUES.has(explicit)) return explicit;
    validateWorkspaceAgentResultModeEnvelope(explicit);
    return explicit.mode;
  }
  if (receipt?.structured_outcome !== null && receipt?.structured_outcome !== undefined) {
    return WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT;
  }
  if (receipt?.terminal_run_status === "succeeded") {
    return WORKSPACE_AGENT_RESULT_MODES.LEGACY_COMPLETION;
  }
  if (receipt?.verdict_evidence === "no_verdict_launch_failed") {
    return WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE;
  }
  if (receipt?.terminal_run_status === "failed" || receipt?.terminal_run_status === "cancelled") {
    return WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE;
  }
  return WORKSPACE_AGENT_RESULT_MODES.MISSING_OUTPUT;
}

export function buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope(receipt) {
  if (!isPlainObject(receipt) ||
      receipt.schema_version !== PRE_EXPLICIT_RECEIPT_SCHEMA_VERSION ||
      Object.hasOwn(receipt, "result_mode")) {
    throw new TypeError("legacy result-mode compatibility requires a pre-explicit receipt");
  }
  return completeResultModeEnvelope(
    classifyExactSliceReviewReceiptResultMode(receipt),
    null
  );
}

export function resultModeCompletesMechanicalReview(mode) {
  return mode === WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT ||
    mode === WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE ||
    mode === WORKSPACE_AGENT_RESULT_MODES.LEGACY_COMPLETION ||
    mode === WORKSPACE_AGENT_RESULT_MODES.CONFIGURED_STRUCTURE_INVALID ||
    mode === WORKSPACE_AGENT_RESULT_MODES.MISSING_OUTPUT ||
    mode === WORKSPACE_AGENT_RESULT_MODES.IDENTITY_UNRESOLVED;
}
