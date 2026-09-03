import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES
} from "@agent-chassis/controlled-contract";
import {
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";

export const INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS = Object.freeze({
  registered_routes: "wiki-core.registered-controlled-contract-routes.v1",
  role_tool_profiles: "wiki-core.exact-session-role-tool-profiles.v1",
  result_schema_population: "controlled-contract.integration-test-design-result-schema.v1",
  declared_mutants: "wiki-core.manifest-selected-declared-mutants.v1"
});

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function stableUnique(values) {
  return [...new Set(values)].sort();
}

function providerResult({
  censusId,
  axis,
  providerId,
  ownerId,
  generationId,
  sourceKind,
  members,
  completeness = "complete",
  omissions = [],
  currentness = "current"
}) {
  const normalizedMembers = [...members].map((member) => ({
    member_id: member.member_id,
    obligation_ids: stableUnique(member.obligation_ids ?? []),
    ...(member.source_test_proof_id === undefined
      ? {} : { source_test_proof_id: member.source_test_proof_id }),
    ...(member.required_before === undefined
      ? {} : { required_before: member.required_before })
  })).sort((left, right) => left.member_id < right.member_id ? -1
    : left.member_id > right.member_id ? 1 : 0);
  const population = {
    census_id: censusId,
    axis,
    provider_id: providerId,
    owner_id: ownerId,
    generation_id: generationId,
    source_kind: sourceKind,
    members: normalizedMembers,
    member_count: normalizedMembers.length,
    completeness,
    omissions: stableUnique(omissions),
    currentness
  };
  return Object.freeze({
    ...population,
    content_digest: controlledContractContentDigest(population)
  });
}

function routeObligations(resolvedFacts) {
  return resolvedFacts.rows.filter((row) =>
    row.mechanism?.kind === "tool_operation" &&
    typeof row.mechanism.selector === "string"
  );
}

async function registeredRouteProvider({ repoRoot, resolvedFacts, readJsonFile = readJson }) {
  const descriptor = await readJsonFile(path.resolve(
    repoRoot, "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json"
  ));
  const rows = routeObligations(resolvedFacts);
  const descriptorRows = Array.isArray(descriptor.tools) ? descriptor.tools : [];
  const routeNames = descriptorRows.flatMap(({ tool_name: name } = {}) =>
    typeof name === "string" && name.length > 0 ? [name] : []
  );
  const registered = new Set(routeNames);
  const obligationsByRoute = new Map();
  for (const row of rows) {
    const route = row.mechanism.selector;
    obligationsByRoute.set(route, [
      ...(obligationsByRoute.get(route) ?? []), row.obligation_id
    ]);
  }
  const omissions = [];
  const duplicateRoutes = routeNames.filter((route, index) =>
    routeNames.indexOf(route) !== index
  );
  if (!Array.isArray(descriptor.tools)) omissions.push("descriptor tools is not an array");
  if (routeNames.length !== descriptorRows.length) {
    omissions.push("descriptor contains a tool without a valid tool_name identity");
  }
  for (const route of stableUnique(duplicateRoutes)) {
    omissions.push(`descriptor contains duplicate tool identity: ${route}`);
  }
  for (const row of rows) {
    const route = row.mechanism.selector;
    if (!registered.has(route)) {
      omissions.push(`canonical tool operation is not registered: ${route}`);
    }
  }
  const members = stableUnique(routeNames).map((route) => ({
    member_id: route,
    obligation_ids: obligationsByRoute.get(route) ?? []
  }));
  const descriptorCurrent = Number.isInteger(descriptor.tool_count) &&
    descriptor.tool_count === descriptorRows.length &&
    omissions.length === 0;
  return providerResult({
    censusId: "server:registered-routes",
    axis: "registered_routes",
    providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS.registered_routes,
    ownerId: "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json",
    generationId: descriptor.schema_version ?? "unknown",
    sourceKind: "repository_registry_derived",
    members,
    completeness: omissions.length === 0 && descriptorCurrent ? "complete" : "partial",
    omissions: [
      ...omissions,
      ...(descriptorCurrent ? [] : ["descriptor tool_count does not match its exact population"])
    ],
    currentness: descriptorCurrent ? "current" : "non_current"
  });
}

function unavailableProviderResult(axis, error, repoRoot) {
  const [censusId, ownerId, sourceKind] = {
    registered_routes: ["server:registered-routes",
      "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json",
      "repository_registry_derived"],
    role_tool_profiles: ["server:role-tool-profiles",
      "packages/wiki-core/data/tool-discovery/session-role-tool-access.json",
      "repository_registry_derived"],
    result_schema_population: ["package:integration-test-design-result-states",
      "packages/controlled-contract/schema/" +
        "integration-test-design-assessment-result.experimental.v0.1.schema.json",
      "schema_derived"],
    declared_mutants: ["canonical:manifest-selected-declared-mutants",
      "manifest-selected-controlled-contract.test_proofs.falsifiers",
      "canonical_closed_set"]
  }[axis];
  const cause = typeof error?.code === "string" ? error.code
    : typeof error?.name === "string" ? error.name : "unknown_error";
  const message = typeof error?.message === "string"
    ? error.message.replaceAll(repoRoot, "<repo>") : "no error message";
  return providerResult({
    censusId,
    axis,
    providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS[axis],
    ownerId,
    generationId: "unavailable",
    sourceKind,
    members: [],
    completeness: "partial",
    omissions: [`provider denominator unavailable [${cause}]: ${message}`.slice(0, 512)],
    currentness: "non_current"
  });
}

async function roleToolProfileProvider({ repoRoot, resolvedFacts, priorResults,
  readJsonFile = readJson }) {
  const policy = await readJsonFile(path.resolve(
    repoRoot, "packages/wiki-core/data/tool-discovery/session-role-tool-access.json"
  ));
  const routeResult = priorResults.get("registered_routes");
  if (!routeResult || routeResult.completeness !== "complete" ||
      routeResult.currentness !== "current") {
    return providerResult({
      censusId: "server:role-tool-profiles",
      axis: "role_tool_profiles",
      providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS.role_tool_profiles,
      ownerId: "packages/wiki-core/data/tool-discovery/session-role-tool-access.json",
      generationId: policy.policy_id ?? policy.schema_version ?? "unknown",
      sourceKind: "repository_registry_derived",
      members: [],
      completeness: "partial",
      omissions: ["registered-route provider is not complete and current"],
      currentness: "non_current"
    });
  }
  const roles = Array.isArray(policy.roles) ? policy.roles : [];
  const members = [];
  const omissions = [];
  for (const route of routeResult.members) {
    if (!Object.hasOwn(policy.access ?? {}, route.member_id)) {
      omissions.push(`role policy has no exact route entry: ${route.member_id}`);
      continue;
    }
    const allowed = policy.access[route.member_id];
    for (const role of roles) {
      if (!allowed.includes(role)) continue;
      members.push({
        member_id: `${role}:${route.member_id}`,
        obligation_ids: route.obligation_ids
      });
    }
  }
  const policyCurrent = roles.every((role) => typeof role === "string") &&
    Object.values(policy.access ?? {}).every((value) => Array.isArray(value));
  return providerResult({
    censusId: "server:role-tool-profiles",
    axis: "role_tool_profiles",
    providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS.role_tool_profiles,
    ownerId: "packages/wiki-core/data/tool-discovery/session-role-tool-access.json",
    generationId: policy.policy_id ?? policy.schema_version ?? "unknown",
    sourceKind: "repository_registry_derived",
    members,
    completeness: omissions.length === 0 && policyCurrent ? "complete" : "partial",
    omissions,
    currentness: policyCurrent ? "current" : "non_current"
  });
}

async function resultSchemaProvider({ resolvedFacts }) {
  const resultObligationIds = resolvedFacts.rows.filter((row) =>
    row.mechanism?.kind === "schema" &&
    row.mechanism.selector ===
      "integration-test-design-assessment-result.experimental.v0.1.schema.json"
  ).map(({ obligation_id: id }) => id);
  return providerResult({
    censusId: "package:integration-test-design-result-states",
    axis: "result_schema_population",
    providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS.result_schema_population,
    ownerId:
      "packages/controlled-contract/schema/" +
      "integration-test-design-assessment-result.experimental.v0.1.schema.json",
    generationId: INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION,
    sourceKind: "schema_derived",
    members: INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES.map((state) => ({
      member_id: state,
      obligation_ids: resultObligationIds
    }))
  });
}

async function declaredMutantProvider({ resolvedFacts }) {
  const members = [];
  for (const proof of resolvedFacts.contract.content.test_proofs ?? []) {
    const obligationIds = resolvedFacts.rows.filter((row) =>
      row.controlled_contract_node_ids?.includes(proof.verification_claim_id)
    ).map(({ obligation_id: id }) => id);
    for (const falsifier of proof.falsifiers ?? []) {
      const mutationId = falsifier.mutation?.mutation_id;
      if (typeof mutationId !== "string") continue;
      members.push({
        member_id: mutationId,
        obligation_ids: obligationIds,
        source_test_proof_id: proof.test_proof_id
      });
    }
  }
  const duplicateIds = members.map(({ member_id: id }) => id)
    .filter((id, index, rows) => rows.indexOf(id) !== index);
  const generation = resolvedFacts.canonicalSet.generation?.id ??
    resolvedFacts.canonicalSet.generation;
  return providerResult({
    censusId: "canonical:manifest-selected-declared-mutants",
    axis: "declared_mutants",
    providerId: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS.declared_mutants,
    ownerId: "manifest-selected-controlled-contract.test_proofs.falsifiers",
    generationId: String(generation),
    sourceKind: "canonical_closed_set",
    members,
    completeness: duplicateIds.length === 0 ? "complete" : "ambiguous",
    omissions: duplicateIds.map((id) => `duplicate mutation identity: ${id}`),
    currentness: resolvedFacts.sourceCurrent ? "current" : "non_current"
  });
}

export const INTEGRATION_TEST_DESIGN_CENSUS_PROVIDERS = Object.freeze({
  registered_routes: registeredRouteProvider,
  role_tool_profiles: roleToolProfileProvider,
  result_schema_population: resultSchemaProvider,
  declared_mutants: declaredMutantProvider
});

export async function collectIntegrationTestDesignCensuses({
  repoRoot,
  resolvedFacts,
  axisApplicability,
  providers = INTEGRATION_TEST_DESIGN_CENSUS_PROVIDERS,
  readJsonFile = readJson
}) {
  const results = new Map();
  for (const applicability of [...axisApplicability].sort((left, right) =>
    left.axis < right.axis ? -1 : left.axis > right.axis ? 1 : 0
  )) {
    if (applicability.status !== "required") continue;
    const provider = providers[applicability.axis];
    if (typeof provider !== "function") continue;
    let result;
    try {
      result = await provider({
        repoRoot,
        resolvedFacts,
        priorResults: results,
        readJsonFile
      });
      if (result.axis !== applicability.axis ||
          result.provider_id !== INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS[applicability.axis]) {
        throw new Error(`registered census provider returned a mismatched identity for ${applicability.axis}`);
      }
    } catch (error) {
      result = unavailableProviderResult(applicability.axis, error, repoRoot);
    }
    results.set(applicability.axis, result);
  }
  return Object.freeze([...results.values()]);
}
