import { readFile } from "node:fs/promises";

import { buildNextCall } from "../lib/next-calls-descriptor.mjs";

const ROUTING_INTENTS_URL = new URL("../../data/tool-routing-intents.v1.json", import.meta.url);

const DURABLE_UNIT_RE = /\bWK-\d{4}(?:#SLICE-\d{3})?\b/gi;
const WORK_RECORD_RE = /\bWK-\d{4}\b/gi;
const INITIATIVE_RE = /\bIN-\d{4}\b/gi;
const SLICE_RE = /\bWK-\d{4}#SLICE-\d{3}\b/gi;
const MONITOR_HANDLE_RE = /\bwkmh_[a-z0-9_]+\b/gi;
const DOCS_PATH_RE = /\b(?:docs|wiki)\/[^\s,;:)]+/gi;

const ROLE_VALUES = new Set(["worker", "reviewer", "redteam", "read_only"]);
const MUTATION_TOOL_BY_KEYWORD = [
  ["create", "workspace_create_record"],
  ["status", "workspace_work_record_set_status"],
  ["task", "workspace_work_record_set_task"],
  ["closure", "workspace_work_record_set_closure"],
  ["close", "workspace_work_record_set_closure"],
  ["list field", "workspace_work_record_set_list_field"],
  ["acceptance", "workspace_work_record_set_acceptance"],
  ["upsert slice", "workspace_work_record_upsert_slice"],
  ["slice upsert", "workspace_work_record_upsert_slice"],
  ["delete slice", "workspace_work_record_delete_slice"],
  ["slice delete", "workspace_work_record_delete_slice"],
  ["shape review unit", "workspace_work_record_shape_review_unit"],
  ["review unit", "workspace_work_record_shape_review_unit"],
];

let cachedVocabulary = null;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstMatch(text, pattern) {
  return text.match(pattern)?.[0] ?? null;
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function sliceIdFromUnit(value) {
  const match = String(value ?? "").match(/#(SLICE-\d{3})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function normalizeTaskText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMatches(taskDescription, phrase) {
  const normalizedText = normalizeTaskText(taskDescription);
  const normalizedPhrase = normalizeTaskText(phrase);

  if (!normalizedPhrase) {
    return false;
  }

  if (/\b(?:wk|in)\b/.test(normalizedPhrase) || normalizedPhrase.includes("slice")) {
    const phrasePattern = normalizedPhrase
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("wk", "wk\\s+\\d+")
      .replaceAll("in", "in\\s+\\d+")
      .replaceAll("slice", "slice\\s+\\d+");
    return new RegExp(phrasePattern).test(normalizedText);
  }

  return normalizedText.includes(normalizedPhrase);
}

function extractKnownState(input = {}) {
  const taskDescription = String(input.task_description ?? input.taskDescription ?? input.task ?? "");
  const knownResources = input.known_resources && typeof input.known_resources === "object" ? input.known_resources : {};
  const text = [
    taskDescription,
    input.initiative,
    input.unit,
    input.role,
    input.monitor_handle,
    input.monitorHandle,
    ...Object.values(knownResources).flat().filter((value) => typeof value === "string"),
  ].join(" ");

  const sliceUnit = normalizeIdentifier(input.slice_unit ?? input.sliceUnit) ?? normalizeIdentifier(firstMatch(text, SLICE_RE));
  const unit = normalizeIdentifier(input.unit) ?? sliceUnit ?? normalizeIdentifier(firstMatch(text, DURABLE_UNIT_RE));
  const initiative = normalizeIdentifier(input.initiative) ?? normalizeIdentifier(firstMatch(text, INITIATIVE_RE));
  const workRecord = normalizeIdentifier(firstMatch(text, WORK_RECORD_RE));
  const sliceId = normalizeIdentifier(input.slice_id ?? input.sliceId) ?? sliceIdFromUnit(sliceUnit ?? unit);
  const monitorHandle = input.monitor_handle ?? input.monitorHandle ?? firstMatch(text, MONITOR_HANDLE_RE);
  const role = normalizeTaskText(input.role ?? firstMatch(text, /\b(?:worker|reviewer|redteam|read[_ -]?only)\b/i)).replace(" ", "_");
  const docsPath = firstMatch(text, DOCS_PATH_RE);

  return {
    taskDescription,
    normalizedTask: normalizeTaskText(taskDescription),
    initiative,
    unit: unit ?? workRecord,
    work_record_id: workRecord,
    slice_unit: sliceUnit,
    slice_id: sliceId,
    role: ROLE_VALUES.has(role) ? role : null,
    monitor_handle: monitorHandle,
    docs_path: docsPath,
    query: taskDescription.trim() || docsPath || null,
  };
}

function intentByName(vocabulary) {
  return new Map(vocabulary.intents.map((intent) => [intent.intent, intent]));
}

function deterministicIntentOrder(vocabulary) {
  const configured = vocabulary.classifier_policy?.deterministic_overlap_order ?? [];
  const known = new Set(configured);
  return [
    ...configured,
    ...vocabulary.intents
      .map((intent) => intent.intent)
      .filter((intent) => !known.has(intent))
      .sort(),
  ];
}

function sortCandidates(candidates, vocabulary) {
  const order = deterministicIntentOrder(vocabulary);
  const rank = new Map(order.map((intent, index) => [intent, index]));
  return [...candidates].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function classifyCandidates(vocabulary, state) {
  const candidates = vocabulary.intents
    .filter((intent) => intent.match_phrases.some((phrase) => phraseMatches(state.taskDescription, phrase)))
    .map((intent) => intent.intent);

  if (state.initiative && /status|frontier|blocked|current state/.test(state.normalizedTask)) {
    candidates.push("initiative_status");
  }
  if (state.initiative && /next action|what.*next|prepare dispatch|frontier action/.test(state.normalizedTask)) {
    candidates.push("initiative_next_action");
  }
  if (state.slice_unit) {
    candidates.push("selected_slice_detail");
  } else if (state.unit && /read|load|context|acceptance|write scope|work record/.test(state.normalizedTask)) {
    candidates.push("selected_work_record_context");
  }
  if (state.monitor_handle) {
    candidates.push("run_monitoring");
  }
  if (state.role && state.unit && /\b(start|launch|dispatch|assign|run)\b/.test(state.normalizedTask)) {
    candidates.push("dispatch_role_call");
  } else if (state.unit && /\b(dispatchable|ready|validate dispatch|readiness)\b/.test(state.normalizedTask)) {
    candidates.push("dispatch_readiness");
  }
  if (state.unit && /\b(update|close|reopen|set|add closure|edit|create|upsert|delete|shape)\b/.test(state.normalizedTask)) {
    candidates.push("work_record_mutation");
  }

  const uniqueCandidates = new Set(uniq(candidates));
  for (const actionIntent of ["dispatch_role_call", "dispatch_readiness", "work_record_mutation"]) {
    if (uniqueCandidates.has(actionIntent)) {
      uniqueCandidates.delete("selected_slice_detail");
      uniqueCandidates.delete("selected_work_record_context");
    }
  }

  return sortCandidates([...uniqueCandidates], vocabulary);
}

function applyOverlapRules(candidates, vocabulary) {
  for (const rule of vocabulary.classifier_policy?.overlap_rules ?? []) {
    if (candidates.includes(rule.choose) && rule.instead_of?.some((intent) => candidates.includes(intent))) {
      return {
        intent: rule.choose,
        rule,
      };
    }
  }
  return null;
}

function missingPrerequisites(intent, state) {
  return (intent.prerequisite_state ?? [])
    .filter((entry) => entry.required)
    .filter((entry) => {
      if (entry.name === "initiative_or_unit") {
        return !state.initiative && !state.unit;
      }
      if (entry.name === "unit") {
        return !state.unit;
      }
      if (entry.name === "slice_unit") {
        return !state.slice_unit;
      }
      if (entry.name === "role") {
        return !state.role;
      }
      if (entry.name === "monitor_handle") {
        return !state.monitor_handle;
      }
      if (entry.name === "query_or_path") {
        return !state.query;
      }
      if (entry.name === "mutation_target") {
        return !state.unit && !state.initiative;
      }
      if (entry.name === "mutation_operation") {
        return !deriveMutationTool(intent, state);
      }
      return false;
    });
}

function deriveMutationTool(intent, state) {
  const toolMap = intent.recommended_first_tool?.operation_tool_map ?? {};
  for (const [keyword, tool] of MUTATION_TOOL_BY_KEYWORD) {
    if (state.normalizedTask.includes(keyword) && Object.values(toolMap).includes(tool)) {
      return tool;
    }
  }
  return null;
}

function renderAllowedNextCalls(intent, vocabulary) {
  return uniq((intent.allowed_next_call_families ?? []).flatMap((family) => vocabulary.call_families?.[family] ?? []));
}

function renderSuggestedArguments(intent, state) {
  const template = intent.recommended_first_tool?.argument_template ?? {};
  const args = {};

  for (const [key, value] of Object.entries(template)) {
    if (value === "$initiative_if_known" && state.initiative) {
      args[key] = state.initiative;
    } else if (value === "$unit_if_known" && state.unit) {
      args[key] = intent.intent === "work_record_mutation" && state.slice_unit ? state.work_record_id ?? state.unit : state.unit;
    } else if (value === "$slice_unit_if_known" && state.slice_unit) {
      args[key] = state.slice_unit;
    } else if (value === "$slice_id_if_known" && state.slice_id) {
      args[key] = state.slice_id;
    } else if (value === "$role_if_known" && state.role) {
      args[key] = state.role;
    } else if (value === "$monitor_handle_if_known" && state.monitor_handle) {
      args[key] = state.monitor_handle;
    } else if (value === "$task_description" && state.taskDescription.trim()) {
      args[key] = state.taskDescription.trim();
    } else if (value === "$bounded_max_findings_if_known") {
      continue;
    } else if (typeof value !== "string") {
      args[key] = value;
    } else if (!value.startsWith("$")) {
      args[key] = value;
    }
  }

  return args;
}

function renderFirstTool(intent, state) {
  if (intent.intent !== "work_record_mutation") {
    return intent.recommended_first_tool.name;
  }
  return deriveMutationTool(intent, state) ?? intent.recommended_first_tool.name;
}

function buildMatchedNextCalls(intent, vocabulary, state, suggestedArguments) {
  const recommendedEntry = Object.keys(suggestedArguments).length > 0
    ? buildNextCall({ tool: renderFirstTool(intent, state), arguments: suggestedArguments, recommended: true })
    : buildNextCall({ tool: renderFirstTool(intent, state), recommended: true });
  const allowedEntries = renderAllowedNextCalls(intent, vocabulary).map((tool) => buildNextCall({ tool }));
  const disallowedEntries = (intent.forbidden_first_tools ?? []).map((entry) =>
    buildNextCall({ ...entry, disallowed: true }),
  );
  return [recommendedEntry, ...allowedEntries, ...disallowedEntries];
}

function buildAmbiguousNextCalls(topCandidates, byName, vocabulary) {
  const allowedEntries = uniq(
    topCandidates.flatMap((name) => renderAllowedNextCalls(byName.get(name), vocabulary)),
  ).map((tool) => buildNextCall({ tool }));
  const disallowedEntries = topCandidates.flatMap((name) =>
    (byName.get(name)?.forbidden_first_tools ?? []).map((entry) => buildNextCall({ ...entry, disallowed: true })),
  );
  return [...allowedEntries, ...disallowedEntries];
}

function renderMatched(intent, vocabulary, state, reason) {
  const suggestedArguments = renderSuggestedArguments(intent, state);
  const nextCalls = buildMatchedNextCalls(intent, vocabulary, state, suggestedArguments);
  return {
    result_state: "matched",
    classified_intent: intent.intent,
    suggested_arguments: suggestedArguments,
    next_calls: nextCalls,
    reason,
  };
}

function renderAmbiguous(candidateIntents, vocabulary, state, reason, missing = []) {
  const limit = vocabulary.router_result_states?.ambiguous?.bounded_guidance?.max_candidate_intents ?? 3;
  const topCandidates = candidateIntents.slice(0, limit);
  const nextCalls = buildAmbiguousNextCalls(topCandidates, intentByName(vocabulary), vocabulary);
  return {
    result_state: "ambiguous",
    candidate_intents: topCandidates,
    missing_disambiguating_state:
      missing[0]?.if_missing ??
      vocabulary.router_result_states?.ambiguous?.bounded_guidance?.ask_for ??
      "the smallest missing state needed to choose a route",
    next_calls: nextCalls,
    reason,
  };
}

function renderUnknown(vocabulary) {
  const guidance = vocabulary.router_result_states?.unknown?.bounded_unsupported_intent_guidance?.guidance ?? [];
  const limit = vocabulary.router_result_states?.unknown?.bounded_unsupported_intent_guidance?.max_guidance_items ?? 3;
  return {
    result_state: "unknown",
    reason: vocabulary.router_result_states?.unknown?.deterministic_no_match_behavior ?? "No routing intent matched.",
    unsupported_intent_guidance: guidance.slice(0, limit),
  };
}

export async function loadToolRoutingVocabulary() {
  if (!cachedVocabulary) {
    cachedVocabulary = JSON.parse(await readFile(ROUTING_INTENTS_URL, "utf8"));
  }
  return cachedVocabulary;
}

export function recommendToolRouteFromVocabulary(input = {}, vocabulary) {
  const state = extractKnownState(input);
  const byName = intentByName(vocabulary);
  const candidates = classifyCandidates(vocabulary, state);

  if (candidates.length === 0) {
    return renderUnknown(vocabulary);
  }

  const overlap = applyOverlapRules(candidates, vocabulary);
  if (overlap) {
    const intent = byName.get(overlap.intent);
    const missing = missingPrerequisites(intent, state);
    if (missing.length > 0) {
      return renderAmbiguous([intent.intent], vocabulary, state, overlap.rule.reason, missing);
    }
    return renderMatched(intent, vocabulary, state, overlap.rule.reason);
  }

  if (candidates.length > 1) {
    return renderAmbiguous(
      candidates,
      vocabulary,
      state,
      "Multiple routing intents matched and no deterministic overlap rule selected one.",
    );
  }

  const intent = byName.get(candidates[0]);
  const missing = missingPrerequisites(intent, state);
  if (missing.length > 0) {
    return renderAmbiguous([intent.intent], vocabulary, state, missing[0].if_missing, missing);
  }

  return renderMatched(intent, vocabulary, state, `Matched routing intent ${intent.intent}.`);
}

export async function recommendToolRoute(input = {}) {
  return recommendToolRouteFromVocabulary(input, await loadToolRoutingVocabulary());
}

export const workspaceToolRouterRecommend = recommendToolRoute;
