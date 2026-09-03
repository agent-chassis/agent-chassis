import { readFile } from "node:fs/promises";

import {
  buildNextCalls,
  isCanonicalNextCallTool
} from "../lib/next-calls-descriptor.mjs";
import { loadToolDiscoveryDescriptor } from "../lib/tool-discovery.mjs";

const ROUTING_INTENTS_URL = new URL("../../data/tool-routing-intents.v1.json", import.meta.url);
const DEFAULT_DESCRIPTOR = await loadToolDiscoveryDescriptor();

const SLICE_ID_FRAGMENT = String.raw`SLICE-\d{3,}`;
const DURABLE_UNIT_RE = new RegExp(
  String.raw`\bWK-\d{4}(?:#${SLICE_ID_FRAGMENT}(?![\w-]))?\b`, "i"
);
const WORK_RECORD_RE = /\bWK-\d{4}\b/i;
const INITIATIVE_RE = /\bIN-\d{4}\b/i;
const SLICE_RE = new RegExp(
  String.raw`\bWK-\d{4}#${SLICE_ID_FRAGMENT}(?![\w-])`, "i"
);
const SLICE_ID_FROM_UNIT_RE = new RegExp(
  String.raw`#(${SLICE_ID_FRAGMENT})(?![\w-])`, "i"
);
const MONITOR_HANDLE_RE = /\bwkmh_[a-z0-9_]+\b/i;
const DOCS_PATH_RE = /\b(?:docs|wiki)\/[^\s,;:)]+/i;
const DISPATCH_ROLE_RE = /\b(?:worker|reviewer|redteam|read[_ -]?only)\b/i;

let cachedVocabulary = null;

function normalizeTaskText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[-_/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function firstMatch(text, pattern) {
  return String(text ?? "").match(pattern)?.[0] ?? null;
}

function sliceIdFromUnit(value) {
  return String(value ?? "").match(SLICE_ID_FROM_UNIT_RE)?.[1]?.toUpperCase() ?? null;
}

function normalizeStringArray(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim() !== "")
    ? value.map((entry) => entry.trim())
    : null;
}

function titleFromTask(taskDescription) {
  const match = String(taskDescription).match(
    /\b(?:titled|with\s+title|title(?:d)?\s+as)\s+["']?(.+?)["']?\s*[.!?]?$/iu
  );
  return match?.[1]?.trim() || null;
}

function extractKnownState(input = {}) {
  const taskIdentity = typeof input.task === "string" ? input.task : "";
  const taskDescription = String(
    input.task_description ?? input.taskDescription ?? taskIdentity
  );
  const known = input.known_resources && typeof input.known_resources === "object"
    ? input.known_resources
    : {};
  const searchable = [
    taskDescription,
    input.initiative,
    input.unit,
    input.slice_unit,
    input.monitor_handle,
    ...Object.values(known).flat().filter((value) => typeof value === "string")
  ].join(" ");
  const sliceUnit = normalizeIdentifier(input.slice_unit ?? input.sliceUnit) ??
    normalizeIdentifier(firstMatch(searchable, SLICE_RE));
  const unit = normalizeIdentifier(input.unit) ?? sliceUnit ??
    normalizeIdentifier(firstMatch(searchable, DURABLE_UNIT_RE));
  const workRecord = normalizeIdentifier(firstMatch(searchable, WORK_RECORD_RE));
  const initiative = normalizeIdentifier(input.initiative) ??
    normalizeIdentifier(firstMatch(searchable, INITIATIVE_RE));
  const rawRole = input.role ?? firstMatch(taskDescription, DISPATCH_ROLE_RE);
  const role = rawRole ? normalizeTaskText(rawRole).replace(" ", "_") : null;
  const docsPath = firstMatch(searchable, DOCS_PATH_RE);

  return {
    task_description: taskDescription,
    normalized_task: normalizeTaskText(taskDescription),
    task_identity: taskIdentity,
    normalized_task_identity: normalizeTaskText(taskIdentity),
    initiative,
    unit: unit ?? workRecord,
    work_record_id: workRecord,
    slice_unit: sliceUnit,
    slice_id: normalizeIdentifier(input.slice_id ?? input.sliceId) ??
      sliceIdFromUnit(sliceUnit ?? unit),
    role,
    monitor_handle: input.monitor_handle ?? input.monitorHandle ??
      firstMatch(searchable, MONITOR_HANDLE_RE),
    docs_path: docsPath,
    query: taskDescription.trim() || docsPath || null,
    title: typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : typeof known.title === "string" && known.title.trim()
        ? known.title.trim()
        : titleFromTask(taskDescription),
    focus: typeof known.focus === "string" && known.focus.trim() ? known.focus.trim() : null,
    proof_query: typeof known.proof_query === "string" && known.proof_query.trim()
      ? known.proof_query.trim()
      : null,
    requested_intents: normalizeStringArray(known.requested_intents),
    criteria: normalizeStringArray(known.criteria),
    validation: normalizeStringArray(known.validation),
    generation: typeof known.generation === "string" && known.generation.trim()
      ? known.generation.trim()
      : null,
    rename_or_replace_mode:
      typeof known.rename_or_replace_mode === "string" && known.rename_or_replace_mode.trim()
        ? known.rename_or_replace_mode.trim()
        : null,
    continuation: typeof known.continuation === "string" && known.continuation.trim()
      ? known.continuation.trim()
      : null,
    admitted_profile_id:
      typeof known.admitted_profile_id === "string" && known.admitted_profile_id.trim()
        ? known.admitted_profile_id.trim()
        : null,
    admitted_profile_version:
      typeof known.admitted_profile_version === "string" && known.admitted_profile_version.trim()
        ? known.admitted_profile_version.trim()
        : null
  };
}

function phraseMatches(taskDescription, phrase) {
  const text = normalizeTaskText(taskDescription);
  const target = normalizeTaskText(phrase);
  return target !== "" && text.includes(target);
}

function intentMatchPhrases(intent) {
  return [
    ...(intent.match_phrases ?? []),
    ...(intent.recommended_first_tool?.operation_routes ?? [])
      .flatMap((route) => route.match_phrases ?? [])
  ];
}

function exactTaskIdentityMatches(route, state) {
  const taskIdentity = state.normalized_task_identity;
  return taskIdentity !== "" && (route.match_task_ids ?? [])
    .some((identity) => normalizeTaskText(identity) === taskIdentity);
}

function orderedCandidates(vocabulary, state) {
  const matched = vocabulary.intents
    .filter((intent) => intentMatchPhrases(intent)
      .some((phrase) => phraseMatches(state.task_description, phrase)) ||
      (intent.recommended_first_tool?.operation_routes ?? [])
        .some((route) => exactTaskIdentityMatches(route, state)))
    .map((intent) => intent.intent);
  const configured = vocabulary.classifier_policy?.deterministic_overlap_order ?? [];
  const rank = new Map(configured.map((name, index) => [name, index]));
  return [...new Set(matched)].sort((left, right) =>
    (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
}

function applyOverlapRules(candidates, vocabulary) {
  for (const rule of vocabulary.classifier_policy?.overlap_rules ?? []) {
    const insteadOf = new Set(rule.instead_of ?? []);
    if (candidates.includes(rule.choose) &&
        candidates.some((intent) => insteadOf.has(intent)) &&
        candidates.every((intent) => intent === rule.choose || insteadOf.has(intent))) {
      return { intent: rule.choose, reason: rule.reason };
    }
  }
  return null;
}

function stateValuePresent(state, name) {
  const value = state[name];
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

function operationRouteMatches(route, state) {
  if (exactTaskIdentityMatches(route, state)) return true;
  const phrases = route.match_phrases ?? [];
  if (phrases.length > 0 && !phrases.some((phrase) =>
    phraseMatches(state.task_description, phrase))) return false;
  if ((route.when_state_present ?? []).some((name) => !stateValuePresent(state, name))) return false;
  if ((route.when_state_absent ?? []).some((name) => stateValuePresent(state, name))) return false;
  return true;
}

function selectIntentRoute(intent, state) {
  const configured = intent.recommended_first_tool ?? {};
  const routes = configured.operation_routes ?? [];
  if (routes.length === 0) return configured;
  return routes.find((route) => operationRouteMatches(route, state)) ?? null;
}

function resolveTemplateValue(value, state) {
  const substitutions = {
    "$initiative_if_known": state.initiative,
    "$unit_if_known": state.unit,
    "$work_record_if_known": state.work_record_id,
    "$slice_unit_if_known": state.slice_unit,
    "$slice_id_if_known": state.slice_id,
    "$role_if_known": state.role,
    "$monitor_handle_if_known": state.monitor_handle,
    "$task_description": state.task_description.trim() || null,
    "$title_if_known": state.title,
    "$focus_if_known": state.focus,
    "$proof_query_if_known": state.proof_query,
    "$requested_intents_if_known": state.requested_intents,
    "$criteria_if_known": state.criteria,
    "$validation_if_known": state.validation,
    "$generation_if_known": state.generation ?? null,
    "$rename_or_replace_mode": state.rename_or_replace_mode ?? null,
    "$continuation_if_known": state.continuation ?? null,
    "$admitted_profile_id_if_known": state.admitted_profile_id ?? null,
    "$admitted_profile_version_if_known": state.admitted_profile_version ?? null
  };
  if (typeof value === "string" && Object.hasOwn(substitutions, value)) {
    return substitutions[value];
  }
  if (Array.isArray(value)) {
    const resolved = value.map((entry) => resolveTemplateValue(entry, state));
    return resolved.some((entry) => entry === null) ? null : resolved;
  }
  if (value && typeof value === "object") {
    const sourceEntries = Object.entries(value);
    if (sourceEntries.length === 0) return {};
    const resolved = {};
    for (const [key, entry] of sourceEntries) {
      const substituted = resolveTemplateValue(entry, state);
      if (substituted !== null) resolved[key] = substituted;
    }
    return Object.keys(resolved).length > 0 ? resolved : null;
  }
  if (typeof value === "string" && value.startsWith("$")) return null;
  return value;
}

function renderArguments(route, descriptorEntry, state) {
  const template = descriptorEntry.recommended_first_call?.arguments ?? {};
  const args = {};
  for (const [key, value] of Object.entries(template)) {
    const resolved = resolveTemplateValue(value, state);
    if (resolved !== null) args[key] = resolved;
  }
  return args;
}

function missingAuthoredFields(route, state) {
  const missing = [];
  for (const requirement of route.required_authored_fields ?? []) {
    if (typeof requirement === "string") {
      if (!stateValuePresent(state, requirement)) missing.push(requirement);
      continue;
    }
    if (!requirement || typeof requirement !== "object") continue;
    const anyOf = requirement.any_of ?? [];
    if (anyOf.length > 0 && !anyOf.some((name) => stateValuePresent(state, name))) {
      missing.push(requirement.name);
    }
  }
  return missing;
}

function descriptorToolMap(descriptor) {
  return new Map((descriptor?.tools ?? []).map((entry) => [entry.tool_name, entry]));
}

function resolveDescriptorRoute(intent, route, descriptor, completeDescriptor) {
  const toolName = route?.name;
  if (!isCanonicalNextCallTool(toolName)) {
    throw new TypeError(`routing intent ${intent.intent} selects no canonical MCP operation`);
  }
  const complete = descriptorToolMap(completeDescriptor).get(toolName);
  if (!complete || complete.kind !== "mcp_tool" || complete.runtime_posture !== "supported" ||
      !Array.isArray(complete.task_ids) || complete.task_ids.length === 0) {
    throw new TypeError(`routing intent ${intent.intent} selects ${toolName} without a supported descriptor`);
  }
  if (route.operation && complete.recommended_first_call?.operation &&
      route.operation !== complete.recommended_first_call.operation) {
    throw new TypeError(`routing intent ${intent.intent} operation ${route.operation} disagrees with descriptor ${toolName}`);
  }
  return { complete, visible: descriptorToolMap(descriptor).get(toolName) };
}

function completeness(nextCalls) {
  return {
    complete_total: nextCalls.length,
    returned_count: nextCalls.length,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  };
}

function renderVisibilityWithheld(intent, reason) {
  return {
    result_state: "visibility_withheld",
    classified_intent: intent.intent,
    visibility_withholding: {
      reason: "operation_not_visible_in_session_profile",
      identity_disclosed: false,
      recovery_available: false
    },
    next_calls: [],
    next_calls_completeness: completeness([]),
    authority: "advisory_only",
    reason
  };
}

function renderMatched(intent, route, descriptorEntry, descriptor, state, reason) {
  const argumentsForCall = renderArguments(route, descriptorEntry, state);
  const nextCalls = buildNextCalls([{
    tool: route.name,
    ...(Object.keys(argumentsForCall).length > 0 ? { arguments: argumentsForCall } : {}),
    recommended: true
  }], {
    knownTools: new Set((descriptor.tools ?? []).map(({ tool_name: name }) => name))
  });
  return {
    result_state: "matched",
    classified_intent: intent.intent,
    suggested_arguments: argumentsForCall,
    required_authored_fields: missingAuthoredFields(route, state),
    known_context: state.initiative ? { initiative: state.initiative } : {},
    next_calls: nextCalls,
    next_calls_completeness: completeness(nextCalls),
    authority: "advisory_only",
    reason
  };
}

function continuationArguments(input, state) {
  const args = { task_description: state.task_description, candidate_view: "complete" };
  for (const key of ["initiative", "unit", "slice_unit", "slice_id", "role", "monitor_handle", "title"]) {
    if (stateValuePresent(state, key)) args[key] = state[key];
  }
  if (input.known_resources && typeof input.known_resources === "object") {
    args.known_resources = input.known_resources;
  }
  return args;
}

function renderAmbiguous(candidateNames, vocabulary, state, input, descriptor, completeDescriptor, reason) {
  const max = vocabulary.router_result_states?.ambiguous?.bounded_guidance?.max_candidate_intents ?? 3;
  const completeView = input.candidate_view === "complete";
  const displayed = completeView ? candidateNames : candidateNames.slice(0, max);
  const byName = new Map(vocabulary.intents.map((intent) => [intent.intent, intent]));
  const choices = [];
  const specs = [];
  for (const name of displayed) {
    const intent = byName.get(name);
    const route = selectIntentRoute(intent, state);
    if (!route) {
      choices.push({ intent: name, required_authored_fields: ["operation_choice"] });
      continue;
    }
    const resolved = resolveDescriptorRoute(intent, route, descriptor, completeDescriptor);
    if (!resolved.visible) {
      choices.push({ intent: name, visibility_withholding_reason: "operation_not_visible_in_session_profile" });
      continue;
    }
    const args = renderArguments(route, resolved.visible, state);
    choices.push({
      intent: name,
      operation: route.name,
      arguments: args,
      required_authored_fields: missingAuthoredFields(route, state)
    });
    specs.push({ tool: route.name, ...(Object.keys(args).length ? { arguments: args } : {}) });
  }
  const omitted = candidateNames.length - displayed.length;
  let continuation = null;
  if (omitted > 0) {
    continuation = { tool: "workspace_tool_router_recommend", arguments: continuationArguments(input, state) };
    specs.push(continuation);
  }
  const nextCalls = buildNextCalls(specs, {
    knownTools: new Set((descriptor.tools ?? []).map(({ tool_name: name }) => name))
  });
  return {
    result_state: "ambiguous",
    candidate_view: completeView ? "complete" : "bounded",
    candidate_intents: displayed,
    candidate_count_total: candidateNames.length,
    candidate_count_displayed: displayed.length,
    candidate_set_complete: omitted === 0,
    clarification_choices: choices,
    missing_disambiguating_state: "select one semantic intent or supply its missing authored fields",
    ...(continuation ? { complete_candidate_set_next_call: continuation } : {}),
    next_calls: nextCalls,
    next_calls_completeness: completeness(nextCalls),
    authority: "advisory_only",
    reason
  };
}

function renderUnknown(vocabulary, input, state, descriptor) {
  const known = input.known_resources && typeof input.known_resources === "object"
    ? input.known_resources
    : {};
  let recovery = null;
  if (typeof known.task_id === "string" && known.task_id.trim()) {
    recovery = { tool: "workspace_tools_query", arguments: { task_id: known.task_id.trim(), limit: 3 }, recommended: true };
  } else if (typeof known.tool_name === "string" && known.tool_name.trim()) {
    recovery = { tool: "workspace_tools_describe", arguments: { tool_name: known.tool_name.trim(), limit: 1 }, recommended: true };
  } else if (state.docs_path) {
    recovery = { tool: "workspace_search_repo", arguments: { query: state.docs_path, filters: { paths: ["docs/", "wiki/"] } }, recommended: true };
  }
  const nextCalls = recovery
    ? buildNextCalls([recovery], { knownTools: new Set((descriptor.tools ?? []).map(({ tool_name: name }) => name)) })
    : [];
  const guidance = vocabulary.router_result_states?.unknown
    ?.bounded_unsupported_intent_guidance?.guidance ?? [];
  return {
    result_state: "unknown",
    unsupported_intent_guidance: guidance.slice(0, 3),
    ...(recovery ? { recovery: { state: "callable", next_call: recovery } } : {
      recovery: { state: "no_supported_route" },
      no_supported_route: true,
      stop_condition: "no_supported_route"
    }),
    next_calls: nextCalls,
    next_calls_completeness: completeness(nextCalls),
    authority: "advisory_only",
    reason: vocabulary.router_result_states?.unknown?.deterministic_no_match_behavior ??
      "No routing intent matched."
  };
}

export async function loadToolRoutingVocabulary() {
  if (!cachedVocabulary) {
    cachedVocabulary = JSON.parse(await readFile(ROUTING_INTENTS_URL, "utf8"));
  }
  return cachedVocabulary;
}

export function recommendToolRouteFromVocabulary(input = {}, vocabulary, {
  descriptor = DEFAULT_DESCRIPTOR,
  completeDescriptor = DEFAULT_DESCRIPTOR
} = {}) {
  const state = extractKnownState(input);
  const candidates = orderedCandidates(vocabulary, state);
  if (candidates.length === 0) return renderUnknown(vocabulary, input, state, descriptor);

  const overlap = applyOverlapRules(candidates, vocabulary);
  const selected = overlap?.intent ?? (candidates.length === 1 ? candidates[0] : null);
  if (!selected) {
    return renderAmbiguous(candidates, vocabulary, state, input, descriptor,
      completeDescriptor, "Multiple semantic intents remain possible.");
  }

  const intent = vocabulary.intents.find(({ intent: name }) => name === selected);
  const route = selectIntentRoute(intent, state);
  if (!route) {
    return renderAmbiguous([selected], vocabulary, state, input, descriptor,
      completeDescriptor, "The semantic intent is known but its operation discriminant is missing.");
  }
  const resolved = resolveDescriptorRoute(intent, route, descriptor, completeDescriptor);
  if (!resolved.visible) {
    return renderVisibilityWithheld(intent,
      "The semantic intent matched, but its operation is not visible in this launcher-minted session profile.");
  }
  return renderMatched(intent, route, resolved.visible, descriptor, state,
    overlap?.reason ?? `Matched routing intent ${intent.intent}.`);
}

export async function recommendToolRoute(input = {}, context = {}) {
  return recommendToolRouteFromVocabulary(input, await loadToolRoutingVocabulary(), context);
}

export const workspaceToolRouterRecommend = recommendToolRoute;
