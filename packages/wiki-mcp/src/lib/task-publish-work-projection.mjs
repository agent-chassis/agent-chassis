

import { isDeepStrictEqual } from "node:util";

const pick = (value, fields) => Object.fromEntries(fields.filter(field => value?.[field] != null)
  .map(field => [field, value[field]]));

export function publicationDiagnosisFacts(value, root = true) {
  if (Array.isArray(value)) return value.map(entry => publicationDiagnosisFacts(entry, false));
  if (value === null || typeof value !== "object") return value;
  const facts = Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    !(key === "retained_evidence" && ((entry?.retained === true && entry.audience === "operator") ||
      entry?.failed_operation === "retain_operator_only_evidence")) &&
    !(root && key === "successful_checks") &&
    !(root && key === "findings" && Array.isArray(entry) && entry.length === 0) &&
    !(key.endsWith("_redactions") && Array.isArray(entry) && entry.length === 0))

    .map(([key, entry]) => [key, ["candidate_value", "observed_value", "value"].includes(key)
      ? entry : publicationDiagnosisFacts(entry, false)]));
  const origin = facts.cause_chain?.[0];
  for (const [rendered, original] of [["error_name", "name"], ["error_message", "message"],
    ["cause_code", "code"], ["details", "details"]]) {
    if (origin?.[original] !== undefined && isDeepStrictEqual(facts[rendered], origin[original])) delete facts[rendered];
  }
  if (facts.evidence_capture != null && Object.keys(facts.evidence_capture).length === 0 &&
      value.evidence_capture?.retained_evidence?.retained === true &&
      value.evidence_capture.retained_evidence.audience === "operator") delete facts.evidence_capture;
  const typed = facts.recovery_detail;
  const failure = facts.evidence?.cause_chain?.[0] ?? origin;
  if (typed?.schema_version === "agent_launch.terminal_candidate_failure_projection.v1" &&
      typed.kind === "typed_candidate_error" && typed.code === failure?.code) {

    if (typed.detail == null || isDeepStrictEqual(typed.detail, failure.detail)) delete facts.recovery_detail;
    else facts.recovery_detail = { detail: typed.detail };
  }
  return facts;
}

export function publicationPreparation(value) {
  if (value == null) return undefined;
  const changes = Object.fromEntries(Object.entries(pick(value,
    ["generation", "authoring_sources", "terminal_candidate", "previous_candidate", "candidate"]))
    .filter(([, effect]) => effect !== "existing" && effect !== "not_applicable"));
  return Object.keys(changes).length === 0 ? undefined : changes;
}

export function publicationResult(result, diagnostic) {
  const answer = pick(result, ["kind", "reason", "transport", "commit", "handoff_ref"]);
  if (result?.transport !== "hosted" && result?.base_branch != null) answer.base_branch = result.base_branch;
  if (result?.transport === "git" && result.branch != null) answer.branch = result.branch;
  if (result?.pull_request_state === "already_merged") answer.pull_request_state = result.pull_request_state;
  if (result?.pull_request != null) answer.pull_request = pick(result.pull_request, ["number", "url"]);
  const action = pick(result?.next_action, ["actor", "action", "head", "base_branch", "remote", "branch", "ref"]);

  for (const [field, owner] of Object.entries({ head: "commit", base_branch: "base_branch",
    branch: "branch", ref: "handoff_ref" })) {
    if (action[field] !== undefined && action[field] === answer[owner]) delete action[field];
  }
  if (Object.keys(action).length > 0) answer.next_action = action;
  if (result?.synchronization != null) answer.synchronization = publicationPreparation(result.synchronization);
  if (result?.effects != null) {

    const effects = Object.fromEntries(Object.entries(result.effects)
      .filter(([key, value]) => key !== "closeout_chain" && value !== "existing" && value !== "not_applicable"));
    if (Object.keys(effects).length > 0) answer.effects = effects;
    else if (Object.values(result.effects).every(value => value === "existing" || value === "not_applicable")) {
      answer.publication_effect = "unchanged";
    }
  }
  if (diagnostic != null) answer.diagnostic = diagnostic;
  if (result?.kind !== "handed_off" && result?.effects == null &&
      result?.synchronization == null && diagnostic?.effects == null) answer.effects_observed = false;
  return answer;
}
