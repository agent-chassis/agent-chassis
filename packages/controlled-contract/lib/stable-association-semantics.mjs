import {
  StableSemanticError,
  canonicalizeStableValue,
  compareCodeUnits,
  stableSemanticKey
} from "./equality-normalization-v1.mjs";
import {
  assertStableSemanticWork,
  requireCompleteAuthority
} from "./population-semantics-v1.mjs";

function refuse(code, message, details = {}) {
  throw new StableSemanticError(code, message, details);
}

function buildExactAssociationGraph({
  graph_id: graphId,
  role_populations: rolePopulations,
  associations
}) {
  if (typeof graphId !== "string" || graphId.length === 0 ||
      !rolePopulations || typeof rolePopulations !== "object" ||
      Array.isArray(rolePopulations) || !Array.isArray(associations)) refuse(
    "stable_association_graph_invalid", "an exact association graph has one closed shape"
  );
  const roles = Object.keys(rolePopulations).sort(compareCodeUnits);
  if (roles.length < 2) refuse(
    "stable_association_roles_incomplete", "multi-role iteration requires at least two roles"
  );
  const incidenceWork = associations.length * roles.length;
  assertStableSemanticWork(incidenceWork, "stable_association_work_limit_exceeded");
  const allowed = new Map();
  for (const role of roles) {
    const population = rolePopulations[role];
    requireCompleteAuthority(population);
    allowed.set(role, new Set(population.members.map((member) =>
      stableSemanticKey(member.occurrence_id ?? member)
    )));
  }
  const rowIds = new Set();
  const rowKeys = new Set();
  const incidence = new Map(roles.map((role) => [role, new Map()]));
  const normalizedRows = [];
  for (const [index, row] of associations.entries()) {
    if (typeof row?.association_id !== "string" ||
        !row.roles || typeof row.roles !== "object" || Array.isArray(row.roles) ||
        JSON.stringify(Object.keys(row.roles).sort(compareCodeUnits)) !==
          JSON.stringify(roles)) refuse(
      "stable_association_row_invalid", "association rows must bind every exact role", { index }
    );
    if (rowIds.has(row.association_id)) refuse(
      "stable_association_duplicate", "association identities must be unique", { index }
    );
    rowIds.add(row.association_id);
    const roleValues = Object.fromEntries(roles.map((role) => {
      const value = row.roles[role];
      const key = stableSemanticKey(value);
      if (!allowed.get(role).has(key)) refuse(
        "stable_association_member_unknown",
        "association roles may bind only members of their dominating complete population",
        { index, role, occurrence_id: value }
      );
      const count = incidence.get(role).get(key) ?? 0;
      incidence.get(role).set(key, count + 1);
      return [role, value];
    }));
    const rowKey = stableSemanticKey(roleValues);
    if (rowKeys.has(rowKey)) refuse(
      "stable_association_duplicate", "duplicate correlation rows are forbidden", { index }
    );
    rowKeys.add(rowKey);
    normalizedRows.push({ association_id: row.association_id, roles: roleValues });
  }
  for (const role of roles) for (const key of allowed.get(role)) {
    const count = incidence.get(role).get(key) ?? 0;
    if (count === 0) refuse(
      "stable_association_missing", "every iterated occurrence requires one correlation row",
      { role, occurrence_identity: key }
    );
    if (count > 1) refuse(
      "stable_association_ambiguous",
      "an occurrence cannot have multiple valid targets in one exact graph",
      { role, occurrence_identity: key, count }
    );
  }
  normalizedRows.sort((left, right) => compareCodeUnits(
    left.association_id, right.association_id
  ));
  return Object.freeze({
    graph_version: "controlled-contract.occurrence-association-graph.v1",
    graph_id: graphId,
    roles: Object.freeze(roles),
    association_count: normalizedRows.length,
    associations: Object.freeze(normalizedRows.map(
      (row) => Object.freeze(canonicalizeStableValue(row))
    ))
  });
}

export { buildExactAssociationGraph };
