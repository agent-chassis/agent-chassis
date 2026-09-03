import {
  canonicalValue,
  compareCodeUnits,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import {
  MANDATORY_AUTHORITY_EXCLUSIONS
} from "./proof-aware-planning-policy.mjs";
import {
  CARRIER_VERSION,
  validateResolvedCarrier
} from "./proof-aware-planning-carrier.mjs";

const ANONYMOUS_VERSION =
  "controlled-contract-proof-aware-anonymous-planning-input.experimental.v2";
const ANONYMOUS_DOMAIN =
  "controlled-contract:proof-aware-anonymous-candidate:v2";
const ORBIT_INPUT_VERSION =
  "controlled-contract-proof-aware-orbit-refinement-input.experimental.v2";
const UNIT2_CANONICAL_HANDOFF_STATE_BOUND = 1_000_000;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestColor(value) {
  return domainSeparatedDigest("controlled-contract:proof-aware-color:v2", value);
}

function initialNodeColor(node) {
  return digestColor({
    node_kind: node.node_kind,
    subtype: node.subtype,
    state: node.state,
    facets: [...node.facets].sort(compareCodeUnits),
    weight: node.weight,
    pack_scoped: node.pack_instance_id !== null,
    branch_scoped: node.branch_scope_id !== null
  });
}

function edgeSignature(edge, nodeId, colors) {
  const outgoing = edge.source_node_id === nodeId;
  return {
    direction: outgoing ? "out" : "in",
    edge_kind: edge.edge_kind,
    state: edge.state,
    effect: edge.effect,
    facet: edge.facet,
    derivation_class: edge.derivation.rule_id,
    neighbor_color: colors.get(outgoing ? edge.target_node_id : edge.source_node_id)
  };
}

function incidenceSignature(incidence, nodeId, colors) {
  const occurrences = incidence.participants.filter(
    ({ node_id: participantId }) => participantId === nodeId
  );
  if (occurrences.length === 0) return null;
  const participants = incidence.participants.map((participant) => ({
    role: participant.role,
    position_path: participant.position_path,
    multiplicity: participant.multiplicity,
    attributes: participant.attributes,
    color: participant.node_id === nodeId ? "SELF" : colors.get(participant.node_id)
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
  return {
    incidence_kind: incidence.incidence_kind,
    state: incidence.state,
    effect: incidence.effect,
    facet: incidence.facet,
    derivation_class: incidence.derivation.rule_id,
    typed_attributes: incidence.typed_attributes,
    self_roles: occurrences.map(({ role, position_path: positionPath,
      multiplicity, attributes }) => ({ role, position_path: positionPath,
      multiplicity, attributes })).sort((left, right) => compareCodeUnits(
      JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
    )),
    participants
  };
}

function refineWithInitial(carrier, initial) {
  let colors = initial;
  let rounds = 0;
  for (; rounds <= carrier.nodes.length; rounds += 1) {
    const next = new Map();
    for (const node of carrier.nodes) {
      const edges = carrier.binary_edges.filter((edge) =>
        edge.source_node_id === node.node_id || edge.target_node_id === node.node_id
      ).map((edge) => edgeSignature(edge, node.node_id, colors)).sort(
        (left, right) => compareCodeUnits(JSON.stringify(canonicalValue(left)),
          JSON.stringify(canonicalValue(right)))
      );
      const incidences = carrier.typed_incidences.map((incidence) =>
        incidenceSignature(incidence, node.node_id, colors)
      ).filter(Boolean).sort((left, right) => compareCodeUnits(
        JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
      ));
      next.set(node.node_id, digestColor({
        previous_color: colors.get(node.node_id), edges, incidences
      }));
    }
    if (carrier.nodes.every((node) => next.get(node.node_id) === colors.get(node.node_id))) {
      return { refined: next, rounds };
    }
    const oldPartition = partitionSignature(colors);
    const newPartition = partitionSignature(next);
    colors = next;
    if (oldPartition === newPartition) return { refined: colors, rounds: rounds + 1 };
  }
  return { refined: colors, rounds };
}

function refineColors(carrier) {
  const initial = new Map(carrier.nodes.map((node) =>
    [node.node_id, initialNodeColor(node)]));
  return { initial, ...refineWithInitial(carrier, initial) };
}

function partitionSignature(colors) {
  const ids = [...colors.keys()];
  return ids.map((left, leftIndex) => ids.slice(leftIndex + 1).map((right) =>
    colors.get(left) === colors.get(right) ? "1" : "0").join("")).join("|");
}

function groupsFor(carrier, colors) {
  const groups = new Map();
  for (const node of carrier.nodes) {
    const color = colors.get(node.node_id);
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(node.node_id);
  }
  return [...groups.entries()].sort(([left], [right]) => compareCodeUnits(left, right));
}

function *permutations(values) {
  if (values.length <= 1) {
    yield [...values];
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) yield [values[index], ...suffix];
  }
}

function permutationCountWithinBudget(size, budget) {
  let count = 1;
  for (let factor = 2; factor <= size; factor += 1) {
    if (count > Math.floor(budget / factor)) return null;
    count *= factor;
  }
  return count;
}

function participantWithAnonymousId(participant, ids) {
  return {
    role: participant.role,
    anonymous_node_id: ids.get(participant.node_id),
    position_path: participant.position_path,
    multiplicity: participant.multiplicity,
    attributes: participant.attributes
  };
}

function anonymousPayload(carrier, order, refinement) {
  const ids = new Map(order.map((sourceId, index) => [sourceId, `n${index}`]));
  const byId = new Map(carrier.nodes.map((node) => [node.node_id, node]));
  const nodes = order.map((sourceId) => {
    const node = byId.get(sourceId);
    return {
      anonymous_node_id: ids.get(sourceId),
      node_kind: node.node_kind,
      subtype: node.subtype,
      state: node.state,
      facets: [...node.facets].sort(compareCodeUnits),
      weight: node.weight,
      initial_color: refinement.initial.get(sourceId),
      refined_color: refinement.refined.get(sourceId)
    };
  });
  const binaryEdges = carrier.binary_edges.map((edge) => ({
    edge_kind: edge.edge_kind,
    source_anonymous_node_id: ids.get(edge.source_node_id),
    target_anonymous_node_id: ids.get(edge.target_node_id),
    state: edge.state,
    effect: edge.effect,
    facet: edge.facet,
    derivation_class: edge.derivation.rule_id
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
  const incidencesWithSource = carrier.typed_incidences.map((incidence) => ({
    source_incidence_id: incidence.incidence_id,
    value: {
      incidence_kind: incidence.incidence_kind,
      state: incidence.state,
      effect: incidence.effect,
      facet: incidence.facet,
      derivation_class: incidence.derivation.rule_id,
      typed_attributes: incidence.typed_attributes,
      participants: incidence.participants.map((participant) =>
        participantWithAnonymousId(participant, ids)).sort((left, right) =>
        compareCodeUnits(JSON.stringify(canonicalValue(left)),
          JSON.stringify(canonicalValue(right))))
    }
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left.value)), JSON.stringify(canonicalValue(right.value))
  ));
  const incidenceIndex = new Map(incidencesWithSource.map((entry, index) =>
    [entry.source_incidence_id, index]));
  const constraints = carrier.constraints.map((constraint) => ({
    constraint_kind: constraint.constraint_kind,
    facet: constraint.facet,
    state: constraint.state,
    effect: constraint.normalized_effect,
    derivation_class: constraint.derivation.rule_id,
    incidence_indices: constraint.incidence_ids.map((id) => incidenceIndex.get(id))
      .sort((left, right) => left - right)
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
  const unresolvedFacts = carrier.unresolved_facts.map((fact) => ({
    state: fact.state,
    classification: fact.classification,
    subject_anonymous_node_ids: fact.subject_node_ids.map((id) => ids.get(id))
      .sort(compareCodeUnits),
    blocks: [...fact.blocks].sort(compareCodeUnits),
    only_permitted_effects: fact.only_permitted_effects
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
  return {
    nodes,
    binary_edges: binaryEdges,
    typed_incidences: incidencesWithSource.map(({ value }) => value),
    constraints,
    unresolved_facts: unresolvedFacts
  };
}

function canonicalOrder(carrier, refinement) {
  const groups = groupsFor(carrier, refinement.refined);
  const individualizedGroups = groups.flatMap(([color, members]) => {
    if (members.length <= 1) return [[color, members]];
    const keyed = members.map((member) => {
      const initial = new Map(refinement.refined);
      initial.set(member, digestColor({ individualized: true, base_color: color }));
      const individualized = refineWithInitial(carrier, initial).refined;
      const fingerprint = JSON.stringify({
        individualized_color: individualized.get(member),
        color_multiset: [...individualized.values()].sort(compareCodeUnits)
      });
      return { member, fingerprint };
    }).sort((left, right) => compareCodeUnits(left.fingerprint, right.fingerprint));
    const split = [];
    for (const entry of keyed) {
      const prior = split.at(-1);
      if (prior?.fingerprint === entry.fingerprint) prior.members.push(entry.member);
      else split.push({ fingerprint: entry.fingerprint, members: [entry.member] });
    }
    return split.map((entry, index) => [`${color}:${index}`, entry.members]);
  });
  const baseOrder = individualizedGroups.flatMap(([, members]) => members);
  const baseEncoding = JSON.stringify(canonicalValue(
    anonymousPayload(carrier, baseOrder, refinement)
  ));
  const searchGroups = individualizedGroups.map(([color, members]) => {
    if (members.length <= 1) return [color, members, true];
    const firstIndex = baseOrder.indexOf(members[0]);
    const exchangeable = members.slice(1).every((member) => {
      const candidate = [...baseOrder];
      const otherIndex = candidate.indexOf(member);
      [candidate[firstIndex], candidate[otherIndex]] =
        [candidate[otherIndex], candidate[firstIndex]];
      return JSON.stringify(canonicalValue(
        anonymousPayload(carrier, candidate, refinement)
      )) === baseEncoding;
    });
    return [color, members, exchangeable];
  });
  let order = [...baseOrder];
  let searchSpace = 1;
  for (const [, members, exchangeable] of searchGroups) {
    if (exchangeable) continue;
    const remaining = UNIT2_CANONICAL_HANDOFF_STATE_BOUND - searchSpace;
    const permutationCount = permutationCountWithinBudget(members.length, remaining);
    if (permutationCount === null) {
      const error = new RangeError(
        "Unit 2 cannot exhaust this anonymous labeling orbit within its handoff bound"
      );
      error.code = "PA_ANONYMIZATION_REFINEMENT_REQUIRES_UNIT3";
      throw error;
    }
    const indexes = members.map((member) => order.indexOf(member));
    let bestEncoding = null;
    let bestPermutation = null;
    let examined = 0;
    for (const permutation of permutations(members)) {
      examined += 1;
      const candidate = [...order];
      indexes.forEach((index, position) => {
        candidate[index] = permutation[position];
      });
      const encoded = JSON.stringify(canonicalValue(
        anonymousPayload(carrier, candidate, refinement)
      ));
      if (bestEncoding === null || compareCodeUnits(encoded, bestEncoding) < 0) {
        bestEncoding = encoded;
        bestPermutation = [...permutation];
      }
    }
    indexes.forEach((index, position) => {
      order[index] = bestPermutation[position];
    });
    searchSpace += examined;
  }
  return { order, searchSpace, groups };
}

function anonymizeResolvedCarrier(carrier) {
  const validation = validateResolvedCarrier(carrier);
  if (!validation.valid || carrier.carrier_version !== CARRIER_VERSION) {
    const error = new TypeError("cannot anonymize an invalid resolved carrier");
    error.code = "PA_INVALID_INPUT";
    throw error;
  }
  const snapshot = structuredClone(carrier);
  const refinement = refineColors(snapshot);
  const canonical = canonicalOrder(snapshot, refinement);
  const payload = anonymousPayload(snapshot, canonical.order, refinement);
  const colorClasses = canonical.groups.map(([color, members], colorClassIndex) => ({
    color_class_index: colorClassIndex,
    initial_or_refined_color: color,
    anonymous_node_ids: members.map((id) => `n${canonical.order.indexOf(id)}`)
      .sort(compareCodeUnits),
    unresolved_symmetry: members.length > 1
  }));
  const counts = {
    nodes: payload.nodes.length,
    binary_edges: payload.binary_edges.length,
    incidence_participants: payload.typed_incidences.reduce((sum, incidence) =>
      sum + incidence.participants.length, 0),
    constraints: payload.constraints.length,
    unresolved_facts: payload.unresolved_facts.length,
    refinement_color_classes: colorClasses.length
  };
  const anonymousWithoutDigest = {
    carrier_version: ANONYMOUS_VERSION,
    identifier_renaming_invariant: true,
    canonical_order: "exact_typed_graph_form_without_lexical_source_ids.v1",
    stripped_fields: ["prose", "paths", "symbols", "domain_labels",
      "source_names", "contract_identifiers", "pack_profile_guarantee_intent_names",
      "caller_identifiers", "lexical_source_identifiers"],
    authority: {
      kind: "non_authoritative_anonymous_planning_handoff",
      authoritative: false,
      mandatory_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
    },
    counts,
    ...payload
  };
  const anonymousCarrier = {
    ...anonymousWithoutDigest,
    candidate_digest: domainSeparatedDigest(ANONYMOUS_DOMAIN, anonymousWithoutDigest)
  };
  const orbitInput = {
    orbit_input_version: ORBIT_INPUT_VERSION,
    anonymous_candidate_digest: anonymousCarrier.candidate_digest,
    refinement_rounds: refinement.rounds,
    canonical_label_search_performed: true,
    canonical_label_search_states: canonical.searchSpace,
    partition_selected: false,
    lexical_source_ids_used: false,
    color_classes: colorClasses,
    nodes: payload.nodes.map(({ anonymous_node_id: anonymousNodeId,
      initial_color: initialColor, refined_color: refinedColor }) => ({
      anonymous_node_id: anonymousNodeId,
      initial_color: initialColor,
      refined_color: refinedColor
    })),
    binary_edges: payload.binary_edges,
    typed_incidences: payload.typed_incidences,
    constraints: payload.constraints,
    authority: {
      kind: "non_authoritative_unit3_refinement_input",
      authoritative: false,
      mandatory_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
    }
  };
  return deepFreeze({
    anonymous_carrier: anonymousCarrier,
    orbit_input: orbitInput
  });
}

export {
  ANONYMOUS_DOMAIN,
  ANONYMOUS_VERSION,
  ORBIT_INPUT_VERSION,
  anonymizeResolvedCarrier
};
