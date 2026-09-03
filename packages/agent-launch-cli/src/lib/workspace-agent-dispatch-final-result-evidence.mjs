

import { normalizeFinalResult } from "@agent-chassis/agent-launch-core";
import {
  STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
  parseAgentRoleResult
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";

import {
  DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS,
  DISPATCH_ENFORCEMENT_PROVENANCE_SCHEMA_VERSION,
  STRUCTURED_DISPATCH_PROVENANCE_SCHEMA_VERSION,
  buildStructuredDispatchProvenance,
  whitelistDispatchArtifactReference
} from "./workspace-agent-dispatch-provenance.mjs";
import {
  WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS,
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS
} from "./workspace-agent-run-enforcement.mjs";
import {
  classifyWorkspaceAgentResultMode,
  WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS
} from "./workspace-agent-dispatch-result-mode.mjs";
export {
  WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS,
  WORKSPACE_AGENT_RESULT_MODE_SCHEMA_VERSION,
  WORKSPACE_AGENT_RESULT_MODES,
  WORKSPACE_AGENT_TERMINAL_RESULT_MODE_FACTS_SCHEMA_VERSION,
  attachLauncherObservedTerminalResultModeFacts,
  classifyExactSliceReviewReceiptResultMode,
  classifyWorkspaceAgentResultMode,
  readLauncherObservedTerminalResultMode,
  readLauncherObservedTerminalResultModeFacts,
  resultModeCompletesMechanicalReview
} from "./workspace-agent-dispatch-result-mode.mjs";

function buildStructuredRoleResultDiagnostic(code, message, path = null, detail = null) {
  const diagnostic = { code, message };
  if (path !== null) diagnostic.path = path;
  if (detail !== null) diagnostic.detail = detail;
  return Object.freeze(diagnostic);
}

function buildInvalidStructuredRoleResultEvidence(diagnostics, claims = null) {
  return Object.freeze({
    schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
    valid: false,
    result: null,
    claims,
    diagnostics: Object.freeze(diagnostics),
    candidate: null,
    authority: "child_evidence_only"
  });
}

function invalidateStructuredRoleResultEvidence(evidence, diagnostics) {
  return Object.freeze({
    schema_version: STRUCTURED_ROLE_RESULT_EVIDENCE_SCHEMA_VERSION,
    valid: false,
    result: null,
    claims: evidence?.claims ?? null,
    diagnostics: Object.freeze([
      ...(Array.isArray(evidence?.diagnostics) ? evidence.diagnostics : []),
      ...diagnostics
    ]),
    candidate: evidence?.candidate ?? null,
    authority: "child_evidence_only"
  });
}

function buildStructuredRoleResultEvidence(finalResult, record) {
  const finalResponseText = finalResult?.full_response?.text;
  if (typeof finalResponseText !== "string" || finalResponseText.length === 0) {
    return buildInvalidStructuredRoleResultEvidence([
      buildStructuredRoleResultDiagnostic(
        "full_response_text_unavailable",
        "workspace-agent-dispatch-final-result.v1.full_response.text is unavailable for structured role-result validation"
      )
    ]);
  }

  const parsed = parseAgentRoleResult(finalResponseText);
  if (!parsed?.valid) return parsed;

  const diagnostics = [];
  if (parsed.claims?.reported_role !== record.role) {
    diagnostics.push(buildStructuredRoleResultDiagnostic(
      "reported_role_mismatch",
      "child reported_role does not match trusted backend role",
      "$.reported_role",
      {
        expected: record.role,
        actual: parsed.claims?.reported_role ?? null
      }
    ));
  }
  if (parsed.claims?.reported_subject !== record.subject) {
    diagnostics.push(buildStructuredRoleResultDiagnostic(
      "reported_subject_mismatch",
      "child reported_subject does not match trusted backend subject",
      "$.reported_subject",
      {
        expected: record.subject,
        actual: parsed.claims?.reported_subject ?? null
      }
    ));
  }
  if (diagnostics.length > 0) {
    return invalidateStructuredRoleResultEvidence(parsed, diagnostics);
  }

  return parsed;
}

export const ADVISORY_REVIEW_COORDINATOR_GUIDANCE =
  "The review output is usable advisory evidence. Read and disposition the reviewer's actual response normally; schema diagnostics affect only optional metadata derived in this result.";
export const ABSENT_ADVISORY_REVIEW_COORDINATOR_GUIDANCE =
  "No reviewer text was captured. This content absence affects only the current review action and carries no lifecycle authority.";

function projectAdvisoryReviewResult(finalResult, structuredRoleResult, record) {
  if (record?.role !== "reviewer" && record?.role !== "redteam") return null;
  const text = typeof finalResult?.full_response?.text === "string" &&
      finalResult.full_response.text.length > 0
    ? finalResult.full_response.text
    : null;
  const schemaAdherent = structuredRoleResult?.valid === true;
  const formalRequested = record?.terminal_structured_role_result_mode ===
    WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS.SCHEMA_CONSTRAINED;
  const executionStatus = record?.status === "succeeded"
    ? "completed"
    : typeof record?.status === "string" && record.status.length > 0
      ? record.status
      : "unknown";
  return Object.freeze({
    kind: "advisory_review",
    execution_status: executionStatus,
    advisory_output: Object.freeze({
      available: text !== null,
      usable: text !== null,
      ...(text === null ? {} : { text })
    }),
    schema_observation: Object.freeze({
      adherent: schemaAdherent,
      diagnostics: Object.freeze(
        Array.isArray(structuredRoleResult?.diagnostics)
          ? structuredRoleResult.diagnostics.slice(0, 20)
          : []
      )
    }),
    formal_attestation: Object.freeze({
      requested: formalRequested,
      available: false,
      reason: formalRequested
        ? schemaAdherent
          ? "settlement_pending"
          : "schema_non_adherent"
        : "not_requested"
    }),
    coordinator_guidance: text === null
      ? ABSENT_ADVISORY_REVIEW_COORDINATOR_GUIDANCE
      : ADVISORY_REVIEW_COORDINATOR_GUIDANCE,
    automatic_lifecycle_posture: Object.freeze({
      authority: "advisory_only",
      changes_status: false,
      grants_lifecycle_authority: false,
      vetoes_lifecycle_action: false,
      requires_retry_or_replacement: false,
      creates_recovery_state: false
    })
  });
}

export function attachFormalReviewAttestationSettlement(finalResult, settlement) {
  if (finalResult?.advisory_review?.formal_attestation?.requested !== true) {
    return finalResult;
  }
  const formalAttestation = settlement && typeof settlement === "object" &&
      !Array.isArray(settlement)
    ? Object.freeze({ requested: true, ...settlement })
    : Object.freeze({
        requested: true,
        available: false,
        reason: "settlement_unavailable"
      });
  return Object.freeze({
    ...finalResult,
    advisory_review: Object.freeze({
      ...finalResult.advisory_review,
      formal_attestation: formalAttestation
    })
  });
}

export function normalizeFinalResultWithStructuredRoleResult(rawFinalResult, record) {
  const normalized = normalizeFinalResult(rawFinalResult);
  if (!normalized) return null;
  const structuredRoleResult = buildStructuredRoleResultEvidence(normalized, record);
  const withStructuredResult = normalizeFinalResult({
    ...(rawFinalResult && typeof rawFinalResult === "object" ? rawFinalResult : normalized),
    structured_role_result: structuredRoleResult
  });
  const advisoryReview = projectAdvisoryReviewResult(
    withStructuredResult,
    structuredRoleResult,
    record
  );
  return Object.freeze({
    ...withStructuredResult,
    result_mode: classifyWorkspaceAgentResultMode({
      record,
      finalResult: withStructuredResult,
      structuredRoleResult,
      selectedContract: record?.terminal_structured_role_result_mode ?? null
    }),
    ...(advisoryReview === null ? {} : { advisory_review: advisoryReview })
  });
}

export function buildMissingResultEnvelopeWithStructuredRoleResult(code, reason, detail, record = null) {
  const normalized = normalizeFinalResult({
    kind: "missing_result",
    missing_result: {
      code,
      reason: reason ?? null,
      detail: detail ?? null
    },
    structured_role_result: buildInvalidStructuredRoleResultEvidence([
      buildStructuredRoleResultDiagnostic(
        "full_response_text_unavailable",
        "workspace-agent-dispatch-final-result.v1.full_response.text is unavailable for structured role-result validation"
      )
    ])
  });
  const advisoryReview = projectAdvisoryReviewResult(
    normalized,
    normalized?.structured_role_result,
    record
  );
  return Object.freeze({
    ...normalized,
    result_mode: classifyWorkspaceAgentResultMode({
      record,
      finalResult: normalized,
      structuredRoleResult: normalized?.structured_role_result,
      missingOutput: true,
      selectedContract: record?.terminal_structured_role_result_mode ?? null
    }),
    ...(advisoryReview === null ? {} : { advisory_review: advisoryReview })
  });
}

function isTrustedRehomableDispatchEnforcement(enforcement, enforcementProvenance) {
  if (!enforcement || typeof enforcement !== "object" || Array.isArray(enforcement)) {
    return false;
  }
  if (
    !enforcementProvenance
    || typeof enforcementProvenance !== "object"
    || Array.isArray(enforcementProvenance)
  ) {
    return false;
  }
  if (
    enforcementProvenance.schema_version
      !== DISPATCH_ENFORCEMENT_PROVENANCE_SCHEMA_VERSION
    || enforcementProvenance.authority !== "launcher_owned"
  ) {
    return false;
  }
  if (
    enforcement.enforced === true
    && enforcement.isolation_backend !== WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
    && enforcement.reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.SANDBOXED
  ) {
    return (
      enforcementProvenance.disposition
        === DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.ENFORCED_BACKEND
    );
  }
  if (
    enforcement.enforced !== false
    || enforcement.isolation_backend !== WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE
  ) {
    return false;
  }
  return (
    (
      enforcement.reason === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.NO_PAID_KEY_NO_BACKEND
      && enforcementProvenance.disposition
        === DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.NO_PAID_KEY_UNENFORCED_FALLBACK
    )
    || (
      enforcement.reason
        === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_OPERATOR_OPT_OUT_NO_BACKEND
      && enforcementProvenance.disposition
        === DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.PAID_KEY_OPERATOR_OPT_OUT_UNENFORCED
    )
    || (
      enforcement.reason
        === WORKSPACE_AGENT_RUN_ENFORCEMENT_REASONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSED
      && enforcementProvenance.disposition
        === DISPATCH_ENFORCEMENT_PROVENANCE_DISPOSITIONS.PAID_KEY_ENFORCEMENT_REQUIRED_REFUSAL
    )
  );
}

function trustedRehomedDispatchEnforcement(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  if (
    isTrustedRehomableDispatchEnforcement(
      candidate.enforcement,
      candidate.enforcement_provenance
    )
  ) {
    return Object.freeze({
      enforced: candidate.enforcement.enforced,
      isolation_backend: candidate.enforcement.isolation_backend,
      command_surface: candidate.enforcement.command_surface ?? null,
      reason: candidate.enforcement.reason
    });
  }
  return null;
}

export function attachDispatchProvenance(envelope, rawFinalResult, identity) {
  if (!envelope || typeof envelope !== "object") return envelope;
  const candidate = rawFinalResult?.provenance;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return envelope;
  }
  if (candidate.schema_version !== STRUCTURED_DISPATCH_PROVENANCE_SCHEMA_VERSION) {
    return envelope;
  }

  const safeArtifacts = (Array.isArray(candidate.artifacts) ? candidate.artifacts : [])
    .map((artifact) => whitelistDispatchArtifactReference(artifact, []))
    .filter(Boolean);
  const provenance = buildStructuredDispatchProvenance({
    runId: identity?.run_id ?? null,
    monitorHandle: identity?.monitor_handle ?? null,
    subject: identity?.subject ?? null,
    role: identity?.role ?? null,
    app: identity?.app ?? null,
    transcriptSource: candidate.transcript_source,
    enforcement: candidate.enforcement,
    artifacts: safeArtifacts,
    redactions: candidate.redactions
  });
  const trustedEnforcement = trustedRehomedDispatchEnforcement(candidate);
  if (trustedEnforcement) {
    return Object.freeze({
      ...envelope,
      provenance: Object.freeze({
        ...provenance,
        enforcement: trustedEnforcement,
        enforcement_provenance: candidate.enforcement_provenance
      })
    });
  }
  return Object.freeze({ ...envelope, provenance });
}
