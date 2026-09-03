

import { createHash } from "node:crypto";

import {
  ATTEMPT_EVENT_KINDS,
  canonicalJson
} from "./managed-worker-attempt-journal.mjs";

export const MANAGED_WORKER_INTEGRATION_SETTLEMENT_SCHEMA_VERSION =
  "managed-worker-integration-settlement.v1";

export const INTEGRATION_PREFIXES = Object.freeze({
  NO_INTENT: "no_intent",
  INTENT_ONLY: "intent_only",
  GIT_EFFECT_RECORDED: "git_effect_recorded",
  STATUS_EFFECT_RECORDED: "status_effect_recorded",
  COMPLETED: "completed"
});

export const INTEGRATION_NEXT_ACTIONS = Object.freeze({
  NONE: "none",
  APPLY_GIT_CAS: "apply_git_cas",
  RECORD_GIT_EQUIVALENT_WINNER: "record_git_equivalent_winner",
  APPLY_STATUS_CAS: "apply_status_cas",
  RECORD_STATUS_EQUIVALENT: "record_status_equivalent",
  APPEND_COMPLETION: "append_completion",
  SETTLED: "settled"
});

export const INTEGRATION_INCOMPLETE = Object.freeze({
  GIT_CONFLICTING_WINNER: "integration.git_conflicting_winner.v1",
  GIT_EFFECT_UNREADABLE: "integration.git_effect_unreadable.v1",
  GIT_EFFECT_INDETERMINATE: "integration.git_effect_indeterminate.v1",
  STATUS_CONFLICTING_TRANSITION: "integration.status_conflicting_transition.v1",
  STATUS_EFFECT_UNREADABLE: "integration.status_effect_unreadable.v1",
  STATUS_EFFECT_INDETERMINATE: "integration.status_effect_indeterminate.v1",
  AUTHORITY_MOVED: "integration.authority_moved.v1",
  STALE_GENERATION: "integration.stale_generation.v1",
  STALE_WK_TIP: "integration.stale_wk_tip.v1",
  INTENT_EFFECT_IDENTITY_MISMATCH: "integration.intent_effect_identity_mismatch.v1",
  CORRECTIVE_ANCESTRY_UNPROVEN: "integration.corrective_ancestry_unproven.v1",
  INTENT_UNAUTHENTICATED: "integration.intent_unauthenticated.v1"
});

const INTENT_BINDING_KEYS = Object.freeze([
  "coordinator_action_id",
  "resolved_binding_digest",
  "delivery_commit",
  "delivery_tree",
  "slice_ref",
  "wk_ref",
  "expected_wk_tip",
  "expected_slice_tip",
  "canonical_record_digest",
  "status_target",
  "contract_generation",
  "predecessor_completion_digest"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function isValidIntentBinding(binding) {
  if (!hasExactKeys(binding, INTENT_BINDING_KEYS)) return false;
  for (const key of [
    "coordinator_action_id", "resolved_binding_digest", "delivery_commit",
    "delivery_tree", "slice_ref", "wk_ref", "expected_wk_tip",
    "canonical_record_digest", "status_target", "contract_generation"
  ]) {
    if (!isNonEmptyString(binding[key])) return false;
  }

  if (binding.predecessor_completion_digest !== null &&
      !isNonEmptyString(binding.predecessor_completion_digest)) return false;
  if (binding.expected_slice_tip !== null && !isNonEmptyString(binding.expected_slice_tip)) return false;
  return true;
}

export function integrationBindingDigest(binding) {
  return `sha256:${createHash("sha256").update(canonicalJson(binding)).digest("hex")}`;
}

export function partitionIntegrationHops(integrationEvents) {
  const hops = [];
  let current = [];
  for (const event of integrationEvents) {
    current.push(event);
    if (event.kind === ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED) {
      hops.push(current);
      current = [];
    }
  }
  if (current.length > 0) hops.push(current);
  return hops;
}

function classifyHop(hop) {
  const kinds = new Set(hop.map((event) => event.kind));
  if (kinds.has(ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED)) return INTEGRATION_PREFIXES.COMPLETED;
  if (kinds.has(ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT)) return INTEGRATION_PREFIXES.STATUS_EFFECT_RECORDED;
  if (kinds.has(ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT)) return INTEGRATION_PREFIXES.GIT_EFFECT_RECORDED;
  if (kinds.has(ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT)) return INTEGRATION_PREFIXES.INTENT_ONLY;
  return INTEGRATION_PREFIXES.NO_INTENT;
}

function eventOfKind(hop, kind) {
  for (let index = hop.length - 1; index >= 0; index -= 1) {
    if (hop[index].kind === kind) return hop[index];
  }
  return null;
}

function incomplete(code, reason, detail = null) {
  return Object.freeze({
    schema_version: MANAGED_WORKER_INTEGRATION_SETTLEMENT_SCHEMA_VERSION,
    settled: false,
    incomplete: Object.freeze({ code, reason, detail: detail === null ? null : Object.freeze({ ...detail }) }),
    next_action: Object.freeze({ kind: INTEGRATION_NEXT_ACTIONS.NONE, detail: null })
  });
}

function action(prefix, kind, detail = null) {
  return Object.freeze({
    schema_version: MANAGED_WORKER_INTEGRATION_SETTLEMENT_SCHEMA_VERSION,
    settled: kind === INTEGRATION_NEXT_ACTIONS.SETTLED,
    prefix,
    incomplete: null,
    next_action: Object.freeze({ kind, detail: detail === null ? null : Object.freeze({ ...detail }) })
  });
}

export function reduceIntegrationSettlement({
  integrationEvents = [],
  observations = {},
  currentGenerationDigest = null,
  currentWkTip = null
} = {}) {
  const hops = partitionIntegrationHops(integrationEvents);
  if (hops.length === 0) {
    return action(INTEGRATION_PREFIXES.NO_INTENT, INTEGRATION_NEXT_ACTIONS.NONE);
  }
  const hop = hops[hops.length - 1];
  const prefix = classifyHop(hop);

  if (prefix === INTEGRATION_PREFIXES.NO_INTENT) {
    return action(INTEGRATION_PREFIXES.NO_INTENT, INTEGRATION_NEXT_ACTIONS.NONE);
  }

  const intent = eventOfKind(hop, ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT);
  if (intent === null) {

    return incomplete(INTEGRATION_INCOMPLETE.INTENT_EFFECT_IDENTITY_MISMATCH,
      "an integration effect exists with no durable intent for this hop");
  }
  const binding = intent.payload?.binding ?? null;
  if (!isValidIntentBinding(binding)) {
    return incomplete(INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
      "the integration intent does not carry a complete server-resolved binding");
  }

  if (!isNonEmptyString(intent.payload?.coordinator_action_id) ||
      intent.payload.coordinator_action_id !== binding.coordinator_action_id ||
      binding.resolved_binding_digest !== integrationBindingDigest({
        ...binding, resolved_binding_digest: null
      })) {
    return incomplete(INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
      "the integration intent is not bound to an authenticated coordinator action and server-resolved binding digest");
  }

  if (currentGenerationDigest !== null && intent.generation_digest !== currentGenerationDigest) {
    return incomplete(INTEGRATION_INCOMPLETE.STALE_GENERATION,
      "the integration intent's frozen generation is no longer current",
      { frozen: intent.generation_digest, current: currentGenerationDigest });
  }
  if (currentWkTip !== null && intent.wk_tip !== currentWkTip) {
    return incomplete(INTEGRATION_INCOMPLETE.STALE_WK_TIP,
      "the integration intent's frozen WK tip is no longer current",
      { frozen: intent.wk_tip, current: currentWkTip });
  }

  if (hops.length > 1) {
    const predecessor = hops[hops.length - 2];
    const completion = eventOfKind(predecessor, ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED);
    if (completion === null || binding.predecessor_completion_digest !== completion.digest) {
      return incomplete(INTEGRATION_INCOMPLETE.CORRECTIVE_ANCESTRY_UNPROVEN,
        "the corrective hop does not bind the exact prior completion digest",
        { bound: binding.predecessor_completion_digest, expected: completion === null ? null : completion.digest });
    }

    if (observations.git?.delivery_ancestor_of_tip === false) {
      return incomplete(INTEGRATION_INCOMPLETE.CORRECTIVE_ANCESTRY_UNPROVEN,
        "Git ancestry does not prove the corrective delivery descends from the integrated tip");
    }
  }

  const git = observations.git ?? null;
  const record = observations.record ?? null;

  switch (prefix) {
    case INTEGRATION_PREFIXES.INTENT_ONLY: {
      if (git === null || git.readable === false) {
        return incomplete(INTEGRATION_INCOMPLETE.GIT_EFFECT_UNREADABLE,
          "the Git tip for the slice ref could not be authenticated");
      }

      if (git.tip === binding.expected_slice_tip || git.tip === binding.expected_wk_tip) {
        return action(prefix, INTEGRATION_NEXT_ACTIONS.APPLY_GIT_CAS, {
          slice_ref: binding.slice_ref,
          expected: git.tip,
          delivery_commit: binding.delivery_commit
        });
      }

      if (git.tip === binding.delivery_commit) {
        return action(prefix, INTEGRATION_NEXT_ACTIONS.RECORD_GIT_EQUIVALENT_WINNER, {
          slice_ref: binding.slice_ref,
          observed_tip: git.tip
        });
      }
      return incomplete(INTEGRATION_INCOMPLETE.GIT_CONFLICTING_WINNER,
        "the slice ref moved to a tip that is neither the expected pre-integration tip nor this delivery",
        { observed_tip: git.tip, delivery_commit: binding.delivery_commit });
    }

    case INTEGRATION_PREFIXES.GIT_EFFECT_RECORDED: {
      const gitEffect = eventOfKind(hop, ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT);
      if (gitEffect.payload?.resulting_tip !== binding.delivery_commit) {
        return incomplete(INTEGRATION_INCOMPLETE.INTENT_EFFECT_IDENTITY_MISMATCH,
          "the recorded Git effect does not name this intent's delivery commit");
      }
      if (record === null || record.readable === false) {
        return incomplete(INTEGRATION_INCOMPLETE.STATUS_EFFECT_UNREADABLE,
          "the canonical record could not be authenticated");
      }
      if (record.digest === binding.canonical_record_digest) {
        return action(prefix, INTEGRATION_NEXT_ACTIONS.APPLY_STATUS_CAS, {
          expected_digest: record.digest,
          status_target: binding.status_target
        });
      }

      if (record.status === binding.status_target) {
        return action(prefix, INTEGRATION_NEXT_ACTIONS.RECORD_STATUS_EQUIVALENT, {
          observed_digest: record.digest,
          status_target: binding.status_target
        });
      }
      return incomplete(INTEGRATION_INCOMPLETE.STATUS_CONFLICTING_TRANSITION,
        "the canonical record moved to a state that is neither the expected digest nor the intended status",
        { observed_digest: record.digest, observed_status: record.status, status_target: binding.status_target });
    }

    case INTEGRATION_PREFIXES.STATUS_EFFECT_RECORDED: {
      const gitEffect = eventOfKind(hop, ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT);
      const statusEffect = eventOfKind(hop, ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT);
      if (gitEffect === null) {
        return incomplete(INTEGRATION_INCOMPLETE.INTENT_EFFECT_IDENTITY_MISMATCH,
          "a status effect exists with no recorded Git effect for this hop");
      }

      if (git === null || git.readable === false) {
        return incomplete(INTEGRATION_INCOMPLETE.GIT_EFFECT_INDETERMINATE,
          "the Git effect could not be re-authenticated before completion");
      }
      if (git.tip !== gitEffect.payload.resulting_tip) {
        return incomplete(INTEGRATION_INCOMPLETE.AUTHORITY_MOVED,
          "the slice ref moved away from the recorded Git effect before completion",
          { recorded: gitEffect.payload.resulting_tip, observed: git.tip });
      }
      if (record === null || record.readable === false) {
        return incomplete(INTEGRATION_INCOMPLETE.STATUS_EFFECT_INDETERMINATE,
          "the canonical status effect could not be re-authenticated before completion");
      }
      if (record.digest !== statusEffect.payload.resulting_digest) {
        return incomplete(INTEGRATION_INCOMPLETE.AUTHORITY_MOVED,
          "the canonical record moved away from the recorded status effect before completion",
          { recorded: statusEffect.payload.resulting_digest, observed: record.digest });
      }
      return action(prefix, INTEGRATION_NEXT_ACTIONS.APPEND_COMPLETION, {
        git_effect_digest: gitEffect.digest,
        status_effect_digest: statusEffect.digest,
        intent_digest: intent.digest
      });
    }

    case INTEGRATION_PREFIXES.COMPLETED: {
      const completion = eventOfKind(hop, ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED);

      return Object.freeze({
        schema_version: MANAGED_WORKER_INTEGRATION_SETTLEMENT_SCHEMA_VERSION,
        settled: true,
        prefix,
        incomplete: null,
        completion_digest: completion.digest,
        bound_effects: Object.freeze({
          intent_digest: completion.payload?.intent_digest ?? null,
          git_effect_digest: completion.payload?.git_effect_digest ?? null,
          status_effect_digest: completion.payload?.status_effect_digest ?? null
        }),
        next_action: Object.freeze({ kind: INTEGRATION_NEXT_ACTIONS.SETTLED, detail: null })
      });
    }

    default:
      return incomplete(INTEGRATION_INCOMPLETE.INTENT_EFFECT_IDENTITY_MISMATCH,
        "the integration hop does not classify to a known durable prefix");
  }
}

export function admitIntegrationIntent({
  coordinatorAuthenticated,
  coordinatorActionId,
  resolvedBinding,
  callerSuppliedBinding = null
}) {
  if (coordinatorAuthenticated !== true) {
    return {
      admitted: false,
      refusal: Object.freeze({
        code: INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
        reason: "only a launcher-authenticated coordinator committed-slice integration invocation may create integration intent"
      })
    };
  }
  if (callerSuppliedBinding !== null) {
    return {
      admitted: false,
      refusal: Object.freeze({
        code: INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
        reason: "caller input selects only the public subject; it can never supply or override a resolved binding"
      })
    };
  }
  if (!isNonEmptyString(coordinatorActionId)) {
    return {
      admitted: false,
      refusal: Object.freeze({
        code: INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
        reason: "the coordinator action identity is missing"
      })
    };
  }
  const withoutDigest = { ...resolvedBinding, resolved_binding_digest: null, coordinator_action_id: coordinatorActionId };
  const binding = { ...withoutDigest, resolved_binding_digest: integrationBindingDigest(withoutDigest) };
  if (!isValidIntentBinding(binding)) {
    return {
      admitted: false,
      refusal: Object.freeze({
        code: INTEGRATION_INCOMPLETE.INTENT_UNAUTHENTICATED,
        reason: "the server-resolved binding is incomplete"
      })
    };
  }
  return {
    admitted: true,
    refusal: null,
    payload: Object.freeze({ coordinator_action_id: coordinatorActionId, binding: Object.freeze(binding) })
  };
}
