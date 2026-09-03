import { isDeepStrictEqual } from "node:util";

export const MCP_CALLABLE_CONTRACT_CONFORMANCE_SCHEMA_VERSION =
  "mcp-callable-contract-conformance.v1";
export const MCP_CALLABLE_CONTRACT_INPUT_SCHEMA_VERSION =
  "mcp-callable-contract-conformance-input.v1";

export const MCP_CALLABLE_REPRESENTATION_IDS = Object.freeze([
  "published_schema",
  "discovery",
  "route_validation",
  "handler_acceptance",
  "public_result"
]);

export const MCP_CALLABLE_CONFORMANCE_CLAIM_IDS = Object.freeze([
  "claim-component-exists",
  "claim-population",
  "claim-representations",
  "claim-recovery",
  "claim-ownership",
  "claim-retrieval",
  "claim-integrity",
  "claim-visibility",
  "claim-seed"
]);

const NON_COMPONENT_CLAIMS = MCP_CALLABLE_CONFORMANCE_CLAIM_IDS.slice(1);
const REPRESENTATION_SET = new Set(MCP_CALLABLE_REPRESENTATION_IDS);
const CLAIM_SET = new Set(MCP_CALLABLE_CONFORMANCE_CLAIM_IDS);
const EXCLUSION_KINDS = new Set(["role", "tier", "unsupported_runtime"]);
const FACT_KINDS = new Set([
  "argument",
  "constraint",
  "corrected_call",
  "recovery_fact",
  "recovery_actor",
  "failure_classification",
  "next_call",
  "prose_call",
  "bounded_retrieval",
  "population",
  "visibility",
  "owner_fact"
]);
const COLLECTION_IDS = Object.freeze([
  "population",
  "visibility_omissions",
  "owner_facts",
  "representation_facts",
  "supported_calls",
  "diagnostics",
  "claims"
]);
const MAX_PAGE_SIZE = 100;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableString(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function exactStringSet(value, allowed) {
  return Array.isArray(value) && new Set(value).size === value.length &&
    value.every((entry) => stableString(entry) && allowed.has(entry));
}

function callableValue(value) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join(",") === "arguments,tool_name" &&
    stableString(value.tool_name) && isPlainObject(value.arguments) && isJsonValue(value.arguments);
}

function mismatchCode(ownerFact, representationId, actual) {
  if (ownerFact.fact_kind === "argument" &&
      ["route_validation", "handler_acceptance"].includes(representationId)) {
    return "mcp_callable_contract.advertised_argument_rejected.v1";
  }
  if (ownerFact.fact_kind === "constraint" && representationId === "discovery") {
    return "mcp_callable_contract.accepted_constraint_undiscoverable.v1";
  }
  if (ownerFact.fact_kind === "corrected_call" && representationId === "public_result") {
    return "mcp_callable_contract.supported_corrected_call_hidden.v1";
  }
  if (ownerFact.fact_kind === "recovery_fact") {
    return "mcp_callable_contract.owner_recovery_fact_altered.v1";
  }
  if (ownerFact.fact_kind === "recovery_actor" && ownerFact.value === "caller" &&
      (actual?.value === "operator" || actual?.value === "no_supported_route")) {
    return "mcp_callable_contract.caller_failure_flattened_to_operator_recovery.v1";
  }
  if (ownerFact.fact_kind === "failure_classification" &&
      ownerFact.value === "internal_failure" && actual?.value === "invalid_public_input") {
    return "mcp_callable_contract.internal_failure_confused_with_invalid_public_input.v1";
  }
  return actual === undefined
    ? "mcp_callable_contract.representation_fact_missing.v1"
    : "mcp_callable_contract.representation_fact_mismatch.v1";
}

function sorted(values, key) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

export function evaluateMcpCallableContractConformance(input, window = {}) {
  const diagnostics = [];
  const addDiagnostic = (code, fields = {}, claimIds = ["claim-integrity"]) => {
    diagnostics.push({
      schema_version: "mcp-callable-contract-diagnostic.v1",
      code,
      claim_ids: [...new Set(["claim-integrity", ...claimIds])].sort(),
      ...fields
    });
  };

  const source = isPlainObject(input) ? input : {};
  if (!isPlainObject(input) || source.schema_version !== MCP_CALLABLE_CONTRACT_INPUT_SCHEMA_VERSION) {
    addDiagnostic("mcp_callable_contract.input_schema_invalid.v1");
  }

  const inventory = isPlainObject(source.inventory) ? source.inventory : {};
  const hasMemberInventory = Array.isArray(inventory.registered_member_ids);
  const hasFactInventory = Array.isArray(inventory.owner_fact_ids);
  const expectedMemberIds = hasMemberInventory ? inventory.registered_member_ids : [];
  const expectedFactIds = hasFactInventory ? inventory.owner_fact_ids : [];
  if (!hasMemberInventory || !exactStringSet(expectedMemberIds, new Set(expectedMemberIds))) {
    addDiagnostic("mcp_callable_contract.population_inventory_unparsable.v1", {}, ["claim-population"]);
  }
  if (!hasFactInventory || !exactStringSet(expectedFactIds, new Set(expectedFactIds))) {
    addDiagnostic("mcp_callable_contract.owner_fact_inventory_unparsable.v1", {}, ["claim-ownership"]);
  }

  const expectedMemberSet = new Set(expectedMemberIds);
  const populationInput = Array.isArray(source.population) ? source.population : [];
  if (!Array.isArray(source.population)) {
    addDiagnostic("mcp_callable_contract.population_unparsable.v1", {}, ["claim-population"]);
  }
  const population = [];
  const membersById = new Map();
  for (const [index, member] of populationInput.entries()) {
    if (!isPlainObject(member) || !stableString(member.member_id) ||
        !stableString(member.tool_name) || !stableString(member.role) || !stableString(member.tier) ||
        !["included", "excluded"].includes(member.visibility)) {
      addDiagnostic("mcp_callable_contract.population_member_unparsable.v1", { index }, ["claim-population"]);
      continue;
    }
    if (member.member_id !== `${member.role}:${member.tier}:${member.tool_name}`) {
      addDiagnostic("mcp_callable_contract.population_member_contradictory.v1",
        { member_id: member.member_id }, ["claim-population"]);
    }
    if (membersById.has(member.member_id)) {
      addDiagnostic("mcp_callable_contract.population_member_contradictory.v1",
        { member_id: member.member_id }, ["claim-population"]);
      continue;
    }
    const validOmission = isPlainObject(member.omission) &&
      EXCLUSION_KINDS.has(member.omission.kind) && stableString(member.omission.owner_id) &&
      stableString(member.omission.reason_code);
    const normalizedMember = {
      member_id: member.member_id,
      tool_name: member.tool_name,
      role: member.role,
      tier: member.tier,
      visibility: member.visibility,
      ...(member.visibility === "excluded" && validOmission
        ? { omission: {
            kind: member.omission.kind,
            owner_id: member.omission.owner_id,
            reason_code: member.omission.reason_code
          } }
        : {})
    };
    membersById.set(member.member_id, normalizedMember);
    population.push(normalizedMember);
    if (!expectedMemberSet.has(member.member_id)) {
      addDiagnostic("mcp_callable_contract.population_member_unprojectable.v1",
        { member_id: member.member_id }, ["claim-population"]);
    }
    if ((member.visibility === "included" && member.omission !== undefined) ||
        (member.visibility === "excluded" && !validOmission)) {
      addDiagnostic("mcp_callable_contract.visibility_disclosure_invalid.v1",
        { member_id: member.member_id }, ["claim-visibility"]);
    }
  }
  for (const memberId of expectedMemberIds) {
    if (!membersById.has(memberId)) {
      addDiagnostic("mcp_callable_contract.population_member_missing.v1",
        { member_id: memberId }, ["claim-population"]);
    }
  }
  const included = population.filter((member) => member.visibility === "included");
  const excluded = population.filter((member) => member.visibility === "excluded");
  const includedIds = new Set(included.map((member) => member.member_id));
  const includedToolNames = new Set(included.map((member) => member.tool_name));

  const supportedCallsInput = Array.isArray(source.supported_calls) ? source.supported_calls : [];
  if (!Array.isArray(source.supported_calls)) {
    addDiagnostic("mcp_callable_contract.supported_calls_unparsable.v1", {}, ["claim-recovery"]);
  }
  const supportedCalls = [];
  for (const [index, call] of supportedCallsInput.entries()) {
    if (!callableValue(call)) {
      addDiagnostic("mcp_callable_contract.supported_call_unparsable.v1", { index }, ["claim-recovery"]);
      continue;
    }
    if (!includedToolNames.has(call.tool_name)) {
      addDiagnostic("mcp_callable_contract.supported_call_unprojectable.v1",
        { tool_name: call.tool_name }, ["claim-recovery"]);
      continue;
    }
    if (!supportedCalls.some((entry) => isDeepStrictEqual(entry, call))) supportedCalls.push(call);
  }
  const isSupportedCall = (call) => callableValue(call) &&
    supportedCalls.some((entry) => isDeepStrictEqual(entry, call));

  const ownerFactsInput = Array.isArray(source.owner_facts) ? source.owner_facts : [];
  if (!Array.isArray(source.owner_facts)) {
    addDiagnostic("mcp_callable_contract.owner_facts_unparsable.v1", {}, ["claim-ownership"]);
  }
  const ownerFacts = [];
  const ownerFactsById = new Map();
  const expectedFactSet = new Set(expectedFactIds);
  for (const [index, fact] of ownerFactsInput.entries()) {
    if (!isPlainObject(fact) || !stableString(fact.fact_id) || !stableString(fact.member_id) ||
        !stableString(fact.owner_id) || !FACT_KINDS.has(fact.fact_kind) ||
        !isJsonValue(fact.value) || !exactStringSet(fact.required_representations, REPRESENTATION_SET) ||
        fact.required_representations.length === 0 ||
        !exactStringSet(fact.claim_ids, CLAIM_SET) || fact.claim_ids.length === 0) {
      addDiagnostic("mcp_callable_contract.owner_fact_unparsable.v1", { index }, ["claim-ownership"]);
      continue;
    }
    if (ownerFactsById.has(fact.fact_id)) {
      addDiagnostic("mcp_callable_contract.owner_fact_contradictory.v1",
        { fact_id: fact.fact_id }, ["claim-ownership"]);
      continue;
    }
    const normalizedFact = {
      fact_id: fact.fact_id,
      member_id: fact.member_id,
      owner_id: fact.owner_id,
      fact_kind: fact.fact_kind,
      value: fact.value,
      required_representations: [...fact.required_representations],
      claim_ids: [...fact.claim_ids]
    };
    ownerFactsById.set(fact.fact_id, normalizedFact);
    ownerFacts.push(normalizedFact);
    if (!expectedFactSet.has(fact.fact_id) || !includedIds.has(fact.member_id)) {
      addDiagnostic("mcp_callable_contract.owner_fact_unprojectable.v1",
        { fact_id: fact.fact_id, member_id: fact.member_id }, fact.claim_ids);
    }
    const calls = ["corrected_call", "next_call", "prose_call"].includes(normalizedFact.fact_kind)
      ? [normalizedFact.value]
      : normalizedFact.fact_kind === "bounded_retrieval" && isPlainObject(normalizedFact.value)
        ? [normalizedFact.value.next_call]
        : [];
    for (const call of calls) {
      if (!isSupportedCall(call)) {
        const code = normalizedFact.fact_kind === "bounded_retrieval"
          ? "mcp_callable_contract.bounded_retrieval_route_unsupported.v1"
          : normalizedFact.fact_kind === "prose_call"
            ? "mcp_callable_contract.unsupported_prose_call.v1"
            : "mcp_callable_contract.unsupported_next_call.v1";
        addDiagnostic(code, { fact_id: fact.fact_id }, fact.claim_ids);
      }
    }
    if (normalizedFact.fact_kind === "bounded_retrieval" &&
        (!isPlainObject(normalizedFact.value) || !Number.isInteger(normalizedFact.value.complete_count) ||
         normalizedFact.value.complete_count < 0)) {
      addDiagnostic("mcp_callable_contract.bounded_retrieval_unparsable.v1",
        { fact_id: fact.fact_id }, fact.claim_ids);
    }
  }
  for (const factId of expectedFactIds) {
    if (!ownerFactsById.has(factId)) {
      addDiagnostic("mcp_callable_contract.owner_fact_missing.v1",
        { fact_id: factId }, ["claim-ownership", "claim-integrity"]);
    }
  }

  const representationFacts = [];
  const actualByJoin = new Map();
  const representations = isPlainObject(source.representations) ? source.representations : {};
  if (!isPlainObject(source.representations)) {
    addDiagnostic("mcp_callable_contract.representations_unparsable.v1", {}, ["claim-representations"]);
  }
  for (const representationId of Object.keys(representations)) {
    if (!REPRESENTATION_SET.has(representationId)) {
      addDiagnostic("mcp_callable_contract.representation_unprojectable.v1",
        { representation_id: representationId }, ["claim-representations"]);
    }
  }
  for (const representationId of MCP_CALLABLE_REPRESENTATION_IDS) {
    const rows = Array.isArray(representations[representationId])
      ? representations[representationId] : [];
    if (!Array.isArray(representations[representationId])) {
      addDiagnostic("mcp_callable_contract.representation_missing.v1",
        { representation_id: representationId }, ["claim-representations"]);
    }
    const seenMembers = new Set();
    for (const [index, row] of rows.entries()) {
      if (!isPlainObject(row) || !stableString(row.member_id) || !Array.isArray(row.facts)) {
        addDiagnostic("mcp_callable_contract.representation_member_unparsable.v1",
          { representation_id: representationId, index }, ["claim-representations"]);
        continue;
      }
      if (seenMembers.has(row.member_id)) {
        addDiagnostic("mcp_callable_contract.representation_member_contradictory.v1",
          { representation_id: representationId, member_id: row.member_id }, ["claim-representations"]);
        continue;
      }
      seenMembers.add(row.member_id);
      if (!includedIds.has(row.member_id)) {
        addDiagnostic("mcp_callable_contract.representation_member_unprojectable.v1",
          { representation_id: representationId, member_id: row.member_id }, ["claim-representations"]);
      }
      const seenFacts = new Set();
      for (const [factIndex, actual] of row.facts.entries()) {
        if (!isPlainObject(actual) || !stableString(actual.fact_id) ||
            !stableString(actual.owner_id) || !FACT_KINDS.has(actual.fact_kind) ||
            !isJsonValue(actual.value)) {
          addDiagnostic("mcp_callable_contract.representation_fact_unparsable.v1",
            { representation_id: representationId, member_id: row.member_id, index: factIndex },
            ["claim-representations"]);
          continue;
        }
        if (seenFacts.has(actual.fact_id)) {
          addDiagnostic("mcp_callable_contract.representation_fact_contradictory.v1",
            { representation_id: representationId, member_id: row.member_id,
              fact_id: actual.fact_id }, ["claim-representations"]);
          continue;
        }
        seenFacts.add(actual.fact_id);
        if (!actualByJoin.has(representationId)) actualByJoin.set(representationId, new Map());
        const actualByMember = actualByJoin.get(representationId);
        if (!actualByMember.has(row.member_id)) actualByMember.set(row.member_id, new Map());
        actualByMember.get(row.member_id).set(actual.fact_id, actual);
        representationFacts.push({
          representation_id: representationId,
          member_id: row.member_id,
          fact_id: actual.fact_id,
          owner_id: actual.owner_id,
          fact_kind: actual.fact_kind,
          value: actual.value
        });
        const ownerFact = ownerFactsById.get(actual.fact_id);
        if (!ownerFact || ownerFact.member_id !== row.member_id ||
            !ownerFact.required_representations.includes(representationId)) {
          addDiagnostic("mcp_callable_contract.representation_fact_unprojectable.v1",
            { representation_id: representationId, member_id: row.member_id,
              fact_id: actual.fact_id }, ownerFact?.claim_ids);
          if (["next_call", "prose_call"].includes(actual.fact_kind) && !isSupportedCall(actual.value)) {
            addDiagnostic(actual.fact_kind === "prose_call"
              ? "mcp_callable_contract.unsupported_prose_call.v1"
              : "mcp_callable_contract.unsupported_next_call.v1",
            { representation_id: representationId, fact_id: actual.fact_id }, ["claim-recovery"]);
          }
        }
      }
    }
    for (const member of included) {
      if (!seenMembers.has(member.member_id)) {
        addDiagnostic("mcp_callable_contract.representation_member_missing.v1",
          { representation_id: representationId, member_id: member.member_id },
          ["claim-representations"]);
      }
    }
  }

  for (const fact of ownerFacts) {
    for (const representationId of fact.required_representations) {
      const actual = actualByJoin.get(representationId)?.get(fact.member_id)?.get(fact.fact_id);
      if (actual === undefined || actual.owner_id !== fact.owner_id ||
          actual.fact_kind !== fact.fact_kind || !isDeepStrictEqual(actual.value, fact.value)) {
        addDiagnostic(mismatchCode(fact, representationId, actual),
          { representation_id: representationId, member_id: fact.member_id,
            fact_id: fact.fact_id }, fact.claim_ids);
      }
      if (actual !== undefined && ["next_call", "prose_call"].includes(actual.fact_kind) &&
          !isSupportedCall(actual.value)) {
        addDiagnostic(actual.fact_kind === "prose_call"
          ? "mcp_callable_contract.unsupported_prose_call.v1"
          : "mcp_callable_contract.unsupported_next_call.v1",
        { representation_id: representationId, fact_id: fact.fact_id }, fact.claim_ids);
      }
    }
  }

  const boundClaims = new Set([
    "claim-population",
    "claim-visibility",
    ...ownerFacts.flatMap((fact) => fact.claim_ids)
  ]);
  for (const claimId of NON_COMPONENT_CLAIMS) {
    if (!boundClaims.has(claimId)) {
      addDiagnostic("mcp_callable_contract.claim_binding_missing.v1",
        { claim_id: claimId }, [claimId, "claim-integrity"]);
    }
  }

  const windowInput = isPlainObject(window) ? window : {};
  let collectionId = stableString(windowInput.collection) ? windowInput.collection : "diagnostics";
  let offset = Number.isInteger(windowInput.offset) && windowInput.offset >= 0 ? windowInput.offset : 0;
  let limit = Number.isInteger(windowInput.limit) && windowInput.limit >= 1 &&
      windowInput.limit <= MAX_PAGE_SIZE ? windowInput.limit : 50;
  if (!COLLECTION_IDS.includes(collectionId) ||
      !isPlainObject(window) ||
      (windowInput.offset !== undefined && offset !== windowInput.offset) ||
      (windowInput.limit !== undefined && limit !== windowInput.limit)) {
    addDiagnostic("mcp_callable_contract.result_window_invalid.v1", {}, ["claim-retrieval"]);
    collectionId = "diagnostics";
    offset = 0;
    limit = 50;
  }

  const sortedDiagnostics = sorted(diagnostics, (entry) =>
    [entry.code, entry.representation_id, entry.member_id, entry.fact_id, entry.claim_id]
      .map((value) => value ?? "").join("\u0000"));
  const claims = MCP_CALLABLE_CONFORMANCE_CLAIM_IDS.map((claimId) => ({
    claim_id: claimId,
    status: sortedDiagnostics.some((entry) => entry.claim_ids.includes(claimId))
      ? "failed" : "satisfied"
  }));
  const collections = {
    population: sorted(population, (entry) => entry.member_id),
    visibility_omissions: sorted(excluded.map((entry) => ({
      member_id: entry.member_id,
      tool_name: entry.tool_name,
      omission: entry.omission
    })), (entry) => entry.member_id),
    owner_facts: sorted(ownerFacts, (entry) => entry.fact_id),
    representation_facts: sorted(representationFacts, (entry) =>
      `${entry.representation_id}\u0000${entry.member_id}\u0000${entry.fact_id}`),
    supported_calls: sorted(supportedCalls, stableJson),
    diagnostics: sortedDiagnostics,
    claims
  };
  const pageItems = collections[collectionId].slice(offset, offset + limit);
  const collectionMetadata = COLLECTION_IDS.map((id) => ({
    collection: id,
    total_count: collections[id].length,
    initial_page: { collection: id, offset: 0, limit }
  }));
  const expectedFactsByRepresentation = Object.fromEntries(MCP_CALLABLE_REPRESENTATION_IDS.map(
    (id) => [id, ownerFacts.filter((fact) => fact.required_representations.includes(id)).length]
  ));
  const observedFactsByRepresentation = Object.fromEntries(MCP_CALLABLE_REPRESENTATION_IDS.map(
    (id) => [id, representationFacts.filter((fact) => fact.representation_id === id).length]
  ));

  return {
    schema_version: MCP_CALLABLE_CONTRACT_CONFORMANCE_SCHEMA_VERSION,
    status: sortedDiagnostics.length === 0 ? "conformant" : "nonconformant",
    summary: {
      registered: { expected_count: expectedMemberIds.length, observed_count: populationInput.length },
      included_count: included.length,
      excluded_count: excluded.length,
      excluded_by_kind: Object.fromEntries([...EXCLUSION_KINDS].map((kind) => [
        kind, excluded.filter((member) => member.omission?.kind === kind).length
      ])),
      owner_facts: { expected_count: expectedFactIds.length, observed_count: ownerFactsInput.length },
      representation_tool_counts: Object.fromEntries(MCP_CALLABLE_REPRESENTATION_IDS.map(
        (id) => [id, Array.isArray(representations[id]) ? representations[id].length : 0]
      )),
      expected_representation_fact_counts: expectedFactsByRepresentation,
      observed_representation_fact_counts: observedFactsByRepresentation,
      diagnostic_count: sortedDiagnostics.length,
      claim_count: claims.length,
      satisfied_claim_count: claims.filter((claim) => claim.status === "satisfied").length
    },
    claim_status: claims,
    retrieval: {
      schema_version: "bounded-collection-retrieval.v1",
      operation: "evaluateMcpCallableContractConformance",
      max_page_size: MAX_PAGE_SIZE,
      collections: collectionMetadata
    },
    page: {
      collection: collectionId,
      offset,
      limit,
      total_count: collections[collectionId].length,
      returned_count: pageItems.length,
      items: pageItems,
      next_page: offset + pageItems.length < collections[collectionId].length
        ? { collection: collectionId, offset: offset + pageItems.length, limit }
        : null
    }
  };
}
