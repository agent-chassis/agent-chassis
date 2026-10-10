

import {
  WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES
} from "./trusted-operation-contracts.mjs";

export const WK_RECORD_RE = /^WK-\d{4}$/u;

export const INITIATIVE_RE = /^IN-\d{4}$/u;

export const OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DESTINATION_CONFIGURATION_PREREQUISITE =
  "the main repository's Git configuration selects exactly one valid handoff destination";

const REMOTE_CONFIGURATION_PREREQUISITE =
  "the selected remote has exactly one fetch and push URL, no URL rewrite, and (for hosted " +
  "handoff) a canonical https forge repository URL";

const ESTABLISHED_CORRECTIONS = Object.freeze({
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID]: Object.freeze({
    handoff_destination_unselected: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "set agent-launch.handoffDestination in the main repository to local, " +
        "git:<remote> or hosted:<remote>, or name the intended remote origin"
    }),
    handoff_destination_selector_ambiguous: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "keep exactly one agent-launch.handoffDestination value in the main repository"
    }),
    handoff_destination_selector_invalid: Object.freeze({
      responsible_actor: "operator",
      prerequisite: DESTINATION_CONFIGURATION_PREREQUISITE,
      operator_action: "set agent-launch.handoffDestination to local, git:<remote> or hosted:<remote>"
    }),
    ...Object.fromEntries(["url_rewrite_configured", "remote_fetch_url_not_unique",
      "remote_push_url_not_unique", "remote_push_url_diverges", "remote_url_not_canonical_https"]
      .map((reason) => [reason, Object.freeze({
        responsible_actor: "operator",
        prerequisite: REMOTE_CONFIGURATION_PREREQUISITE,
        operator_action: "correct the selected remote's URL configuration in the main repository"
      })]))
  }),
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID]: Object.freeze({
    main_repo_missing: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the launcher-frozen main repository"
    })
  }),
  [WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY]: Object.freeze({
    exact_terminal_candidate_resolver_unavailable: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the terminal-candidate publication-state resolver"
    }),
    exact_terminal_candidate_observer_unavailable: Object.freeze({
      responsible_actor: "launcher",
      prerequisite: "the handoff executor is composed with the terminal-candidate publication-state observer"
    })
  })
});

export function refuse(category, detail) {
  const key = detail?.reason ?? detail?.issue;
  const established = typeof key === "string"
    ? ESTABLISHED_CORRECTIONS[category]?.[key] ?? null
    : null;
  return {
    ok: false,
    category,
    detail: established === null ? detail ?? null : { ...detail, ...established }
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

export function projectHandoffDestination(destination) {
  return Object.freeze({
    transport: destination.transport,
    ...(destination.remote === undefined ? {} : { remote: destination.remote }),
    selection: destination.selection
  });
}

export function gitTransportFailure(stage, reason, observation) {
  return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
    stage, reason, ...(observation?.evidence === undefined ? {} : { evidence: observation.evidence })
  });
}

export function withEffects(refusal, effects, facts = {}) {
  return { ...refusal, detail: { ...refusal.detail, ...facts, effects: Object.freeze({ ...effects }) } };
}

export function buildResult(kind, fields) {
  return Object.freeze({
    schema_version: WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
    kind,
    ...fields,
    ...(fields.repository ? { repository: Object.freeze({ ...fields.repository }) } : {})
  });
}
