

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { isNonEmptyStringInternal } from "./codex-role-io.mjs";
import {
  buildSandboxBackendSelectionFromBwrapFacts,
  isWorkspaceAgentSandboxDecision
} from "./workspace-agent-sandbox-decision.mjs";
import {
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS,
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS,
  createWorkspaceAgentRunEnforcement,
  createWorkspaceAgentRunEnforcementForConfirmedSandbox,
  createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend,
  createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal,
  createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend,
  createWorkspaceAgentRunEnforcementFromSandboxDecision
} from "./workspace-agent-run-enforcement.mjs";

export const STRUCTURED_DISPATCH_PROVENANCE_SCHEMA_VERSION =
  "structured-dispatch-provenance.v1";

export const DISPATCH_TRANSCRIPT_SOURCES = Object.freeze([
  "child_process_stdout",
  "child_process_output_file",
  "runtime_artifact",
  "unavailable"
]);

export const DISPATCH_TRANSCRIPT_SOURCE_UNAVAILABLE = "unavailable";

export const DISPATCH_ARTIFACT_SENSITIVITY_CLASSES = Object.freeze([
  "routine",
  "sensitive"
]);

export const DISPATCH_ARTIFACT_REFERENCE_KEYS = Object.freeze([
  "kind",
  "path",
  "sha256",
  "byte_count",
  "media_type",
  "sensitivity",
  "exists"
]);

const DEFAULT_ARTIFACT_SENSITIVITY = "sensitive";
const REDACTED_TRANSPORT_SECRET = "[redacted-transport-secret]";
const LAUNCHER_OWNED_DISPATCH_ENFORCEMENT_SOURCE = Symbol(
  "launcher-owned-dispatch-enforcement-source"
);

export const DISPATCH_ENFORCEMENT_PROVENANCE_SCHEMA_VERSION =
  "structured-dispatch-enforcement-provenance.v1";

export const DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS = Object.freeze({
  ENFORCED_BACKEND: "enforced_backend",
  NO_PAID_KEY_UNENFORCED_FALLBACK: "no_paid_key_unenforced_fallback",
  PAID_KEY_OPERATOR_OPT_OUT_UNENFORCED:
    "paid_key_operator_opt_out_unenforced",
  PAID_KEY_ENFORCEMENT_REQUIRED_REFUSAL:
    "paid_key_enforcement_required_refusal",
  UNENFORCED_NO_BACKEND: "unenforced_no_backend",
  REFUSED: "refused"
});

export function normalizeDispatchTranscriptSource(value) {
  return DISPATCH_TRANSCRIPT_SOURCES.includes(value)
    ? value
    : DISPATCH_TRANSCRIPT_SOURCE_UNAVAILABLE;
}

function normalizeArtifactSensitivity(value) {
  return DISPATCH_ARTIFACT_SENSITIVITY_CLASSES.includes(value)
    ? value
    : DEFAULT_ARTIFACT_SENSITIVITY;
}

export function redactTransportSecrets(value, secrets = []) {
  if (!isNonEmptyStringInternal(value)) {
    return value;
  }
  let out = value;
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    if (isNonEmptyStringInternal(secret) && out.includes(secret)) {
      out = out.split(secret).join(REDACTED_TRANSPORT_SECRET);
    }
  }
  return out;
}

export async function readDispatchArtifactStats(absolutePath) {
  if (!isNonEmptyStringInternal(absolutePath)) {
    return null;
  }
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile()) {
      return { exists: false };
    }
    const bytes = await readFile(absolutePath);
    return {
      exists: true,
      byte_count: stats.size,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch {
    return { exists: false };
  }
}

export function whitelistDispatchArtifactReference(artifact, transportSecrets = []) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }
  const reference = {
    kind: isNonEmptyStringInternal(artifact.kind) ? artifact.kind : null,
    path: isNonEmptyStringInternal(artifact.path)
      ? redactTransportSecrets(artifact.path, transportSecrets)
      : null,
    exists: artifact.exists === true,
    media_type: isNonEmptyStringInternal(artifact.media_type)
      ? artifact.media_type
      : "text/plain",
    sensitivity: normalizeArtifactSensitivity(artifact.sensitivity)
  };
  if (Number.isFinite(artifact.byte_count)) {
    reference.byte_count = artifact.byte_count;
  }
  if (isNonEmptyStringInternal(artifact.sha256)) {
    reference.sha256 = artifact.sha256;
  }
  return reference;
}

export async function describeDispatchArtifactReference({
  kind,
  path,
  absolutePath,
  mediaType,
  sensitivity,
  transportSecrets = []
} = {}) {
  const recordedPath = redactTransportSecrets(
    isNonEmptyStringInternal(path) ? path : null,
    transportSecrets
  );
  const reference = {
    kind: isNonEmptyStringInternal(kind) ? kind : null,
    path: recordedPath,
    exists: false,
    media_type: isNonEmptyStringInternal(mediaType) ? mediaType : "text/plain",
    sensitivity: normalizeArtifactSensitivity(sensitivity)
  };
  const readPath = isNonEmptyStringInternal(absolutePath)
    ? absolutePath
    : isNonEmptyStringInternal(path)
      ? path
      : null;
  const fileStats = await readDispatchArtifactStats(readPath);
  if (fileStats && fileStats.exists) {
    reference.exists = true;
    reference.byte_count = fileStats.byte_count;
    reference.sha256 = fileStats.sha256;
  }
  return whitelistDispatchArtifactReference(reference, transportSecrets);
}

export function buildStructuredDispatchProvenance({
  runId,
  monitorHandle,
  subject,
  role,
  app,
  transcriptSource,
  enforcement,
  artifacts = [],
  redactions,
  transportSecrets = []
} = {}) {
  const normalizedEnforcement = normalizeDispatchProvenanceEnforcement(enforcement);
  const provenance = {
    schema_version: STRUCTURED_DISPATCH_PROVENANCE_SCHEMA_VERSION,
    run_id: isNonEmptyStringInternal(runId) ? runId : null,
    monitor_handle: isNonEmptyStringInternal(monitorHandle) ? monitorHandle : null,
    subject: isNonEmptyStringInternal(subject) ? subject : null,
    role: isNonEmptyStringInternal(role) ? role : null,
    app: isNonEmptyStringInternal(app) ? app : null,
    transcript_source: normalizeDispatchTranscriptSource(transcriptSource),
    enforcement: normalizedEnforcement,
    enforcement_provenance: normalizeDispatchEnforcementProvenance(
      enforcement,
      normalizedEnforcement,
      transportSecrets
    ),
    artifacts: Array.isArray(artifacts)
      ? artifacts
          .map((artifact) =>
            whitelistDispatchArtifactReference(artifact, transportSecrets)
          )
          .filter(Boolean)
      : []
  };
  if (redactions && typeof redactions === "object") {
    provenance.redactions = redactDiagnosticObject(redactions, transportSecrets);
  }
  return provenance;
}

export function normalizeDispatchProvenanceEnforcement(enforcement) {
  const source =
    enforcement && typeof enforcement === "object" && !Array.isArray(enforcement)
      ? enforcement
      : undefined;
  if (isLauncherObservedDispatchEnforcementSource(source)) {
    return createTrustedDispatchSourceEnforcement(source);
  }

  return createWorkspaceAgentRunEnforcement(
    source
      ? {
          command_surface: source.command_surface,
          reason: source.reason
        }
      : undefined
  );
}

function createTrustedDispatchSourceEnforcement(source) {
  if (
    source.enforced === true
    && source.isolation_backend !== WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
  ) {
    return createWorkspaceAgentRunEnforcementForConfirmedSandbox({
      isolation_backend: source.isolation_backend,
      command_surface: source.command_surface,
      launcherObservedConfirmation: {
        confirmedIsolatedSpawn: true,
        command_surface: source.command_surface
      }
    });
  }
  return createTrustedPaidPostureFactoryEnforcement(source.reason);
}

export function createDispatchProvenanceEnforcementFromSandboxDecision(
  sandboxDecision,
  { launcherObservedConfirmation = null } = {}
) {
  if (!isSandboxDecisionForDispatchProvenance(sandboxDecision)) {
    return null;
  }
  const runEnforcement = createWorkspaceAgentRunEnforcementFromSandboxDecision(
    sandboxDecision,
    { launcherObservedConfirmation }
  );
  return Object.freeze({
    [LAUNCHER_OWNED_DISPATCH_ENFORCEMENT_SOURCE]: true,
    observed_by: "launcher",
    authority: "launcher_owned",
    confirmedIsolatedSpawn: runEnforcement.enforced === true,
    enforced: runEnforcement.enforced,
    isolation_backend: runEnforcement.isolation_backend,
    command_surface: runEnforcement.command_surface,
    reason: runEnforcement.reason,
    enforcement_posture: sandboxDecisionEnforcementPosture(sandboxDecision),
    backend_availability: sandboxDecisionBackendAvailability(sandboxDecision),
    refusal: sandboxDecision.refusal ?? null
  });
}

export const LAUNCHER_OBSERVED_CONFIRMED_ISOLATED_SPAWN_SOURCE =
  "launcher_observed_confirmed_isolated_spawn";

export function createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn({
  isolationBackend = WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
  commandSurface = null
} = {}) {
  const runEnforcement = createWorkspaceAgentRunEnforcementForConfirmedSandbox({
    isolation_backend: isolationBackend,
    command_surface: commandSurface,
    launcherObservedConfirmation: {
      confirmedIsolatedSpawn: true,
      command_surface: commandSurface
    }
  });
  if (
    runEnforcement.enforced !== true
    || runEnforcement.isolation_backend === WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
  ) {
    return null;
  }
  return Object.freeze({
    [LAUNCHER_OWNED_DISPATCH_ENFORCEMENT_SOURCE]: true,
    observed_by: "launcher",
    authority: "launcher_owned",
    confirmedIsolatedSpawn: true,
    enforced: runEnforcement.enforced,
    isolation_backend: runEnforcement.isolation_backend,
    command_surface: runEnforcement.command_surface,
    reason: runEnforcement.reason,

    enforcement_posture: null,
    backend_availability: confirmedIsolatedSpawnBackendAvailability(
      runEnforcement.isolation_backend
    ),
    refusal: null
  });
}

function confirmedIsolatedSpawnBackendAvailability(isolationBackend) {
  if (isolationBackend !== WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP) {
    return null;
  }
  const backendSelection = buildSandboxBackendSelectionFromBwrapFacts({
    availability: { available: true },
    source: LAUNCHER_OBSERVED_CONFIRMED_ISOLATED_SPAWN_SOURCE
  });
  return Object.freeze({
    state: backendSelection.state,
    backend: backendSelection.backend_id,
    reason: backendSelection.reason,
    source: backendSelection.source,
    diagnostic: backendSelection.diagnostic
  });
}

function isSandboxDecisionForDispatchProvenance(value) {
  return isWorkspaceAgentSandboxDecision(value);
}

function sandboxDecisionEnforcementPosture(sandboxDecision) {
  return sandboxDecision.warning?.enforcement_posture
    ?? sandboxDecision.provenance?.enforcement_posture
    ?? sandboxDecision.refusal?.detail?.enforcement_posture
    ?? null;
}

function sandboxDecisionBackendAvailability(sandboxDecision) {
  const backendSelection =
    sandboxDecision.warning?.backend_selection
    ?? sandboxDecision.provenance?.backend_selection
    ?? sandboxDecision.refusal?.detail?.backend_selection
    ?? null;
  if (!backendSelection || typeof backendSelection !== "object") {
    return null;
  }
  return Object.freeze({
    state: backendSelection.state ?? null,
    backend: backendSelection.backend_id ?? backendSelection.backend ?? null,
    reason: backendSelection.reason ?? null,
    source: backendSelection.source ?? null,
    diagnostic: backendSelection.diagnostic ?? null
  });
}

function createTrustedPaidPostureFactoryEnforcement(reason) {
  if (reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND) {
    return createWorkspaceAgentRunEnforcementForNoPaidKeyNoBackend();
  }
  if (
    reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND
  ) {
    return createWorkspaceAgentRunEnforcementForPaidKeyOperatorOptOutNoBackend();
  }
  if (
    reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
  ) {
    return createWorkspaceAgentRunEnforcementForPaidKeyEnforcementRequiredRefusal();
  }
  return createWorkspaceAgentRunEnforcement();
}

function isLauncherObservedDispatchEnforcementSource(source) {
  return (
    source
    && typeof source === "object"
    && !Array.isArray(source)
    && source[LAUNCHER_OWNED_DISPATCH_ENFORCEMENT_SOURCE] === true
    && source.observed_by === "launcher"
    && source.authority === "launcher_owned"
  );
}

function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeNullableString(value) {
  return isNonEmptyStringInternal(value) ? value : null;
}

function clonePlainObject(value, transportSecrets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.freeze(redactDiagnosticObject(value, transportSecrets));
}

function normalizeOptOutFacts(value, transportSecrets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.freeze({
    enabled: value.enabled === true,
    env_key: normalizeNullableString(value.env_key),
    source: normalizeNullableString(value.source),
    detail: clonePlainObject(value.detail, transportSecrets)
  });
}

function normalizeEnforcementPostureFacts(value, transportSecrets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.freeze({
    enforcement_required: normalizeBoolean(value.enforcement_required),
    reason_code: normalizeNullableString(value.reason_code),
    reason: normalizeNullableString(value.reason),
    paid_node_engine_key_present:
      normalizeBoolean(value.paid_node_engine_key_present),
    paid_node_engine_key_source:
      normalizeNullableString(value.paid_node_engine_key_source),
    paid_node_engine_key_preferred:
      normalizeBoolean(value.paid_node_engine_key_preferred),
    opt_out: normalizeOptOutFacts(value.opt_out, transportSecrets)
  });
}

function normalizeBackendAvailabilityFacts(value, transportSecrets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.freeze({
    state: normalizeNullableString(value.state),
    backend: normalizeNullableString(value.backend),
    reason: normalizeNullableString(value.reason),
    source: normalizeNullableString(value.source),
    diagnostic: clonePlainObject(value.diagnostic, transportSecrets)
  });
}

function normalizeRefusalFacts(value, transportSecrets) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.freeze({
    reason: normalizeNullableString(value.reason),
    detail: clonePlainObject(value.detail, transportSecrets)
  });
}

function resolveDispatchEnforcementDisposition(enforcement) {
  if (
    enforcement.enforced === true
    && enforcement.isolation_backend !== WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
  ) {
    return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.ENFORCED_BACKEND;
  }
  if (
    enforcement.reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND
  ) {
    return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.NO_PAID_KEY_UNENFORCED_FALLBACK;
  }
  if (
    enforcement.reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND
  ) {
    return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.PAID_KEY_OPERATOR_OPT_OUT_UNENFORCED;
  }
  if (
    enforcement.reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
  ) {
    return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSAL;
  }
  if (
    enforcement.enforced === false
    && enforcement.isolation_backend === WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
    && enforcement.reason
      === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.OPERATOR_OPT_IN_NO_BACKEND
  ) {
    return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.UNENFORCED_NO_BACKEND;
  }
  return DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.REFUSED;
}

export function normalizeDispatchEnforcementProvenance(
  enforcement,
  normalizedEnforcement = normalizeDispatchProvenanceEnforcement(enforcement),
  transportSecrets = []
) {
  const source =
    enforcement && typeof enforcement === "object" && !Array.isArray(enforcement)
      ? enforcement
      : {};
  const sourceTrusted = isLauncherObservedDispatchEnforcementSource(source);
  const sourceFacts = sourceTrusted
    ? source
    : {};
  const dispositionEnforcement = sourceTrusted
    ? normalizedEnforcement
    : normalizeDispatchProvenanceEnforcement(enforcement);
  const posture = normalizeEnforcementPostureFacts(
    sourceFacts.enforcement_posture,
    transportSecrets
  );
  const backendAvailability = normalizeBackendAvailabilityFacts(
    sourceFacts.backend_availability,
    transportSecrets
  );
  const refusal = normalizeRefusalFacts(sourceFacts.refusal, transportSecrets);
  return Object.freeze({
    schema_version: DISPATCH_ENFORCEMENT_PROVENANCE_SCHEMA_VERSION,

    authority: sourceTrusted ? "launcher_owned" : null,
    disposition: resolveDispatchEnforcementDisposition(dispositionEnforcement),
    enforcement_posture: posture,
    backend_availability: backendAvailability,
    refusal
  });
}

function redactDiagnosticObject(value, transportSecrets) {
  if (isNonEmptyStringInternal(value)) {
    return redactTransportSecrets(value, transportSecrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticObject(entry, transportSecrets));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactDiagnosticObject(entry, transportSecrets);
    }
    return out;
  }
  return value;
}
