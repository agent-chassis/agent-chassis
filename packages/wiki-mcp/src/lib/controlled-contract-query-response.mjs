

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import {
  createSelectedResponseSession,
  readSelectedResponseSource,
  SELECTED_RESPONSE_MEMBERS_COLLECTION,
  selectedResponseCollectionCounts,
  selectedResponseDeliveryBound,
  selectedResponseDetailSchema,
  selectedResponseRequestSchema
} from "./selected-response-snapshot.mjs";

export const OBLIGATION_COVERAGE_QUERY_ROUTE = "workspace_controlled_contract_obligation_coverage_query";
export const OBLIGATION_COVERAGE_QUERY_SELECTED_SUMMARY_SCHEMA_VERSION =
  "obligation-coverage-query-selected-summary.v1";

const NAVIGATION_RESERVE_BYTES = 1280;
const JOURNEY_CACHE_CAPACITY = 64;
const ROW_PROJECTION_SCHEMA_VERSION = "task-result-row-projection.v1";

const REQUIRED_SUMMARY_MEMBERS = Object.freeze([
  "schema_version", "unit", "status", "view", "content_digest", "source_identity",
  "source_authority", "population"
]);
const OPTIONAL_SUMMARY_MEMBERS = Object.freeze([
  "contract_content_digest", "meaning_identity", "requirement_status",
  "controlled_acceptance", "contract_inputs_summary", "obligation_detail_read"
]);

const PARAMETER_SELECTION_COLLECTION = "obligations";
const PARAMETER_SELECTION_SELECTOR = Object.freeze({ id: "0" });
const PARAMETER_CONTRACT_IDENTITY_MEMBERS = Object.freeze([
  "profile_id", "profile_version", "profile_digest", "total", "returned", "omitted"
]);
const CRITERION_IDENTITIES_MEMBER = "criterion_identities";

export function obligationCoverageQueryDetailRequestShape(zod, unitSchema) {
  return {
    repo: zod.string().min(1).optional(),
    unit: unitSchema,
    detail: selectedResponseDetailSchema(zod)
  };
}

function canonicalJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectedParameterContract(carrier) {
  if (typeof carrier.population?.obligation_id !== "string" || !Array.isArray(carrier.obligations) ||
      carrier.obligations.length !== 1) return null;
  const contract = carrier.obligations[0].parameter_contract;
  return contract !== null && typeof contract === "object" && Array.isArray(contract.parameters)
    ? contract : null;
}

function parameterReadSequence(contract) {
  if (contract === null) return [];
  return [...contract.parameters.map((_, index) => ["value", "parameter_contract", "parameters", index]),
    ...Object.keys(contract).filter((member) => member !== "parameters" &&
      !PARAMETER_CONTRACT_IDENTITY_MEMBERS.includes(member))
      .map((member) => ["value", "parameter_contract", member])];
}

const notInlineOf = (reads) => reads.map((fieldPath) =>
  fieldPath.slice(fieldPath[1] === "parameter_contract" ? 2 : 1).join("."));

function parameterSelections(carrier, queryIdentity) {
  if (queryIdentity?.parameter_detail !== true || typeof queryIdentity.obligation_id !== "string" ||
      !Array.isArray(carrier.obligations) || carrier.obligations.length !== 1) return [];
  const row = carrier.obligations[0];
  const contract = selectedParameterContract(carrier);
  const fact = { obligation_id: row.obligation_id, parameter_detail: row.parameter_detail };
  if (contract === null) {
    const factRead = ["value", "parameter_detail"];
    return [
      { selection: { ...fact, parameter_contract: null, complete: true }, read: null },
      { selection: { obligation_id: row.obligation_id, parameter_detail: {
        status: row.parameter_detail?.status ?? null, reason_code: row.parameter_detail?.reason_code ?? null },
      not_inline: notInlineOf([factRead]), complete: false }, read: factRead }
    ];
  }
  const identity = Object.fromEntries(PARAMETER_CONTRACT_IDENTITY_MEMBERS
    .filter((member) => Object.hasOwn(contract, member)).map((member) => [member, contract[member]]));
  const sequence = parameterReadSequence(contract);
  const members = sequence.slice(contract.parameters.length);
  const partial = (inline, reads) => ({ selection: { ...fact, parameter_contract_identity: identity, ...inline,
    not_inline: notInlineOf(reads), complete: false }, read: reads[0] });
  return [
    { selection: { ...fact, parameter_contract: contract, complete: true }, read: null },
    ...(members.length === 0 ? [] : [partial({ parameters: contract.parameters }, members)]),
    partial({ parameter_refinements: contract.parameters.map((parameter) => ({ name: parameter.name,
      value_kind: parameter.value_kind, refinements: parameter.refinements })) }, sequence),
    partial({}, sequence)
  ];
}

function criterionIdentities(carrier) {
  if (!Array.isArray(carrier.acceptance_criteria) || carrier.acceptance_criteria.length === 0) return null;
  return Object.fromEntries(carrier.acceptance_criteria.map((entry) => [String(entry.position), entry.identity]));
}

function journeyOf(carrier) {
  return [SELECTED_RESPONSE_MEMBERS_COLLECTION, ...Object.entries(carrier)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([key]) => key)];
}

function isParameterContractField(page) {
  return page.collection === PARAMETER_SELECTION_COLLECTION && Array.isArray(page.field_path) &&
    page.selector?.id === PARAMETER_SELECTION_SELECTOR.id && page.field_path[0] === "value" &&
    page.field_path[1] === "parameter_contract";
}

function pageAppendsNavigation(page) {
  if (Array.isArray(page.items) &&
      page.items.some((item) => item?.schema_version === ROW_PROJECTION_SCHEMA_VERSION)) return true;
  if (Array.isArray(page.fields) && page.fields.length > 0) return true;
  if (isParameterContractField(page)) return true;
  const traversal = !Array.isArray(page.field_path) && (page.selector ?? null) === null;
  return traversal && (page.continuation ?? null) === null;
}

export function createObligationCoverageQuerySelection({
  unitSchema,
  env = process.env,
  now = undefined,
  capacity = undefined,
  ttlMs = undefined,
  resolveCurrentObservationIdentity = null
}) {
  const requestSchema = selectedResponseRequestSchema(
    z.object(obligationCoverageQueryDetailRequestShape(z, unitSchema)).strict());
  const buildDetailArguments = (binding, selection) => ({
    ...(typeof binding.repository === "string" ? { repo: binding.repository } : {}),
    unit: binding.unit,
    detail: selection
  });
  const session = createSelectedResponseSession({
    route: OBLIGATION_COVERAGE_QUERY_ROUTE,
    requestSchema,
    buildDetailArguments,
    requireAuthorityIdentity: true,
    navigationReserveBytes: NAVIGATION_RESERVE_BYTES,
    pageAppendsNavigation,
    resolveCurrentObservationIdentity,
    env,
    now,
    capacity,
    ttlMs
  });
  const bound = selectedResponseDeliveryBound(env);
  const fits = (payload) => measureMcpInlineResultBytes(payload) <= bound;
  const journeys = new Map();
  const rememberJourney = (source, journey) => {
    journeys.delete(source.ref_id);
    journeys.set(source.ref_id, Object.freeze(journey));
    while (journeys.size > JOURNEY_CACHE_CAPACITY) journeys.delete(journeys.keys().next().value);
  };
  const sequences = new Map();
  const rememberSequence = (source, sequence) => {
    sequences.delete(source.ref_id);
    sequences.set(source.ref_id, Object.freeze(sequence));
    while (sequences.size > JOURNEY_CACHE_CAPACITY) sequences.delete(sequences.keys().next().value);
  };
  const journeyFor = (source, expected) => {
    const known = journeys.get(source.ref_id);
    if (known !== undefined) return known;
    const journey = journeyOf(readSelectedResponseSource(source, { env, expected }).carrier);
    rememberJourney(source, journey);
    return journey;
  };
  const sequenceFor = (source, expected) => {
    const known = sequences.get(source.ref_id);
    if (known !== undefined) return known;
    const sequence = parameterReadSequence(selectedParameterContract(
      readSelectedResponseSource(source, { env, expected }).carrier));
    rememberSequence(source, sequence);
    return sequence;
  };

  function navigate(response, { expected, source }) {
    const page = response.page;
    const retained = page.retained_source;
    const base = { source: { ref_id: retained.ref_id, sha256: retained.sha256 },
      snapshot_identity: page.task_result_identity, collection: page.collection };
    const argumentsFor = (selection) => buildDetailArguments(
      { repository: retained.repository, unit: retained.unit }, selection);
    const rowProjection = Array.isArray(page.items)
      ? page.items.find((item) => item?.schema_version === ROW_PROJECTION_SCHEMA_VERSION) : undefined;
    if (rowProjection !== undefined) {
      response.descend = { tool: OBLIGATION_COVERAGE_QUERY_ROUTE,
        arguments: argumentsFor({ ...base, selector: { id: rowProjection.stable_id } }),
        field_path_from: "page.items[].fields[].path",
        note: "Add each listed field path as detail.field_path to read that value." };
    } else if (Array.isArray(page.fields) && page.fields.length > 0) {
      response.descend = { tool: OBLIGATION_COVERAGE_QUERY_ROUTE,
        arguments: argumentsFor({ ...base, ...(page.selector === null ? {} : { selector: page.selector }) }),
        field_path_from: "page.fields[].path",
        note: "Add each listed field path as detail.field_path to read that value." };
    }

    if (isParameterContractField(page) && response.next_calls.length === 0) {
      const sequence = sequenceFor(source, expected);
      const at = sequence.findIndex((fieldPath) => isDeepStrictEqual(fieldPath, page.field_path));
      const next = at < 0 ? undefined : sequence[at + 1];
      if (next !== undefined) {
        response.next_calls = [buildNextCall({ tool: OBLIGATION_COVERAGE_QUERY_ROUTE,
          arguments: argumentsFor({ ...base, selector: page.selector, field_path: next }), recommended: true })];
      }
    }
    const traversal = !Array.isArray(page.field_path) && (page.selector ?? null) === null;
    if (traversal && response.next_calls.length === 0) {
      const journey = journeyFor(source, expected);
      const next = journey[journey.indexOf(page.collection) + 1];
      if (next !== undefined) {
        response.next_calls = [buildNextCall({ tool: OBLIGATION_COVERAGE_QUERY_ROUTE,
          arguments: argumentsFor({ ...base, collection: next }), recommended: true })];
      }
    }
    if (!fits(response)) {
      throw new RangeError(`${OBLIGATION_COVERAGE_QUERY_ROUTE} detail navigation exceeds the complete-frame class`);
    }
    return response;
  }

  async function detail({ workspaceRepo, unit, authorityIdentity, detail: request }) {
    const expected = { route: OBLIGATION_COVERAGE_QUERY_ROUTE, repository: workspaceRepo, unit,
      authority_identity: authorityIdentity };
    const response = await session.detail({ expected, detail: request });
    return navigate(response, { expected, source: request.source });
  }

  async function publish({ workspaceRepo, carrier, view, queryIdentity, observationIdentity,
    authorityIdentity }) {
    const { next_calls: _ownerCalls, ...population } = canonicalJson(carrier);
    const complete = population.view === "inventory" ? population : { ...population, view };
    const whole = { ...complete, selected_detail: {
      schema_version: OBLIGATION_COVERAGE_QUERY_SELECTED_SUMMARY_SCHEMA_VERSION, complete: true } };
    if (fits(whole)) return whole;

    const binding = { route: OBLIGATION_COVERAGE_QUERY_ROUTE, repository: workspaceRepo,
      unit: complete.unit, query_identity: queryIdentity, observation_identity: observationIdentity,
      authority_identity: authorityIdentity };
    const { source, snapshot_identity: snapshotIdentity } = session.retain({ binding, carrier: complete });
    const journey = journeyOf(complete);
    rememberJourney(source, journey);
    rememberSequence(source, parameterReadSequence(selectedParameterContract(complete)));
    if (view === "complete") {
      return detail({ workspaceRepo, unit: complete.unit, authorityIdentity,
        detail: { source, snapshot_identity: snapshotIdentity, collection: journey[0] } });
    }

    const collections = selectedResponseCollectionCounts(complete);
    const inlined = REQUIRED_SUMMARY_MEMBERS.filter((member) => Object.hasOwn(complete, member));
    const optional = OPTIONAL_SUMMARY_MEMBERS.filter((member) => Object.hasOwn(complete, member));
    let omitted = [...optional];
    const identities = criterionIdentities(complete);
    let identitiesInline = false;

    const parameterSizes = parameterSelections(complete, queryIdentity);
    let parameter = parameterSizes[0] ?? null;
    const summaryFor = () => {

      const start = omitted.some((member) => member !== CRITERION_IDENTITIES_MEMBER) ? journey[0] : journey[1];
      const retrieval = start === undefined ? [] : [session.detailCall(binding,
        { source, snapshot_identity: snapshotIdentity, collection: start },
        { recommended: parameter === null })];
      const parameterReads = (parameter?.read ?? null) === null ? [] : [session.detailCall(binding,
        { source, snapshot_identity: snapshotIdentity, collection: PARAMETER_SELECTION_COLLECTION,
          selector: PARAMETER_SELECTION_SELECTOR, field_path: parameter.read })];
      return {
        ...Object.fromEntries(inlined.map((member) => [member, complete[member]])),
        ...(parameter === null ? {} : { parameter_selection: parameter.selection }),
        ...(identitiesInline ? { [CRITERION_IDENTITIES_MEMBER]: identities } : {}),
        selected_detail: {
          schema_version: OBLIGATION_COVERAGE_QUERY_SELECTED_SUMMARY_SCHEMA_VERSION,
          complete: false,
          source,
          snapshot_identity: snapshotIdentity,
          collections,
          omitted_members: omitted,
          complete_retrieval: parameter === null
            ? "Follow next_calls: each page names the next page or collection until none remain."
            : "next_calls[0] reads parameter_selection.not_inline, each page naming the next; complete " +
              "retrieval starts at the collection call."
        },
        next_calls: [...parameterReads, ...retrieval]
      };
    };
    for (const size of parameterSizes) {
      parameter = size;
      if (fits(summaryFor())) break;
    }
    if (!fits(summaryFor())) {
      throw new RangeError(`${OBLIGATION_COVERAGE_QUERY_ROUTE} summary exceeds the complete-frame class`);
    }

    if (identities !== null) {
      identitiesInline = true;
      if (!fits(summaryFor())) {
        identitiesInline = false;
        omitted = [CRITERION_IDENTITIES_MEMBER, ...omitted];
      }
    }
    for (const member of optional) {
      inlined.push(member);
      const previous = omitted;
      omitted = omitted.filter((candidate) => candidate !== member);
      if (!fits(summaryFor())) {
        inlined.pop();
        omitted = previous;
      }
    }
    return summaryFor();
  }

  return Object.freeze({ publish, detail, session, requestSchema, bound });
}
