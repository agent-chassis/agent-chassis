

import {
  clone,
  isFiniteNumber,
  isNonEmptyString,
  isObject,
  parseIsoTimestamp
} from "./work-record-dispatch-shared.mjs";
import { summarizeDependencyEvidenceProvenance } from "./work-record-dispatch-dependencies.mjs";

export const PREPARATION_AUDIT_ENVELOPE_CONTRACT = "preparation_audit_envelope.v1";
export const LOCAL_PREFLIGHT_NON_CLAIM_CONTRACT = "local_preflight_non_claim.v1";
const LOCAL_PREFLIGHT_NON_CLAIM_SEMANTICS =
  "Consumer preparation only; does not claim Node Engine validation, verdict, lifecycle, parity, or enforcement.";
const DEFAULT_PREPARATION_AUDIT_ACTOR = Object.freeze({
  kind: "tool",
  id: "agent-chassis:work-record-dispatch"
});

function normalizeAuditActor(actor) {
  if (!isObject(actor)) {
    return null;
  }
  const kind = isNonEmptyString(actor.kind) ? actor.kind : null;
  const id = isNonEmptyString(actor.id) ? actor.id : null;
  if (!kind || !id) {
    return null;
  }
  return { kind, id };
}

function normalizeSourceDigests(digests) {
  if (!Array.isArray(digests)) {
    return [];
  }
  const normalized = [];
  for (const entry of digests) {
    if (!isObject(entry)) {
      continue;
    }
    const kind = isNonEmptyString(entry.kind) ? entry.kind : null;
    const ref = isNonEmptyString(entry.ref) ? entry.ref : null;
    const digest = isNonEmptyString(entry.digest) ? entry.digest : null;
    if (!kind || !ref || !digest) {
      continue;
    }
    normalized.push({ kind, ref, digest });
  }
  return normalized;
}

export function normalizePreparationAudit(audit, now) {
  const required = Boolean(audit && audit.required);
  const actor = normalizeAuditActor(audit?.actor);
  const sourceDigests = normalizeSourceDigests(audit?.source_digests);
  const hasEvaluatedAt = isNonEmptyString(audit?.evaluated_at);
  const evaluatedAt = hasEvaluatedAt ? audit.evaluated_at : null;
  const expiresAt = isNonEmptyString(audit?.expires_at) ? audit.expires_at : null;
  const maxAgeSeconds = isFiniteNumber(audit?.max_age_seconds) && audit.max_age_seconds >= 0
    ? audit.max_age_seconds
    : null;

  const completenessIssues = [];
  if (!actor) {
    completenessIssues.push("actor identity is missing or malformed");
  }
  if (sourceDigests.length === 0) {
    completenessIssues.push("source_digests is empty");
  }
  if (!hasEvaluatedAt) {
    completenessIssues.push("evaluated_at is missing");
  } else if (Number.isNaN(parseIsoTimestamp(evaluatedAt))) {
    completenessIssues.push("evaluated_at is not a parseable ISO timestamp");
  }

  let freshnessState = "fresh";
  const freshnessIssues = [];

  if (audit === null || audit === undefined) {
    freshnessState = "absent";
  } else if (completenessIssues.length > 0) {
    freshnessState = "incomplete";
  } else {
    const evaluatedMillis = parseIsoTimestamp(evaluatedAt);
    const nowMillis = parseIsoTimestamp(now);
    if (expiresAt !== null) {
      const expiresMillis = parseIsoTimestamp(expiresAt);
      if (Number.isNaN(expiresMillis)) {
        freshnessIssues.push("expires_at is not a parseable ISO timestamp");
        freshnessState = "stale";
      } else if (!Number.isNaN(nowMillis) && expiresMillis <= nowMillis) {
        freshnessIssues.push(`audit expired at ${expiresAt}`);
        freshnessState = "stale";
      }
    }
    if (
      maxAgeSeconds !== null &&
      !Number.isNaN(evaluatedMillis) &&
      !Number.isNaN(nowMillis) &&
      (nowMillis - evaluatedMillis) / 1000 > maxAgeSeconds
    ) {
      freshnessIssues.push(
        `audit exceeds max_age_seconds (${maxAgeSeconds}) since ${evaluatedAt}`
      );
      freshnessState = "stale";
    }
  }

  return {
    supplied: audit !== null && audit !== undefined,
    required,
    actor,
    source_digests: sourceDigests,
    evaluated_at: evaluatedAt,
    expires_at: expiresAt,
    max_age_seconds: maxAgeSeconds,
    freshness_state: freshnessState,
    freshness_issues: freshnessIssues,
    completeness_issues: completenessIssues
  };
}

export function buildPreparationAuditEnvelope({
  normalizedAudit,
  dependencyEvidence,
  auditRequired,
  now
}) {
  const provenanceSummary = summarizeDependencyEvidenceProvenance(dependencyEvidence);
  const effectiveActor = normalizedAudit.actor || { ...DEFAULT_PREPARATION_AUDIT_ACTOR };
  return {
    contract: PREPARATION_AUDIT_ENVELOPE_CONTRACT,
    pack_binding: "worker_admission_v1",
    operation_binding: "evaluate_work_unit_dispatch.v1",
    preparation: {
      actor: effectiveActor,
      actor_supplied: Boolean(normalizedAudit.actor),
      source_digests: clone(normalizedAudit.source_digests),
      evaluated_at: normalizedAudit.evaluated_at,
      expires_at: normalizedAudit.expires_at,
      max_age_seconds: normalizedAudit.max_age_seconds,
      freshness_state: normalizedAudit.freshness_state,
      freshness_issues: clone(normalizedAudit.freshness_issues || []),
      completeness_issues: clone(normalizedAudit.completeness_issues || []),
      audit_supplied: normalizedAudit.supplied,
      audit_required: Boolean(auditRequired || normalizedAudit.required),
      observed_at: now,
      dependency_evidence_provenance: provenanceSummary
    },
    non_claim: {
      contract: LOCAL_PREFLIGHT_NON_CLAIM_CONTRACT,
      semantics: LOCAL_PREFLIGHT_NON_CLAIM_SEMANTICS,
      portfolio_scope: "consumer_preparation",
      claims_node_engine_validation: false,
      claims_node_engine_verdict: false,
      claims_node_engine_lifecycle: false,
      claims_node_engine_parity: false,
      claims_node_engine_enforcement: false
    }
  };
}

export function buildPreparationAuditEvidenceEntry(envelope) {
  return {
    kind: "dispatch_readiness_preparation_audit",
    source_kind: "issue",
    canonicality: "derived",
    evidence_basis: "explicit_metadata",
    contract: envelope.contract,
    pack_binding: envelope.pack_binding,
    operation_binding: envelope.operation_binding,
    preparation: clone(envelope.preparation),
    non_claim: clone(envelope.non_claim)
  };
}

export function isPreparationAuditRequired(subject) {
  if (!isObject(subject) || !isObject(subject.dispatch_intent)) {
    return false;
  }
  return subject.dispatch_intent.requires_dependency_preparation_audit === true;
}

export function collectPreparationAuditBlockers(normalizedAudit, required) {
  if (!required) {
    return [];
  }

  if (!normalizedAudit.supplied) {
    return [
      {
        code: "blocked_dependency",
        reason:
          "dependency preparation audit envelope (preparation_audit_envelope.v1) is required but was not supplied"
      }
    ];
  }

  if (normalizedAudit.freshness_state === "incomplete") {
    return [
      {
        code: "blocked_dependency",
        reason: `dependency preparation audit envelope is incomplete: ${normalizedAudit.completeness_issues.join("; ")}`
      }
    ];
  }

  if (normalizedAudit.freshness_state === "stale") {
    const detail = normalizedAudit.freshness_issues.join("; ") || "audit evidence is stale";
    return [
      {
        code: "blocked_dependency",
        reason: `dependency preparation audit envelope is stale: ${detail}`
      }
    ];
  }

  return [];
}
