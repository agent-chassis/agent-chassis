import { readFile } from "node:fs/promises";

import {
  buildNextCalls,
  isAuthoritativeRequestSchema,
  isCanonicalNextCallTool,
  requestContractErrors
} from "../lib/next-calls-descriptor.mjs";
import { loadToolDiscoveryDescriptor } from "../lib/tool-discovery.mjs";

const ROUTING_INTENTS_URL = new URL("../../data/tool-routing-intents.v1.json", import.meta.url);
const DESCRIBE_TOOL = "workspace_tools_describe";
const ROUTER_TOOL = "workspace_tool_router_recommend";
const DEFAULT_DESCRIPTOR = await loadToolDiscoveryDescriptor();

export const TOOL_ROUTER_PRODUCER_ERROR_CODES = Object.freeze({
  REQUEST_SCHEMA_UNAVAILABLE: "tool_router_request_schema_unavailable",
  REQUEST_CONTRACT_INVALID: "tool_router_request_contract_invalid"
});

const SLICE_ID_FRAGMENT = String.raw`SLICE-\d{3,}`;
const DURABLE_UNIT_RE = new RegExp(
  String.raw`\bWK-\d{4}(?:#${SLICE_ID_FRAGMENT}(?![\w-]))?\b`, "i"
);
const WORK_RECORD_RE = /\bWK-\d{4}\b/i;
const OBLIGATION_RE = /\bOBL-[A-Z0-9](?:[A-Z0-9._-]*[A-Z0-9])?\b/iu;
const TEST_PROOF_RE = /\btest-proof-[A-Z0-9](?:[A-Z0-9._-]*[A-Z0-9])?\b/iu;
const INITIATIVE_RE = /\bIN-\d{4}\b/i;
const SLICE_RE = new RegExp(
  String.raw`\bWK-\d{4}#${SLICE_ID_FRAGMENT}(?![\w-])`, "i"
);
const SLICE_ID_FROM_UNIT_RE = new RegExp(
  String.raw`#(${SLICE_ID_FRAGMENT})(?![\w-])`, "i"
);
const MONITOR_HANDLE_RE = /\bwkmh_[a-z0-9_]+\b/i;
const ENTRY_ID_RE = /\bentry\s*(?:#|no\.?|number|id)?\s*(\d+)\b/i;

const PHRASE_FILLER_TOKENS = new Set(["a", "an", "the", "this", "that", "its", "my", "our", "your", "their",
  "me", "it", "we", "us", "things", "do", "does", "of", "for", "in", "on", "from", "worker", "reviewer",
  "redteam", "wk", "slice", "initiative"]);
const DIGITS_RE = /^\d+$/u;

const WRITE_VERB_TOKENS = new Set(["add", "amend", "append", "author", "create", "delete", "edit", "insert",
  "rebind", "remove", "replace", "retire", "rewrite", "save", "store", "update", "upsert"]);
const EXPLANATION_RE = /\b(?:explain|explanation|how (?:to|do|does|should|can))\b/u;

const PROSPECTIVE_REQUEST_RE = new RegExp([
  String.raw`\b(?:can|could|should|shall|may|might) (?:we|i|this|that|it|they)\b`,
  String.raw`\b(?:is|are) (?:it|this|that|we|they) ready\b`,
  String.raw`\bready (?:to|for)\b`,
  String.raw`\b(?:safe|ok|okay|allowed|permitted|fine) to\b`
].join("|"), "u");
const UNBOUNDED_READ_RE = new RegExp([
  String.raw`\b(?:everything|anything)\b`,
  String.raw`\ball (?:the )?(?:records|work records|wks|slices|entries|pages|docs|context)\b`,
  String.raw`\bfull context\b`,
  String.raw`\b(?:read|load|show|give|tell|send|pull|fetch|gather|dump) (?:me )?all\b`
].join("|"), "u");

const FOCUS_SLUG_RE = /^(?!wk-\d)(?!slice-\d+$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FOCUS_MAX_UTF8_BYTES = 128;
const DOCS_PATH_RE = /\b(?:docs|wiki)\/[^\s,;:)]+/i;
const DISPATCH_ROLE_RE = /\b(?:worker|reviewer|redteam|read[_ -]?only)\b/i;

const WORK_RECORD_SUBJECT_RE = new RegExp(String.raw`^WK-\d{4}(?:#${SLICE_ID_FRAGMENT})?$`);
const INITIATIVE_SUBJECT_RE = /^IN-\d{4}$/;

let cachedVocabulary = null;

function normalizeTaskText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()

    .replace(/['’]/gu, "")
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

function wordTokens(value) {
  return normalizeTaskText(value).split(/[^a-z0-9]+/u).filter(Boolean);
}

function positiveEntryId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const number = DIGITS_RE.test(text) ? Number(text) : 0;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function requestVerbs(taskDescription) {
  const normalized = normalizeTaskText(taskDescription);
  const explanation = EXPLANATION_RE.test(normalized);

  const write = wordTokens(taskDescription)
    .some((token, index, tokens) => WRITE_VERB_TOKENS.has(token) && tokens[index - 1] !== "to");
  return {
    write_request: write && !explanation ? true : null,
    explained_write_request: write && explanation ? true : null,

    broad_read_request: !write && UNBOUNDED_READ_RE.test(normalized) ? true : null,
    prospective_request: PROSPECTIVE_REQUEST_RE.test(normalized) ? true : null
  };
}

function supportedFocus(value) {
  const focus = knownString(value);
  return focus !== null && FOCUS_SLUG_RE.test(focus) &&
    Buffer.byteLength(focus, "utf8") <= FOCUS_MAX_UTF8_BYTES
    ? focus
    : null;
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

function knownString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleFromTask(taskDescription) {
  const match = String(taskDescription).match(
    /\b(?:titled|with\s+title|title(?:d)?\s+as)\s+["']?(.+?)["']?\s*[.!?]?$/iu
  );
  return match?.[1]?.trim() || null;
}

function agentRunSubject(explicitSubject, selected, { workRecordOnly = false } = {}) {
  if (explicitSubject !== null) {
    return WORK_RECORD_SUBJECT_RE.test(explicitSubject) ||
      (!workRecordOnly && INITIATIVE_SUBJECT_RE.test(explicitSubject))
      ? explicitSubject
      : null;
  }
  return selected.find((value) => value !== null) ?? null;
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
  const explicitSubject = knownString(input.subject ?? known.subject);
  const proofSubject = explicitSubject ??
    firstMatch(searchable, OBLIGATION_RE) ?? firstMatch(searchable, TEST_PROOF_RE) ??
    sliceUnit ?? unit ?? workRecord;
  const initiative = normalizeIdentifier(input.initiative) ??
    normalizeIdentifier(firstMatch(searchable, INITIATIVE_RE));
  const rawRole = input.role ?? firstMatch(taskDescription, DISPATCH_ROLE_RE);
  const role = rawRole ? normalizeTaskText(rawRole).replace(" ", "_") : null;
  const docsPath = firstMatch(searchable, DOCS_PATH_RE);
  const selectedUnit = unit ?? workRecord;

  return {
    task_description: taskDescription,
    normalized_task: normalizeTaskText(taskDescription),
    task_identity: taskIdentity,
    normalized_task_identity: normalizeTaskText(taskIdentity),
    initiative,
    unit: selectedUnit,
    work_record_id: workRecord,
    proof_subject: proofSubject,
    run_subject: agentRunSubject(explicitSubject, [selectedUnit, initiative]),
    reviewer_subject: agentRunSubject(explicitSubject, [selectedUnit], { workRecordOnly: true }),
    redteam_subject: agentRunSubject(explicitSubject, [selectedUnit, initiative]),
    diff_base_sha: knownString(known.diff_base_sha),
    reviewed_sha: knownString(known.reviewed_sha),
    slice_unit: sliceUnit,
    slice_id: normalizeIdentifier(input.slice_id ?? input.sliceId) ??
      sliceIdFromUnit(sliceUnit ?? unit),
    role,
    monitor_handle: input.monitor_handle ?? input.monitorHandle ??
      firstMatch(searchable, MONITOR_HANDLE_RE),
    docs_path: docsPath,
    entry_id: positiveEntryId(known.entry_id) ??
      positiveEntryId(taskDescription.match(ENTRY_ID_RE)?.[1]),
    ...requestVerbs(taskDescription),
    query: taskDescription.trim() || docsPath || null,
    title: knownString(input.title) ?? knownString(known.title) ?? titleFromTask(taskDescription),
    focus: supportedFocus(known.focus),
    proof_query: knownString(known.proof_query),
    requested_intents: normalizeStringArray(known.requested_intents),
    criteria: normalizeStringArray(known.criteria),
    validation: normalizeStringArray(known.validation),
    generation: knownString(known.generation),
    rename_or_replace_mode: knownString(known.rename_or_replace_mode),
    continuation: knownString(known.continuation),
    admitted_profile_id: knownString(known.admitted_profile_id),
    admitted_profile_version: knownString(known.admitted_profile_version)
  };
}

function separable(token) {
  return PHRASE_FILLER_TOKENS.has(token) || DIGITS_RE.test(token);
}

function phraseMatches(taskDescription, phrase) {
  const target = normalizeTaskText(phrase);
  if (target === "") return false;
  if (normalizeTaskText(taskDescription).includes(target)) return true;
  const words = wordTokens(phrase);
  if (words.length < 2) return false;
  const tokens = wordTokens(taskDescription);
  return tokens.some((token, start) => {
    if (token !== words[0]) return false;
    let position = start + 1;
    for (const word of words.slice(1)) {
      while (position < tokens.length && tokens[position] !== word && separable(tokens[position])) position += 1;
      if (tokens[position] !== word) return false;
      position += 1;
    }
    return true;
  });
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

    .filter((intent) => !(intent.when_state_absent ?? [])
      .some((name) => stateValuePresent(state, name)))
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
  const phrases = route.match_phrases ?? [];
  if (!exactTaskIdentityMatches(route, state) && phrases.length > 0 &&
      !phrases.some((phrase) => phraseMatches(state.task_description, phrase))) return false;
  if ((route.when_state_present ?? []).some((name) => !stateValuePresent(state, name))) return false;
  if ((route.when_state_absent ?? []).some((name) => stateValuePresent(state, name))) return false;
  if (Object.entries(route.when_state_equals ?? {})
    .some(([name, value]) => state[name] !== value)) return false;
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
    "$proof_subject_if_known": state.proof_subject,
    "$run_subject_if_known": state.run_subject,
    "$reviewer_subject_if_known": state.reviewer_subject,
    "$redteam_subject_if_known": state.redteam_subject,
    "$diff_base_sha_if_known": state.diff_base_sha,
    "$reviewed_sha_if_known": state.reviewed_sha,
    "$slice_unit_if_known": state.slice_unit,
    "$slice_id_if_known": state.slice_id,
    "$role_if_known": state.role,
    "$monitor_handle_if_known": state.monitor_handle,
    "$entry_id_if_known": state.entry_id,
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
  const template = route?.arguments ?? descriptorEntry.recommended_first_call?.arguments ?? {};
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

function visibleToolNames(descriptor) {
  return new Set((descriptor?.tools ?? []).map(({ tool_name: name }) => name));
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
  const routeArguments = route.arguments ?? null;
  if (routeArguments !== null && (typeof routeArguments !== "object" ||
      Array.isArray(routeArguments) || Object.keys(routeArguments).length === 0)) {
    throw new TypeError(`routing intent ${intent.intent} operation ${route.operation} declares invalid arguments`);
  }

  if (routeArguments === null && route.operation && complete.recommended_first_call?.operation &&
      route.operation !== complete.recommended_first_call.operation) {
    throw new TypeError(`routing intent ${intent.intent} operation ${route.operation} disagrees with descriptor ${toolName}`);
  }
  const visible = descriptorToolMap(descriptor).get(toolName);

  const describedToolName = toolName === DESCRIBE_TOOL &&
    typeof routeArguments?.tool_name === "string" && !routeArguments.tool_name.startsWith("$")
    ? routeArguments.tool_name
    : null;
  if (describedToolName === null) return { complete, visible };
  const described = descriptorToolMap(completeDescriptor).get(describedToolName);
  if (!described || described.kind !== "mcp_tool" || described.runtime_posture !== "supported") {
    throw new TypeError(`routing intent ${intent.intent} describes ${describedToolName} without a supported descriptor`);
  }
  return {
    complete,
    visible: descriptorToolMap(descriptor).has(describedToolName) ? visible : undefined
  };
}

function routerProducerError(code, toolName, stage) {
  const error = new Error(`${code}: ${toolName} (${stage})`);
  error.code = code;
  return error;
}

function registeredRequestContract(requestContracts, toolName) {
  const contract = typeof requestContracts?.contractFor === "function"
    ? requestContracts.contractFor(toolName)
    : null;
  if (!contract) {
    throw routerProducerError(
      TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE, toolName, "registration");
  }
  let requestSchema;
  try {
    requestSchema = contract.publishedRequestSchema();
  } catch {
    requestSchema = null;
  }
  if (!isAuthoritativeRequestSchema(requestSchema)) {
    throw routerProducerError(
      TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE, toolName, "projection");
  }
  return { contract, requestSchema };
}

async function prepareProposal({ tool, args, authoredMissing = [], allowPartial, requestContracts }) {
  const { contract, requestSchema } = registeredRequestContract(requestContracts, tool);
  const schemaMissing = (requestSchema.required ?? []).filter((name) => !Object.hasOwn(args, name));
  const missing = [...new Set([...authoredMissing, ...schemaMissing])];
  if (missing.length > 0) {
    if (allowPartial) return { callable: false, missing };
    throw routerProducerError(
      TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_CONTRACT_INVALID, tool, "required_arguments");
  }
  if (requestContractErrors(tool, args, requestSchema).length > 0) {
    throw routerProducerError(
      TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_CONTRACT_INVALID, tool, "published_request_schema");
  }
  let accepted = false;
  try {
    accepted = await contract.acceptsArguments(args);
  } catch {
    accepted = false;
  }
  if (accepted !== true) {
    throw routerProducerError(
      TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_CONTRACT_INVALID, tool, "full_input_schema");
  }
  return { callable: true, missing: [] };
}

function callSpec(tool, args, extra = {}) {
  return { tool, ...(Object.keys(args).length > 0 ? { arguments: args } : {}), ...extra };
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

async function serverStateGuidance(intent, route, missing, state, context) {
  const declared = new Map((route.server_state_fields ?? []).map((entry) => [entry.field, entry]));
  const visible = visibleToolNames(context.descriptor);
  const authored = [];
  const serverState = [];
  let read = null;
  for (const name of missing) {
    const entry = declared.get(name);
    if (!entry || !visible.has(entry.read?.name)) {
      authored.push(name);
      continue;
    }
    const complete = descriptorToolMap(context.completeDescriptor).get(entry.read.name);
    if (!complete || complete.kind !== "mcp_tool" || complete.runtime_posture !== "supported") {
      throw new TypeError(`routing intent ${intent.intent} reads ${name} from ${entry.read.name} without a supported descriptor`);
    }
    serverState.push({ field: name, result_field: entry.result_field });
    if (read !== null) continue;
    const args = renderArguments(entry.read, complete, state);
    const prepared = await prepareProposal({
      tool: entry.read.name, args, allowPartial: true, requestContracts: context.requestContracts
    });
    if (prepared.callable) read = callSpec(entry.read.name, args, { recommended: true });
  }
  return { authored, serverState, read };
}

async function renderMatched(intent, route, descriptorEntry, state, reason, context) {
  const argumentsForCall = renderArguments(route, descriptorEntry, state);
  const prepared = await prepareProposal({
    tool: route.name,
    args: argumentsForCall,
    authoredMissing: missingAuthoredFields(route, state),
    allowPartial: true,
    requestContracts: context.requestContracts
  });
  const guidance = prepared.callable
    ? { authored: [], serverState: [], read: null }
    : await serverStateGuidance(intent, route, prepared.missing, state, context);
  const specs = prepared.callable
    ? [callSpec(route.name, argumentsForCall, { recommended: true })]
    : [guidance.read].filter(Boolean);
  const nextCalls = specs.length > 0
    ? buildNextCalls(specs, { knownTools: visibleToolNames(context.descriptor) })
    : [];
  return {
    result_state: "matched",
    classified_intent: intent.intent,
    ...(prepared.callable ? {} : { operation: route.name }),
    suggested_arguments: argumentsForCall,
    required_authored_fields: guidance.authored,
    ...(guidance.serverState.length > 0 ? { server_state_fields: guidance.serverState } : {}),
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

async function renderAmbiguous(candidateNames, vocabulary, state, input, context, reason) {
  const { descriptor, completeDescriptor, requestContracts } = context;
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
    const prepared = await prepareProposal({
      tool: route.name,
      args,
      authoredMissing: missingAuthoredFields(route, state),
      allowPartial: true,
      requestContracts
    });
    const guidance = prepared.callable
      ? { authored: [], serverState: [] }
      : await serverStateGuidance(intent, route, prepared.missing, state, context);
    choices.push({
      intent: name,
      operation: route.name,
      arguments: args,
      required_authored_fields: guidance.authored,
      ...(guidance.serverState.length > 0 ? { server_state_fields: guidance.serverState } : {})
    });

    if (prepared.callable && !specs.some(({ tool }) => tool === route.name)) {
      specs.push(callSpec(route.name, args));
    }
  }
  const omitted = candidateNames.length - displayed.length;
  if (omitted > 0) {
    const args = continuationArguments(input, state);
    await prepareProposal({ tool: ROUTER_TOOL, args, allowPartial: false, requestContracts });
    specs.push(callSpec(ROUTER_TOOL, args));
  }
  const nextCalls = buildNextCalls(specs, { knownTools: visibleToolNames(descriptor) });
  const continuation = omitted > 0 ? nextCalls.find(({ tool }) => tool === ROUTER_TOOL) : null;
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

function unknownRecoveryProposal(known, state) {
  if (typeof known.task_id === "string" && known.task_id.trim()) {
    return { tool: "workspace_tools_list", args: { task_id: known.task_id.trim() } };
  }
  if (typeof known.tool_name === "string" && known.tool_name.trim()) {
    return { tool: "workspace_tools_describe", args: { tool_name: known.tool_name.trim(), limit: 1 } };
  }
  if (state.docs_path) {
    return { tool: "workspace_search_repo", args: { query: state.docs_path } };
  }
  return null;
}

async function renderUnknown(vocabulary, input, state, context) {
  const known = input.known_resources && typeof input.known_resources === "object"
    ? input.known_resources
    : {};
  const proposal = unknownRecoveryProposal(known, state);
  const knownTools = visibleToolNames(context.descriptor);
  let nextCalls = [];
  if (proposal !== null && knownTools.has(proposal.tool)) {
    await prepareProposal({
      tool: proposal.tool,
      args: proposal.args,
      allowPartial: false,
      requestContracts: context.requestContracts
    });
    nextCalls = buildNextCalls([callSpec(proposal.tool, proposal.args, { recommended: true })], { knownTools });
  }
  const guidance = vocabulary.router_result_states?.unknown
    ?.bounded_unsupported_intent_guidance?.guidance ?? [];
  return {
    result_state: "unknown",
    unsupported_intent_guidance: guidance.slice(0, 3),
    ...(nextCalls.length > 0 ? { recovery: { state: "callable", next_call: nextCalls[0] } } : {
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

export async function recommendToolRouteFromVocabulary(input = {}, vocabulary, {
  descriptor = DEFAULT_DESCRIPTOR,
  completeDescriptor = DEFAULT_DESCRIPTOR,
  requestContracts = null
} = {}) {
  const context = { descriptor, completeDescriptor, requestContracts };
  const state = extractKnownState(input);
  const candidates = orderedCandidates(vocabulary, state);
  if (candidates.length === 0) return renderUnknown(vocabulary, input, state, context);

  const overlap = applyOverlapRules(candidates, vocabulary);
  const selected = overlap?.intent ?? (candidates.length === 1 ? candidates[0] : null);
  if (!selected) {
    return renderAmbiguous(candidates, vocabulary, state, input, context,
      "Multiple semantic intents remain possible.");
  }

  const intent = vocabulary.intents.find(({ intent: name }) => name === selected);

  const ambiguity = (intent.ambiguity_when_state_present ?? [])
    .find(({ name }) => stateValuePresent(state, name));
  if (ambiguity) return renderAmbiguous([selected], vocabulary, state, input, context, ambiguity.reason);

  const route = selectIntentRoute(intent, state);
  if (!route) {
    return renderAmbiguous([selected], vocabulary, state, input, context,
      "The semantic intent is known but its operation discriminant is missing.");
  }
  const resolved = resolveDescriptorRoute(intent, route, descriptor, completeDescriptor);
  if (!resolved.visible) {
    return renderVisibilityWithheld(intent,
      "The semantic intent matched, but its operation is not visible in this launcher-minted session profile.");
  }
  return renderMatched(intent, route, resolved.visible, state,
    route.reason ?? overlap?.reason ?? `Matched routing intent ${intent.intent}.`, context);
}

export async function recommendToolRoute(input = {}, context = {}) {
  return recommendToolRouteFromVocabulary(input, await loadToolRoutingVocabulary(), context);
}

export const workspaceToolRouterRecommend = recommendToolRoute;
