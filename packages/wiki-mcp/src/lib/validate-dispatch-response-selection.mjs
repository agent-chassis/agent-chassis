

import { z } from "zod";

import {
  assertNoControlledContractRawResponse,
  measureMcpInlineResultBytes
} from "./mcp-response.mjs";
import {
  containsReservedAssessmentEnvelope,
  createSelectedResponseSession,
  SELECTED_RESPONSE_MEMBERS_COLLECTION,
  selectedResponseCollectionCounts,
  selectedResponseDeliveryBound,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "./selected-response-snapshot.mjs";

export const VALIDATE_DISPATCH_ROUTE = "workspace_validate_dispatch";
export const VALIDATE_DISPATCH_SELECTED_SUMMARY_SCHEMA_VERSION = "validate-dispatch-selected-summary.v1";
const CONTROLLED_ACCEPTANCE_MEMBER = "controlled_acceptance_state";

const HEADER_MEMBERS = Object.freeze([
  "schema_version", "workspaceRepo", "record_id", "unit", "dispatch_role",
  "dispatchable", "decision_code", "reasons_total", "cluster_count"
]);

const PRIMARY_CORRECTION = "next_action";

const ESSENTIAL_MEMBERS = Object.freeze([
  "next_action", "graph_impact_failure_code", "auto_recoverable", "recovery", "state"
]);

const DECISION_SCALARS = Object.freeze([
  [CONTROLLED_ACCEPTANCE_MEMBER, "controlled_acceptance", [
    ["state", ["state"]], ["mechanically_complete", ["mechanically_complete"]],
    ["disposition", ["disposition"]], ["semantic_state", ["semantic", "state"]],
    ["semantic_source_current", ["semantic", "source_current"]],
    ["admission_admits", ["semantic", "admission", "admits"]],

    ["exemption", ["disposition", "exemption"]],
    ["rationale_provenance", ["disposition", "rationale_provenance"]]
  ]],
  ["admissibility", "admissibility", [
    ["status", ["status"]], ["admissible", ["admissible"]], ["authority", ["authority"]],
    ["decision_code", ["decision_code"]], ["recovery_diagnostic", ["recovery_diagnostic"]]
  ]]
]);

const DEFINITION_READINESS = "definition_readiness";
const DEFINITION_READINESS_COUNTS = Object.freeze([
  ["schema_version", ["schema_version"]], ["complete", ["complete"]],
  ["incomplete", ["incomplete"]]
]);
const EXECUTION_FACTS = Object.freeze([
  ["status", ["status"]], ["owner", ["owner"]],
  ["required_before_authoring", ["required_before_authoring"]],
  ["creates_definitions", ["creates_definitions"]]
]);

const CORRECTION_FACTS = Object.freeze([
  ["read_tool", ["read_tool"]], ["write_tool", ["write_tool"]],
  ["expected_content_digest_from", ["expected_content_digest_from"]]
]);

const MEMBER_PRIORITY = Object.freeze([
  "reasons", "next_calls", "graph_impact_failure", "axis_refusal", "controlled_acceptance_refusal",
  "controlled_acceptance_recovery", "structural_readiness", "admissibility", "worker_scope_preflight",
  "blast_radius_level",
  CONTROLLED_ACCEPTANCE_MEMBER, "blast_radius", "validation_hints", "accepted_escalations",
  "canonical_refs", "derived_evidence", "clusters"
]);

export function validateDispatchDetailRequestShape(zod = z) {
  return {
    repo: zod.string().optional(),
    unit: zod.string().min(1),
    detail: selectedResponseDetailSchema(zod)
  };
}

function canonicalJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableKey(value) {
  const canonical = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(canonical);
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(Object.keys(candidate).sort()
        .map((key) => [key, canonical(candidate[key])]));
    }
    return candidate;
  };
  return JSON.stringify(canonical(value));
}

function scalarFields(value, fields) {
  if (value === null || typeof value !== "object") return null;
  const selected = {};
  for (const [name, path] of fields) {
    let current = value;
    for (const segment of path) current = current?.[segment];
    if (current === null || ["string", "number", "boolean"].includes(typeof current)) {
      if (current !== undefined) selected[name] = current;
    }
  }
  return Object.keys(selected).length > 0 ? selected : null;
}

function definitionReadinessFacts(state) {
  const readiness = state?.definition_readiness ?? null;
  if (readiness === null || typeof readiness !== "object") return null;
  const unresolvedTotal = readiness.unresolved_obligation_count ?? 0;
  const execution = scalarFields(readiness.execution ?? null, EXECUTION_FACTS);
  const correction = readiness.correction === null || readiness.correction === undefined
    ? null
    : { ...scalarFields(readiness.correction, CORRECTION_FACTS),
      ...(readiness.correction.arguments === undefined
        ? {} : { arguments: canonicalJson(readiness.correction.arguments) }),

      ...(Object.hasOwn(readiness.correction, "observed_source_content_digest") ? {
        selected_unit_source: readiness.correction.observed_source_content_digest === null
          ? "absent" : "present" } : {}) };
  const rows = Array.isArray(readiness.unresolved_obligations)
    ? readiness.unresolved_obligations : [];

  const unresolved = (listed) => {
    const explained = listed.filter((row) =>
      Object.hasOwn(row, "authored_input_diagnostic_codes")).length;
    const complete = listed.length === unresolvedTotal;
    return { total: unresolvedTotal,
      inline: { complete, listed: listed.length,
        explanations_listed: explained,

        content_complete: complete && explained === listed.length },
      omitted: Math.max(0, unresolvedTotal - listed.length), obligations: listed };
  };
  return {
    rows,
    summary: (listed) => ({
      ...scalarFields(readiness, DEFINITION_READINESS_COUNTS),
      unresolved_obligations: unresolved(listed),
      ...(execution === null ? {} : { execution }),
      ...(correction === null ? {} : { correction })
    })
  };
}

function assertReadinessEmittedPage(page) {
  if (page.collection !== SELECTED_RESPONSE_MEMBERS_COLLECTION) return;
  const values = [];
  if (page.selector?.id === CONTROLLED_ACCEPTANCE_MEMBER && Object.hasOwn(page, "value")) {
    values.push(page.value);
  }
  for (const item of Array.isArray(page.items) ? page.items : []) {
    if (item?.id === CONTROLLED_ACCEPTANCE_MEMBER && Object.hasOwn(item, "value")) values.push(item.value);
  }
  for (const value of values) {
    if (containsReservedAssessmentEnvelope(value)) {
      throw new Error(`${VALIDATE_DISPATCH_ROUTE} selected detail would publish a reserved assessment envelope whole`);
    }
    assertNoControlledContractRawResponse(value, { toolName: VALIDATE_DISPATCH_ROUTE });
  }
}

function selectionForMember(source, carrier, member) {
  return Array.isArray(carrier[member])
    ? { source, collection: member }
    : { source, collection: SELECTED_RESPONSE_MEMBERS_COLLECTION, selector: { id: member } };
}

export function createValidateDispatchResponseSelection({
  env = process.env,
  now = undefined,
  capacity = undefined,
  ttlMs = undefined,
  resolveCurrentObservationIdentity = null
} = {}) {
  const requestSchema = selectedResponseRequestSchema(
    z.object(validateDispatchDetailRequestShape(z)).strict());
  const session = createSelectedResponseSession({
    route: VALIDATE_DISPATCH_ROUTE,
    requestSchema,
    buildDetailArguments: (binding, selection) => ({
      repo: binding.repository,
      unit: binding.unit,
      detail: selection
    }),
    assertEmittedPage: assertReadinessEmittedPage,
    resolveCurrentObservationIdentity,
    env,
    now,
    capacity,
    ttlMs
  });
  const bound = selectedResponseDeliveryBound(env);
  const fits = (payload) => measureMcpInlineResultBytes(payload) <= bound;

  async function publish({ workspaceRepo, carrier, observationIdentity = null }) {
    const complete = canonicalJson(carrier);
    const whole = { ...complete,
      selected_detail: { schema_version: VALIDATE_DISPATCH_SELECTED_SUMMARY_SCHEMA_VERSION, complete: true } };
    if (fits(whole) && !containsReservedAssessmentEnvelope(complete)) return whole;

    const unit = typeof complete.unit?.address === "string" ? complete.unit.address : complete.record_id;
    const binding = {
      route: VALIDATE_DISPATCH_ROUTE,
      repository: workspaceRepo,
      unit: unit ?? null,
      query_identity: null,
      observation_identity: typeof observationIdentity === "function"
        ? await observationIdentity(unit ?? null) : observationIdentity
    };
    const { source, snapshot_identity: snapshotIdentity } = session.retain({ binding, carrier: complete });

    const header = Object.fromEntries(HEADER_MEMBERS
      .filter((member) => Object.hasOwn(complete, member))
      .map((member) => [member, complete[member]]));
    const has = (member) => Object.hasOwn(complete, member);
    const ordered = [
      ...ESSENTIAL_MEMBERS.filter(has),
      ...MEMBER_PRIORITY.filter(has),
      ...Object.keys(complete).filter((member) => !HEADER_MEMBERS.includes(member) &&
        !ESSENTIAL_MEMBERS.includes(member) && !MEMBER_PRIORITY.includes(member))
    ];
    const inlined = [];
    let omitted = [...ordered];

    let deferNavigation = true;
    let derived = {};
    const collections = selectedResponseCollectionCounts(complete);

    const definitionSource = definitionReadinessFacts(complete[CONTROLLED_ACCEPTANCE_MEMBER]);

    const detailCalls = () => {

      const optional = omitted.length > 0 && Array.isArray(complete.next_calls) &&
        complete.next_calls.length > 0 && inlined.includes("next_calls")
        ? omitted[0] : null;
      const members = omitted.length === 0 ? [] : [omitted[0]];
      if (derived.reasons?.inline?.complete === false) members.push("reasons");
      if (derived.owner_next_calls?.inline?.complete === false) members.push("next_calls");

      const definitions = derived[DEFINITION_READINESS];
      const explanatoryOmission = definitionSource !== null &&
        (definitions === undefined ||
         definitions.unresolved_obligations?.inline?.content_complete === false);
      if (omitted.includes(CONTROLLED_ACCEPTANCE_MEMBER) && explanatoryOmission) {
        members.push(CONTROLLED_ACCEPTANCE_MEMBER);
      }
      const required = new Set(members.slice(1));
      const routes = deferNavigation && optional !== null && !required.has(optional) && required.size > 0
        ? [...required] : [...new Set(members)];
      return routes.map((member) => session.detailCall(binding,
        { ...selectionForMember(source, complete, member), snapshot_identity: snapshotIdentity },
        { recommended: member !== optional || required.has(member) }));
    };
    const detailFor = () => ({
      schema_version: VALIDATE_DISPATCH_SELECTED_SUMMARY_SCHEMA_VERSION,
      complete: false,
      source,
      snapshot_identity: snapshotIdentity,
      collections,
      omitted_members: omitted,
      ...derived,
      next_calls: detailCalls()
    });
    const summaryFor = () => ({
      ...header,
      ...Object.fromEntries(inlined.map((member) => [member, complete[member]])),
      selected_detail: detailFor()
    });

    const inline = (member) => {
      if (containsReservedAssessmentEnvelope(complete[member])) return false;
      const previous = omitted;
      inlined.push(member);
      omitted = omitted.filter((candidate) => candidate !== member);
      if (fits(summaryFor())) return true;
      inlined.pop();
      omitted = previous;
      return false;
    };
    const tryDerive = (name, value) => {
      if (value === null || value === undefined) return false;
      const previous = derived;
      derived = { ...derived, [name]: value };
      if (fits(summaryFor())) return true;
      derived = previous;
      return false;
    };
    const headerExceeded = () =>
      new RangeError(`${VALIDATE_DISPATCH_ROUTE} readiness header exceeds the complete-frame class`);

    if (has(PRIMARY_CORRECTION)) inline(PRIMARY_CORRECTION);
    const reasons = Array.isArray(complete.reasons) ? complete.reasons : [];
    const groups = new Map();
    reasons.forEach((reason, ordinal) => {
      const key = stableKey(reason);
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { ordinal, count: 1, value: reason });
    });
    const distinctReasons = [...groups.values()];
    const ownerCalls = Array.isArray(complete.next_calls) ? complete.next_calls : [];
    const callIdentities = ownerCalls.map((call, ordinal) => ({ ordinal, tool: call?.tool ?? null,
      ...(call?.recommended === true ? { recommended: true } : {}) }));
    const reasonsSummary = (listed) => ({ total: reasons.length, distinct_total: distinctReasons.length,
      inline: { complete: listed.length === distinctReasons.length, listed: listed.length }, distinct: listed });
    const callsSummary = (listed) => ({ total: ownerCalls.length,
      inline: { complete: listed.length === callIdentities.length, listed: listed.length }, calls: listed });

    if (reasons.length > 0) {
      if (inline("reasons")) {
        derived = { ...derived, reasons: { total: reasons.length, distinct_total: distinctReasons.length } };
      } else if (!tryDerive("reasons", reasonsSummary([]))) throw headerExceeded();
    }
    if (ownerCalls.length > 0) {
      if (inline("next_calls")) derived = { ...derived, owner_next_calls: { total: ownerCalls.length } };
      else if (!tryDerive("owner_next_calls", callsSummary([]))) throw headerExceeded();
    }

    for (const [member, name, fields] of DECISION_SCALARS) {
      if (has(member)) tryDerive(name, scalarFields(complete[member], fields));
    }

    deferNavigation = false;
    if (!fits(summaryFor())) deferNavigation = true;

    for (const member of ESSENTIAL_MEMBERS.filter(has)) {
      if (member !== PRIMARY_CORRECTION) inline(member);
    }

    const definitions = definitionSource;
    if (definitions !== null && tryDerive(DEFINITION_READINESS, definitions.summary([]))) {
      let listed = [];
      for (const row of definitions.rows) {
        const next = [...listed, { obligation_id: row.obligation_id }];
        if (!tryDerive(DEFINITION_READINESS, definitions.summary(next))) break;
        listed = next;
      }

      for (const index of listed.keys()) {
        const next = [...listed];
        next[index] = { ...next[index], authored_input_diagnostic_codes:
          definitions.rows[index].authored_input_diagnostic_codes };
        if (tryDerive(DEFINITION_READINESS, definitions.summary(next))) listed = next;
      }
    }

    const compactReason = ({ ordinal, count }) => ({ ordinal, count });
    let listedReasons = [];
    let listedCalls = [];
    let reasonsOpen = reasons.length > 0 && !inlined.includes("reasons");
    let callsOpen = ownerCalls.length > 0 && !inlined.includes("next_calls");
    while (reasonsOpen || callsOpen) {
      if (reasonsOpen) {
        const next = [...listedReasons, compactReason(distinctReasons[listedReasons.length])];
        if (tryDerive("reasons", reasonsSummary(next))) listedReasons = next;
        reasonsOpen = listedReasons === next && next.length < distinctReasons.length;
      }
      if (callsOpen) {
        const next = [...listedCalls, callIdentities[listedCalls.length]];
        if (tryDerive("owner_next_calls", callsSummary(next))) listedCalls = next;
        callsOpen = listedCalls === next && next.length < callIdentities.length;
      }
    }

    for (const index of listedReasons.keys()) {
      const next = [...listedReasons];
      next[index] = distinctReasons[index];
      if (tryDerive("reasons", reasonsSummary(next))) listedReasons = next;
    }

    for (const member of ordered) {
      if (!inlined.includes(member) && !ESSENTIAL_MEMBERS.includes(member) &&
          member !== "reasons" && member !== "next_calls") {
        inline(member);
      }
    }

    for (const [member, name] of [...DECISION_SCALARS,
      [CONTROLLED_ACCEPTANCE_MEMBER, DEFINITION_READINESS]]) {
      if (inlined.includes(member) && Object.hasOwn(derived, name)) {
        const { [name]: _dropped, ...rest } = derived;
        derived = rest;
      }
    }

    const summary = summaryFor();
    if (!fits(summary)) throw headerExceeded();
    return summary;
  }

  async function detail({ workspaceRepo, unit, detail: request }) {
    return session.detail({
      expected: { route: VALIDATE_DISPATCH_ROUTE, repository: workspaceRepo, unit },
      detail: request
    });
  }

  return Object.freeze({ publish, detail, session, requestSchema, bound });
}
