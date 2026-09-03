import {
  ExactBindingError,
  canonicalValue,
  compareCodeUnits,
  deepFreeze,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const GRAPH_VERSION = "controlled-contract-projected-contract-graph.v1";
const GRAPH_SELECTION_TRACE_VERSION =
  "controlled-contract-profile-graph-selection-trace.v1";
const NODE_KINDS = Object.freeze([
  "claims", "collections", "propositions", "references", "relations"
]);
const IDENTIFIER_FIELD = Object.freeze({
  claims: "claim_id",
  collections: "collection_id",
  propositions: "proposition_id",
  references: "reference_id",
  relations: "relation_id"
});
const IDENTIFIER_PATTERN = Object.freeze({
  claims: /^claim-[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  collections: /^set-[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  propositions: /^prop-[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  references: /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  relations: /^rel-[a-z0-9]+(?:-[a-z0-9]+)*$/u
});
const CONTRACT_FIELD = Object.freeze({
  claims: "claims",
  collections: "collections",
  propositions: "propositions",
  references: "references",
  relations: "relations"
});
const ORDERED_OPERAND_OPERATOR = "reference:ordered_as";
const EQUALITY_SWEEP_BOUND = 4096;

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function assertCanonicalText(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "projected_graph_text_invalid",
    "projected graph text must be a nonempty canonical NFC string without NUL",
    { field }
  );
}

function assertCanonicalStrings(value, field) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCanonicalStrings(entry, `${field}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      assertCanonicalText(key, `${field}.${key}`);
      assertCanonicalStrings(value[key], `${field}.${key}`);
    }
    return;
  }
  if (typeof value === "string") assertCanonicalText(value, field);
}

function assertReferenceNode(node) {
  if (!exactKeys(node, ["reference_id", "type_term", "identity"]) ||
      !isPlainObject(node.identity) || typeof node.identity.kind !== "string" ||
      typeof node.type_term !== "string" || node.type_term.length === 0) fail(
    "projected_graph_node_shape_invalid",
    "a projected reference node is not a closed typed contract reference",
    { node_kind: "references" }
  );
}

function assertPropositionNode(node) {
  if (!exactKeys(node, [
    "proposition_id", "subject_reference_id", "operator", "applicability_context",
    "operands"
  ]) || typeof node.operator !== "string" || node.operator.length === 0 ||
      !IDENTIFIER_PATTERN.references.test(node.subject_reference_id ?? "") ||
      !exactKeys(node.applicability_context, ["mode", "operand_reference_ids"]) ||
      typeof node.applicability_context.mode !== "string" ||
      !Array.isArray(node.applicability_context.operand_reference_ids) ||
      node.applicability_context.operand_reference_ids.some((referenceId) =>
        !IDENTIFIER_PATTERN.references.test(referenceId ?? "")) ||
      !Array.isArray(node.operands) || node.operands.length === 0 ||
      node.operands.some((operand) => !isPlainObject(operand) ||
        typeof operand.kind !== "string")) fail(
    "projected_graph_node_shape_invalid",
    "a projected proposition node is not a closed controlled proposition",
    { node_kind: "propositions" }
  );
  for (const operand of node.operands) {
    if (operand.kind === "reference" &&
        !IDENTIFIER_PATTERN.references.test(operand.reference_id ?? "")) fail(
      "projected_graph_node_shape_invalid",
      "a projected proposition reference operand does not name a contract reference",
      { node_kind: "propositions", proposition_id: node.proposition_id }
    );
  }
}

function assertClaimNode(node) {
  const declarative = exactKeys(node, [
    "claim_id", "kind", "modality", "proposition_id"
  ]);
  const verification = exactKeys(node, [
    "claim_id", "kind", "modality", "proposition_id", "verification_method",
    "falsifying_proposition_id"
  ]);
  if (!(declarative || verification) ||
      !["behavior", "evidence", "verification"].includes(node.kind) ||
      !["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"].includes(node.modality) ||
      !IDENTIFIER_PATTERN.propositions.test(node.proposition_id ?? "") ||
      (node.kind === "verification") !== verification ||
      (verification && (typeof node.verification_method !== "string" ||
        !IDENTIFIER_PATTERN.propositions.test(node.falsifying_proposition_id ?? "")))) fail(
    "projected_graph_node_shape_invalid",
    "a projected claim node is not a closed declarative or verification claim",
    { node_kind: "claims" }
  );
}

function assertRelationNode(node) {
  if (!exactKeys(node, [
    "relation_id", "role", "source_claim_id", "target_claim_id"
  ]) || typeof node.role !== "string" || node.role.length === 0 ||
      !IDENTIFIER_PATTERN.claims.test(node.source_claim_id ?? "") ||
      !IDENTIFIER_PATTERN.claims.test(node.target_claim_id ?? "")) fail(
    "projected_graph_node_shape_invalid",
    "a projected relation node is not a closed contract relation",
    { node_kind: "relations" }
  );
}

function assertCollectionNode(node) {
  if (!exactKeys(node, [
    "collection_id", "collection_kind", "member_claim_ids"
  ], ["purpose"]) ||
      !["closed_set", "ordered_sequence"].includes(node.collection_kind) ||
      !Array.isArray(node.member_claim_ids) || node.member_claim_ids.length === 0 ||
      node.member_claim_ids.some((claimId) =>
        !IDENTIFIER_PATTERN.claims.test(claimId ?? "")) ||
      (node.purpose !== undefined && typeof node.purpose !== "string")) fail(
    "projected_graph_node_shape_invalid",
    "a projected collection node is not a closed contract collection",
    { node_kind: "collections" }
  );
}

const NODE_ASSERTIONS = Object.freeze({
  claims: assertClaimNode,
  collections: assertCollectionNode,
  propositions: assertPropositionNode,
  references: assertReferenceNode,
  relations: assertRelationNode
});

function assertProjectedContractGraph(value) {
  if (!exactKeys(value, ["schema_version", ...NODE_KINDS]) ||
      value.schema_version !== GRAPH_VERSION) fail(
    "projected_graph_shape_invalid",
    "a projected contract graph must be the closed registered graph document"
  );
  assertCanonicalStrings(
    Object.fromEntries(NODE_KINDS.map((kind) => [kind, value[kind]])), "graph"
  );
  for (const kind of NODE_KINDS) {
    const nodes = value[kind];
    if (!Array.isArray(nodes)) fail(
      "projected_graph_shape_invalid",
      "each projected contract graph node population must be an array",
      { node_kind: kind }
    );
    const identifiers = nodes.map((node) => {
      if (!isPlainObject(node)) fail(
        "projected_graph_node_shape_invalid",
        "projected contract graph nodes must be plain objects",
        { node_kind: kind }
      );
      const identifier = node[IDENTIFIER_FIELD[kind]];
      if (typeof identifier !== "string" ||
          !IDENTIFIER_PATTERN[kind].test(identifier)) fail(
        "projected_graph_node_identifier_invalid",
        "a projected contract graph node identifier is not a contract identifier",
        { node_kind: kind }
      );
      NODE_ASSERTIONS[kind](node);
      return identifier;
    });
    if (!sortedUnique(identifiers)) fail(
      "projected_graph_noncanonical",
      "projected contract graph nodes must be uniquely ordered by UTF-16 code units",
      { node_kind: kind }
    );
  }
  const referenceIds = new Set(value.references.map(
    ({ reference_id: referenceId }) => referenceId
  ));
  const propositionIds = new Set(value.propositions.map(
    ({ proposition_id: propositionId }) => propositionId
  ));
  const claimIds = new Set(value.claims.map(({ claim_id: claimId }) => claimId));
  const missing = [];
  const require = (present, nodeKind, identifier, owner) => {
    if (!present) missing.push({ node_kind: nodeKind, node_id: identifier, owner });
  };
  for (const proposition of value.propositions) {
    require(referenceIds.has(proposition.subject_reference_id), "references",
      proposition.subject_reference_id, proposition.proposition_id);
    for (const referenceId of proposition.applicability_context.operand_reference_ids) {
      require(referenceIds.has(referenceId), "references", referenceId,
        proposition.proposition_id);
    }
    for (const operand of proposition.operands) {
      if (operand.kind !== "reference") continue;
      require(referenceIds.has(operand.reference_id), "references",
        operand.reference_id, proposition.proposition_id);
    }
  }
  for (const claim of value.claims) {
    require(propositionIds.has(claim.proposition_id), "propositions",
      claim.proposition_id, claim.claim_id);
    if (claim.kind === "verification") require(
      propositionIds.has(claim.falsifying_proposition_id), "propositions",
      claim.falsifying_proposition_id, claim.claim_id
    );
  }
  for (const relation of value.relations) {
    require(claimIds.has(relation.source_claim_id), "claims",
      relation.source_claim_id, relation.relation_id);
    require(claimIds.has(relation.target_claim_id), "claims",
      relation.target_claim_id, relation.relation_id);
  }
  for (const collection of value.collections) {
    for (const claimId of collection.member_claim_ids) {
      require(claimIds.has(claimId), "claims", claimId, collection.collection_id);
    }
  }
  if (missing.length > 0) fail(
    "projected_graph_dependency_dangling",
    "a projected contract graph node depends on a node the projection did not emit",
    { missing: missing.slice(0, 16) }
  );
  return deepFreeze(structuredClone(value));
}

function normalizeGraphNode(kind, node) {
  if (kind === "propositions") {
    const normalized = structuredClone(node);
    normalized.applicability_context.operand_reference_ids = [
      ...normalized.applicability_context.operand_reference_ids
    ].sort(compareCodeUnits);
    if (normalized.operator !== ORDERED_OPERAND_OPERATOR) {
      normalized.operands = [...normalized.operands].map(canonicalValue).sort(
        (left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right))
      );
    }
    return canonicalValue(normalized);
  }
  if (kind === "collections" && node.collection_kind === "closed_set") {
    return canonicalValue({
      ...node,
      member_claim_ids: [...node.member_claim_ids].sort(compareCodeUnits)
    });
  }
  return canonicalValue(node);
}

function indexContractNodes(contract, kind) {
  const nodes = contract?.[CONTRACT_FIELD[kind]];
  const index = new Map();
  const duplicates = new Set();
  if (!Array.isArray(nodes)) return { index, duplicates, present: false };
  for (const node of nodes) {
    if (!isPlainObject(node)) continue;
    const identifier = node[IDENTIFIER_FIELD[kind]];
    if (typeof identifier !== "string") continue;
    if (index.has(identifier)) duplicates.add(identifier);
    else index.set(identifier, node);
  }
  return { index, duplicates, present: true };
}

function projectedGraphContractDiagnostics(graph, contract) {
  const diagnostics = [];
  const contractIndex = new Map();
  for (const kind of NODE_KINDS) {
    const indexed = indexContractNodes(contract, kind);
    contractIndex.set(kind, indexed);
    for (const identifier of [...indexed.duplicates].sort(compareCodeUnits)) {
      if (!graph[kind].some((node) => node[IDENTIFIER_FIELD[kind]] === identifier)) {
        continue;
      }
      diagnostics.push({
        code: "projected_graph_node_duplicate",
        node_kind: kind,
        node_id: identifier
      });
    }
  }
  for (const kind of NODE_KINDS) {
    const { index } = contractIndex.get(kind);
    for (const node of graph[kind]) {
      const identifier = node[IDENTIFIER_FIELD[kind]];
      const actual = index.get(identifier);
      if (actual === undefined) {
        diagnostics.push({
          code: "projected_graph_node_missing",
          node_kind: kind,
          node_id: identifier
        });
        continue;
      }
      let normalizedActual;
      try {
        normalizedActual = JSON.stringify(normalizeGraphNode(kind, actual));
      } catch {
        normalizedActual = null;
      }
      if (normalizedActual !== JSON.stringify(normalizeGraphNode(kind, node))) {
        diagnostics.push({
          code: "projected_graph_node_content_mismatch",
          node_kind: kind,
          node_id: identifier
        });
      }
    }
  }
  return diagnostics;
}

function mandatoryEqualityPropositions(contract) {
  const propositionById = new Map((contract?.propositions ?? [])
    .filter((proposition) => isPlainObject(proposition))
    .map((proposition) => [proposition.proposition_id, proposition]));
  return (contract?.claims ?? [])
    .filter((claim) => isPlainObject(claim) &&
      ["behavior", "evidence"].includes(claim.kind) && claim.modality === "MUST")
    .map((claim) => propositionById.get(claim.proposition_id))
    .filter((proposition) => proposition?.operator === "reference:equals" &&
      Array.isArray(proposition.operands) &&
      proposition.operands.every(({ kind }) => kind === "reference"));
}

function equalityComponents(propositions) {
  const parent = new Map();
  const find = (value) => {
    if (!parent.has(value)) parent.set(value, value);
    while (parent.get(value) !== value) {
      parent.set(value, parent.get(parent.get(value)));
      value = parent.get(value);
    }
    return value;
  };
  const union = (left, right) => {
    const [leftRoot, rightRoot] = [find(left), find(right)];
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const proposition of propositions) for (const operand of proposition.operands) {
    union(proposition.subject_reference_id, operand.reference_id);
  }
  const components = new Map();
  for (const referenceId of parent.keys()) {
    const root = find(referenceId);
    const members = components.get(root) ?? new Set();
    members.add(referenceId);
    components.set(root, members);
  }
  return components;
}

function projectedGraphEqualityDiagnostics(graph, contract, buildEqualityNormalization) {
  const projected = new Set(graph.references.map(
    ({ reference_id: referenceId }) => referenceId
  ));
  if (projected.size === 0) return [];
  const equalityPropositions = mandatoryEqualityPropositions(contract);
  if (equalityPropositions.length === 0) return [];
  const components = equalityComponents(equalityPropositions);
  const references = [...components.values()]
    .filter((members) => members.size > 1 &&
      [...members].some((referenceId) => projected.has(referenceId)))
    .flatMap((members) => [...members])
    .sort(compareCodeUnits);
  if (references.length === 0) return [];
  let normalization;
  try {
    normalization = buildEqualityNormalization(contract);
  } catch {
    return [{ code: "projected_graph_equality_unavailable" }];
  }
  const contexts = new Map([[
    JSON.stringify({ mode: "unconditional", operand_reference_ids: [] }),
    { mode: "unconditional", operand_reference_ids: [] }
  ]]);
  for (const proposition of equalityPropositions) {
    const context = proposition.applicability_context;
    if (!isPlainObject(context) || typeof context.mode !== "string" ||
        !Array.isArray(context.operand_reference_ids)) continue;
    const normalized = {
      mode: context.mode,
      operand_reference_ids: [...new Set(context.operand_reference_ids)]
        .sort(compareCodeUnits)
    };
    contexts.set(JSON.stringify(normalized), normalized);
  }

  if (references.length * contexts.size > EQUALITY_SWEEP_BOUND) return [{
    code: "projected_graph_equality_check_bounded",
    swept_reference_count: references.length,
    context_count: contexts.size,
    maximum_pairs: EQUALITY_SWEEP_BOUND
  }];
  const collisions = new Map();
  for (const context of contexts.values()) {
    const classes = new Map();
    for (const referenceId of references) {
      let canonicalId;
      try {
        canonicalId = normalization.canonicalize(referenceId, context);
      } catch {
        return [{ code: "projected_graph_equality_unavailable" }];
      }
      const members = classes.get(canonicalId) ?? [];
      members.push(referenceId);
      classes.set(canonicalId, members);
    }
    for (const members of classes.values()) {
      const projectedMembers = members.filter((referenceId) =>
        projected.has(referenceId));
      if (projectedMembers.length === 0 || members.length === 1) continue;
      for (const referenceId of projectedMembers) {
        const aliases = new Set(collisions.get(referenceId) ?? []);
        for (const member of members) if (member !== referenceId) aliases.add(member);
        collisions.set(referenceId, [...aliases].sort(compareCodeUnits));
      }
    }
  }
  return [...collisions.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([referenceId, aliases]) => ({
      code: "projected_graph_reference_equality_alias",
      node_kind: "references",
      node_id: referenceId,
      alias_reference_ids: aliases
    }));
}

function projectedGraphNodeIds(graph, kind) {
  return new Set(graph[kind].map((node) => node[IDENTIFIER_FIELD[kind]]));
}

export {
  GRAPH_SELECTION_TRACE_VERSION,
  GRAPH_VERSION,
  NODE_KINDS,
  assertProjectedContractGraph,
  normalizeGraphNode,
  projectedGraphContractDiagnostics,
  projectedGraphEqualityDiagnostics,
  projectedGraphNodeIds
};
