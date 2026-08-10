import Ajv2020 from "ajv/dist/2020.js";

const PARTITIONER_VERSION = "controlled-contract-anonymous-partitioner.experimental.v0.3";
const INPUT_VERSION = "controlled-contract-anonymous-planning-input.experimental.v0.1";
const POLICY_VERSION = "controlled-contract-anonymous-coarsening-policy.experimental.v0.2";
const MERGE_SIGNALS = Object.freeze([
  "write_write_overlap",
  "dependency_aligned_write_read",
  "dependency_adjacency"
]);

const opaqueId = { type: "string", minLength: 1 };

const ANONYMOUS_PLANNING_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["graph_version", "components", "dependencies", "resources", "accesses", "collections"],
  additionalProperties: false,
  properties: {
    graph_version: { type: "string", enum: [INPUT_VERSION] },
    components: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["component_id", "weight"],
        additionalProperties: false,
        properties: {
          component_id: opaqueId,
          weight: { type: "integer", minimum: 1 }
        }
      }
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["prerequisite_component_id", "dependent_component_id"],
        additionalProperties: false,
        properties: {
          prerequisite_component_id: opaqueId,
          dependent_component_id: opaqueId
        }
      }
    },
    resources: {
      type: "array",
      items: {
        type: "object",
        required: ["resource_id"],
        additionalProperties: false,
        properties: { resource_id: opaqueId }
      }
    },
    accesses: {
      type: "array",
      items: {
        type: "object",
        required: ["component_id", "resource_id", "mode"],
        additionalProperties: false,
        properties: {
          component_id: opaqueId,
          resource_id: opaqueId,
          mode: { type: "string", enum: ["read", "write"] }
        }
      }
    },
    collections: {
      type: "array",
      items: {
        type: "object",
        required: ["collection_id", "member_component_ids"],
        additionalProperties: false,
        properties: {
          collection_id: opaqueId,
          collection_kind: {
            type: "string",
            enum: ["closed_set", "ordered_sequence"]
          },
          member_component_ids: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: opaqueId
          }
        }
      }
    }
  }
};

const ANONYMOUS_COARSENING_POLICY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "policy_version",
    "target_unit_weight",
    "max_unit_weight",
    "merge_signal_priority"
  ],
  additionalProperties: false,
  properties: {
    policy_version: { type: "string", enum: [POLICY_VERSION] },
    target_unit_weight: { type: "integer", minimum: 1 },
    max_unit_weight: { type: "integer", minimum: 1 },
    merge_signal_priority: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: MERGE_SIGNALS }
    }
  }
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateInput = ajv.compile(ANONYMOUS_PLANNING_INPUT_SCHEMA);
const validatePolicy = ajv.compile(ANONYMOUS_COARSENING_POLICY_SCHEMA);

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function duplicateValues(entries, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    const value = entry[key];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareIds);
}

function intersection(left, right) {
  const rightSet = right instanceof Set ? right : new Set(right);
  return [...left].filter((value) => rightSet.has(value)).sort(compareIds);
}

function dependencyTopology(componentIds, dependencies) {
  const outgoing = new Map(componentIds.map((id) => [id, new Set()]));
  const incoming = new Map(componentIds.map((id) => [id, new Set()]));
  for (const dependency of dependencies) {
    outgoing.get(dependency.prerequisite_component_id)
      .add(dependency.dependent_component_id);
    incoming.get(dependency.dependent_component_id)
      .add(dependency.prerequisite_component_id);
  }

  const remaining = new Map(
    [...incoming].map(([id, sources]) => [id, new Set(sources)])
  );
  const layers = [];
  const ordered = [];
  const visited = new Set();
  let frontier = componentIds.filter((id) => remaining.get(id).size === 0)
    .sort(compareIds);
  while (frontier.length > 0) {
    layers.push(frontier);
    const next = new Set();
    for (const id of frontier) {
      ordered.push(id);
      visited.add(id);
      for (const target of outgoing.get(id)) {
        remaining.get(target).delete(id);
        if (remaining.get(target).size === 0) next.add(target);
      }
    }
    frontier = [...next].filter((id) => !visited.has(id)).sort(compareIds);
  }
  const cyclicComponentIds = componentIds.filter((id) => !visited.has(id))
    .sort(compareIds);
  return {
    outgoing,
    incoming,
    ordered: cyclicComponentIds.length === 0 ? ordered : null,
    layers: cyclicComponentIds.length === 0 ? layers : null,
    cyclic_component_ids: cyclicComponentIds
  };
}

function reachability(componentIds, outgoing) {
  const reachable = new Map();
  for (const start of componentIds) {
    const found = new Set();
    const pending = [...outgoing.get(start)];
    while (pending.length > 0) {
      const current = pending.pop();
      if (found.has(current)) continue;
      found.add(current);
      pending.push(...outgoing.get(current));
    }
    reachable.set(start, found);
  }
  return reachable;
}

function validateReferences(input) {
  const diagnostics = [];
  const componentIds = new Set(input.components.map(({ component_id }) => component_id));
  const resourceIds = new Set(input.resources.map(({ resource_id }) => resource_id));
  for (const componentId of duplicateValues(input.components, "component_id")) {
    diagnostics.push({ code: "duplicate_component_id", component_id: componentId });
  }
  for (const resourceId of duplicateValues(input.resources, "resource_id")) {
    diagnostics.push({ code: "duplicate_resource_id", resource_id: resourceId });
  }
  for (const collectionId of duplicateValues(input.collections, "collection_id")) {
    diagnostics.push({ code: "duplicate_collection_id", collection_id: collectionId });
  }
  const dependencyKeys = input.dependencies.map((dependency) => ({
    key: `${dependency.prerequisite_component_id}\u0000${dependency.dependent_component_id}`
  }));
  for (const key of duplicateValues(dependencyKeys, "key")) {
    const [prerequisiteComponentId, dependentComponentId] = key.split("\u0000");
    diagnostics.push({
      code: "duplicate_dependency",
      prerequisite_component_id: prerequisiteComponentId,
      dependent_component_id: dependentComponentId
    });
  }
  const accessKeys = input.accesses.map((access) => ({
    key: `${access.component_id}\u0000${access.resource_id}\u0000${access.mode}`
  }));
  for (const key of duplicateValues(accessKeys, "key")) {
    const [componentId, resourceId, mode] = key.split("\u0000");
    diagnostics.push({
      code: "duplicate_access",
      component_id: componentId,
      resource_id: resourceId,
      mode
    });
  }
  for (const dependency of input.dependencies) {
    for (const field of ["prerequisite_component_id", "dependent_component_id"]) {
      if (!componentIds.has(dependency[field])) diagnostics.push({
        code: "dangling_dependency_component",
        field,
        component_id: dependency[field]
      });
    }
    if (dependency.prerequisite_component_id === dependency.dependent_component_id) {
      diagnostics.push({
        code: "self_dependency",
        component_id: dependency.prerequisite_component_id
      });
    }
  }
  for (const access of input.accesses) {
    if (!componentIds.has(access.component_id)) diagnostics.push({
      code: "dangling_access_component",
      component_id: access.component_id,
      resource_id: access.resource_id
    });
    if (!resourceIds.has(access.resource_id)) diagnostics.push({
      code: "dangling_access_resource",
      component_id: access.component_id,
      resource_id: access.resource_id
    });
  }
  for (const collection of input.collections) {
    for (const componentId of collection.member_component_ids) {
      if (!componentIds.has(componentId)) diagnostics.push({
        code: "dangling_collection_component",
        collection_id: collection.collection_id,
        component_id: componentId
      });
    }
  }
  return diagnostics;
}

function accessMaps(input) {
  const reads = new Map(input.components.map(({ component_id }) => [component_id, new Set()]));
  const writes = new Map(input.components.map(({ component_id }) => [component_id, new Set()]));
  for (const access of input.accesses) {
    (access.mode === "read" ? reads : writes)
      .get(access.component_id)
      .add(access.resource_id);
  }
  return { reads, writes };
}

function collectionMaps(input) {
  const collectionsByComponent = new Map(
    input.components.map(({ component_id }) => [component_id, new Set()])
  );
  for (const collection of input.collections) {
    for (const componentId of new Set(collection.member_component_ids)) {
      collectionsByComponent.get(componentId).add(collection.collection_id);
    }
  }
  return collectionsByComponent;
}

function componentPairFacts(input, topology) {
  const componentIds = input.components.map(({ component_id }) => component_id)
    .sort(compareIds);
  const { reads, writes } = accessMaps(input);
  const collectionsByComponent = collectionMaps(input);
  const reachable = reachability(componentIds, topology.outgoing);
  const directEdges = new Set(input.dependencies.map((dependency) =>
    `${dependency.prerequisite_component_id}\u0000${dependency.dependent_component_id}`
  ));
  const facts = [];
  for (let leftIndex = 0; leftIndex < componentIds.length; leftIndex += 1) {
    const left = componentIds[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < componentIds.length; rightIndex += 1) {
      const right = componentIds[rightIndex];
      const leftWritesRightReads = intersection(writes.get(left), reads.get(right));
      const rightWritesLeftReads = intersection(writes.get(right), reads.get(left));
      const sharedWrites = intersection(writes.get(left), writes.get(right));
      const sharedReads = intersection(reads.get(left), reads.get(right));
      const sharedCollections = intersection(
        collectionsByComponent.get(left),
        collectionsByComponent.get(right)
      );
      const leftBeforeRight = reachable.get(left).has(right);
      const rightBeforeLeft = reachable.get(right).has(left);
      const directlyAdjacent = directEdges.has(`${left}\u0000${right}`) ||
        directEdges.has(`${right}\u0000${left}`);
      if (
        sharedWrites.length === 0 && sharedReads.length === 0 &&
        leftWritesRightReads.length === 0 && rightWritesLeftReads.length === 0 &&
        sharedCollections.length === 0 && !directlyAdjacent
      ) continue;
      facts.push({
        left_component_id: left,
        right_component_id: right,
        shared_write_resource_ids: sharedWrites,
        shared_read_resource_ids: sharedReads,
        left_writes_right_reads_resource_ids: leftWritesRightReads,
        right_writes_left_reads_resource_ids: rightWritesLeftReads,
        shared_collection_ids: sharedCollections,
        dependency: {
          directly_adjacent: directlyAdjacent,
          left_precedes_right: leftBeforeRight,
          right_precedes_left: rightBeforeLeft
        },
        aligned_write_read_resource_ids: [
          ...(leftBeforeRight ? leftWritesRightReads : []),
          ...(rightBeforeLeft ? rightWritesLeftReads : [])
        ].sort(compareIds),
        unexplained_write_read_resource_ids: [
          ...(!leftBeforeRight && !rightBeforeLeft ? leftWritesRightReads : []),
          ...(!leftBeforeRight && !rightBeforeLeft ? rightWritesLeftReads : [])
        ].sort(compareIds),
        direction_conflict_resource_ids: [
          ...(rightBeforeLeft ? leftWritesRightReads : []),
          ...(leftBeforeRight ? rightWritesLeftReads : [])
        ].sort(compareIds)
      });
    }
  }
  return facts;
}

function unitFacts(unit, context) {
  const reads = new Set();
  const writes = new Set();
  const collections = new Set();
  let weight = 0;
  for (const componentId of unit.member_component_ids) {
    weight += context.weightByComponent.get(componentId);
    for (const id of context.reads.get(componentId)) reads.add(id);
    for (const id of context.writes.get(componentId)) writes.add(id);
    for (const id of context.collectionsByComponent.get(componentId)) collections.add(id);
  }
  return { weight, reads, writes, collections };
}

function unitDependencyFacts(left, right, context) {
  let leftBeforeRight = false;
  let rightBeforeLeft = false;
  let directlyAdjacent = false;
  let directEdgeCount = 0;
  for (const leftMember of left.member_component_ids) {
    for (const rightMember of right.member_component_ids) {
      if (context.reachable.get(leftMember).has(rightMember)) leftBeforeRight = true;
      if (context.reachable.get(rightMember).has(leftMember)) rightBeforeLeft = true;
      if (
        context.directEdges.has(`${leftMember}\u0000${rightMember}`) ||
        context.directEdges.has(`${rightMember}\u0000${leftMember}`)
      ) {
        directlyAdjacent = true;
        directEdgeCount += 1;
      }
    }
  }
  return { leftBeforeRight, rightBeforeLeft, directlyAdjacent, directEdgeCount };
}

function candidateFor(left, right, context, policy) {
  const leftFacts = unitFacts(left, context);
  const rightFacts = unitFacts(right, context);
  const dependency = unitDependencyFacts(left, right, context);
  const leftWritesRightReads = intersection(leftFacts.writes, rightFacts.reads);
  const rightWritesLeftReads = intersection(rightFacts.writes, leftFacts.reads);
  const signalCounts = {
    write_write_overlap: intersection(leftFacts.writes, rightFacts.writes).length,
    dependency_aligned_write_read:
      (dependency.leftBeforeRight ? leftWritesRightReads.length : 0) +
      (dependency.rightBeforeLeft ? rightWritesLeftReads.length : 0),
    dependency_adjacency: dependency.directlyAdjacent ? 1 : 0,
    shared_collection: intersection(leftFacts.collections, rightFacts.collections).length
  };
  const signalVector = policy.merge_signal_priority.map((signal) => signalCounts[signal]);
  if (signalVector.every((count) => count === 0)) return null;
  const criticalPathRank = Math.max(
    ...left.member_component_ids.map((id) => context.criticalPathRank.get(id)),
    ...right.member_component_ids.map((id) => context.criticalPathRank.get(id))
  );
  return {
    left,
    right,
    combined_weight: leftFacts.weight + rightFacts.weight,
    signal_counts: signalCounts,
    signal_vector: signalVector,
    hierarchy_score: [
      ...signalVector,
      dependency.directEdgeCount,
      -(leftFacts.weight + rightFacts.weight),
      -Math.abs(leftFacts.weight - rightFacts.weight),
      criticalPathRank
    ]
  };
}

function compareVectors(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function quotientForUnits(units, dependencies) {
  const unitByComponent = new Map();
  units.forEach((unit, index) => {
    for (const componentId of unit.member_component_ids) unitByComponent.set(componentId, index);
  });
  const pairSet = new Set();
  for (const dependency of dependencies) {
    const source = unitByComponent.get(dependency.prerequisite_component_id);
    const target = unitByComponent.get(dependency.dependent_component_id);
    if (source === target) continue;
    pairSet.add(`${source}\u0000${target}`);
  }
  const ids = units.map((_, index) => String(index));
  const arcs = [...pairSet].map((pair) => {
    const [source, target] = pair.split("\u0000");
    return {
      prerequisite_component_id: source,
      dependent_component_id: target
    };
  });
  return dependencyTopology(ids, arcs);
}

function clusterMergesWouldCycle(units, clusters, dependencies) {
  return quotientForUnits(replaceClusters(units, clusters), dependencies)
    .cyclic_component_ids.length > 0;
}

function orderedSequenceViolations(cluster, context) {
  const mergedMembers = new Set(
    cluster.flatMap(({ member_component_ids }) => member_component_ids)
  );
  return context.orderedSequences.flatMap((sequence) => {
    const includedIndexes = sequence.member_component_ids
      .map((componentId, index) => mergedMembers.has(componentId) ? index : null)
      .filter((index) => index !== null);
    if (includedIndexes.length < 2) return [];
    const first = Math.min(...includedIndexes);
    const last = Math.max(...includedIndexes);
    if (last - first + 1 === includedIndexes.length) return [];
    return [{
      collection_id: sequence.collection_id,
      included_member_indexes: includedIndexes
    }];
  });
}

function criticalPathRanks(componentIds, topology, weightByComponent) {
  const ranks = new Map(componentIds.map((id) => [id, weightByComponent.get(id)]));
  for (const id of [...topology.ordered].reverse()) {
    const successorRanks = [...topology.outgoing.get(id)].map((target) => ranks.get(target));
    ranks.set(id, weightByComponent.get(id) + Math.max(0, ...successorRanks));
  }
  return ranks;
}

function equalVector(left, right) {
  return compareVectors(left, right) === 0;
}

function candidateTiers(candidates) {
  const remaining = [...candidates];
  const tiers = [];
  while (remaining.length > 0) {
    let best = remaining[0].hierarchy_score;
    for (const candidate of remaining.slice(1)) {
      if (compareVectors(candidate.hierarchy_score, best) > 0) {
        best = candidate.hierarchy_score;
      }
    }
    const tier = remaining.filter((candidate) =>
      equalVector(candidate.hierarchy_score, best)
    );
    tiers.push(tier);
    const tierSet = new Set(tier);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (tierSet.has(remaining[index])) remaining.splice(index, 1);
    }
  }
  return tiers;
}

function candidateClusters(candidates) {
  const adjacent = new Map();
  for (const candidate of candidates) {
    for (const [from, to] of [
      [candidate.left, candidate.right],
      [candidate.right, candidate.left]
    ]) {
      const neighbors = adjacent.get(from) ?? new Set();
      neighbors.add(to);
      adjacent.set(from, neighbors);
    }
  }
  const clusters = [];
  const seen = new Set();
  for (const start of adjacent.keys()) {
    if (seen.has(start)) continue;
    const members = [];
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      members.push(current);
      pending.push(...(adjacent.get(current) ?? []));
    }
    clusters.push(members);
  }
  return clusters;
}

function mergeCluster(cluster) {
  return {
    children: cluster,
    member_component_ids: cluster
      .flatMap(({ member_component_ids }) => member_component_ids)
      .sort(compareIds)
  };
}

function replaceClusters(units, clusters) {
  const consumed = new Set(clusters.flat());
  return [
    ...units.filter((unit) => !consumed.has(unit)),
    ...clusters.map(mergeCluster)
  ];
}

function unitCriticalPathWeight(unit, context) {
  const members = new Set(unit.member_component_ids);
  const ranks = new Map();
  for (const componentId of [...context.topologicalOrder].reverse()) {
    if (!members.has(componentId)) continue;
    const successorRanks = [...context.outgoing.get(componentId)]
      .filter((target) => members.has(target))
      .map((target) => ranks.get(target));
    ranks.set(
      componentId,
      context.weightByComponent.get(componentId) + Math.max(0, ...successorRanks)
    );
  }
  return Math.max(0, ...ranks.values());
}

function partitionCost(units, context, targetWeight) {
  const deviations = units.map((unit) =>
    Math.abs(unitFacts(unit, context).weight - targetWeight)
  );
  return {
    serialization_loss_sum: units.reduce((sum, unit) =>
      sum + unitFacts(unit, context).weight - unitCriticalPathWeight(unit, context),
    0),
    maximum_deviation: Math.max(0, ...deviations),
    squared_deviation_sum: deviations.reduce(
      (sum, deviation) => sum + (deviation * deviation),
      0
    ),
    weight_signature: units
      .map((unit) => unitFacts(unit, context).weight)
      .sort((left, right) => left - right)
  };
}

function comparePartitionCost(left, right) {
  if (left.serialization_loss_sum !== right.serialization_loss_sum) {
    return left.serialization_loss_sum - right.serialization_loss_sum;
  }
  if (left.maximum_deviation !== right.maximum_deviation) {
    return left.maximum_deviation - right.maximum_deviation;
  }
  if (left.squared_deviation_sum !== right.squared_deviation_sum) {
    return left.squared_deviation_sum - right.squared_deviation_sum;
  }
  for (
    let index = 0;
    index < Math.min(left.weight_signature.length, right.weight_signature.length);
    index += 1
  ) {
    if (left.weight_signature[index] !== right.weight_signature[index]) {
      return left.weight_signature[index] - right.weight_signature[index];
    }
  }
  return left.weight_signature.length - right.weight_signature.length;
}

function retainBetterPartition(options, count, units, context, targetWeight) {
  const candidate = {
    units,
    cost: partitionCost(units, context, targetWeight)
  };
  const current = options.get(count);
  if (!current || comparePartitionCost(candidate.cost, current.cost) < 0) {
    options.set(count, candidate);
  }
}

function combinePartitionOptions(left, right, context, targetWeight) {
  const combined = new Map();
  for (const [leftCount, leftOption] of left) {
    for (const [rightCount, rightOption] of right) {
      const units = [...leftOption.units, ...rightOption.units];
      retainBetterPartition(
        combined,
        leftCount + rightCount,
        units,
        context,
        targetWeight
      );
    }
  }
  return combined;
}

function hierarchyPartitionOptions(unit, context, policy) {
  const options = new Map();
  if (unitFacts(unit, context).weight <= policy.max_unit_weight) {
    retainBetterPartition(options, 1, [unit], context, policy.target_unit_weight);
  }
  if (!unit.children) {
    if (options.size === 0) {
      retainBetterPartition(options, 1, [unit], context, policy.target_unit_weight);
    }
    return options;
  }
  let childOptions = new Map([[0, {
    units: [],
    cost: partitionCost([], context, policy.target_unit_weight)
  }]]);
  for (const child of unit.children) {
    childOptions = combinePartitionOptions(
      childOptions,
      hierarchyPartitionOptions(child, context, policy),
      context,
      policy.target_unit_weight
    );
  }
  for (const [count, option] of childOptions) {
    retainBetterPartition(
      options,
      count,
      option.units,
      context,
      policy.target_unit_weight
    );
  }
  return options;
}

function selectHierarchyPartition(roots, context, policy) {
  let options = new Map([[0, {
    units: [],
    cost: partitionCost([], context, policy.target_unit_weight)
  }]]);
  for (const root of roots) {
    options = combinePartitionOptions(
      options,
      hierarchyPartitionOptions(root, context, policy),
      context,
      policy.target_unit_weight
    );
  }
  const desiredCount = roots.reduce((sum, root) =>
    sum + Math.ceil(unitFacts(root, context).weight / policy.target_unit_weight),
  0);
  const availableCounts = [...options.keys()].sort((left, right) => left - right);
  const selectedCount = availableCounts.reduce((best, count) => {
    const distance = Math.abs(count - desiredCount);
    const bestDistance = Math.abs(best - desiredCount);
    if (distance !== bestDistance) return distance < bestDistance ? count : best;
    const comparison = comparePartitionCost(options.get(count).cost, options.get(best).cost);
    return comparison < 0 ? count : best;
  }, availableCounts[0]);
  return {
    desired_unit_count: desiredCount,
    selected_unit_count: selectedCount,
    available_unit_counts: availableCounts,
    selected_cost: options.get(selectedCount).cost,
    units: options.get(selectedCount).units
  };
}

function hierarchyMergeFacts(cluster, context, candidates) {
  const clusterSet = new Set(cluster);
  const supporting = candidates.filter(({ left, right }) =>
    clusterSet.has(left) && clusterSet.has(right)
  );
  const signalCounts = Object.fromEntries(
    ["write_write_overlap", "dependency_aligned_write_read", "dependency_adjacency"]
      .map((signal) => [signal, supporting.reduce(
        (sum, candidate) => sum + candidate.signal_counts[signal],
        0
      )])
  );
  return {
    child_member_component_ids: cluster.map(({ member_component_ids }) =>
      [...member_component_ids].sort(compareIds)
    ),
    combined_member_component_ids: cluster
      .flatMap(({ member_component_ids }) => member_component_ids)
      .sort(compareIds),
    combined_weight: cluster.reduce(
      (sum, unit) => sum + unitFacts(unit, context).weight,
      0
    ),
    signal_counts: signalCounts,
    hierarchy_score: supporting[0]?.hierarchy_score ?? []
  };
}

function finalizeUnits(units, context) {
  return units
    .map((unit) => ({
      member_component_ids: [...unit.member_component_ids].sort(compareIds),
      weight: unitFacts(unit, context).weight
    }))
    .sort((left, right) => compareIds(
      left.member_component_ids.join("\u0000"),
      right.member_component_ids.join("\u0000")
    ))
    .map((unit, index) => ({
      unit_id: `unit-${String(index + 1).padStart(3, "0")}`,
      ...unit
    }));
}

function planAnonymousStructuralCoarsening(input, policy) {
  if (!validateInput(input)) return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: false,
    policy_valid: null,
    schema_errors: structuredClone(validateInput.errors),
    facts: null,
    diagnostics: [{ code: "anonymous_planning_input_schema_invalid" }]
  };
  if (!validatePolicy(policy)) return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: true,
    policy_valid: false,
    schema_errors: structuredClone(validatePolicy.errors),
    facts: null,
    diagnostics: [{ code: "anonymous_coarsening_policy_schema_invalid" }]
  };
  if (policy.target_unit_weight > policy.max_unit_weight) return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: true,
    policy_valid: false,
    schema_errors: [],
    facts: null,
    diagnostics: [{ code: "target_unit_weight_exceeds_max_unit_weight" }]
  };

  const diagnostics = validateReferences(input);
  if (diagnostics.length > 0) return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: false,
    policy_valid: true,
    schema_errors: [],
    facts: null,
    diagnostics
  };

  const componentIds = input.components.map(({ component_id }) => component_id)
    .sort(compareIds);
  const topology = dependencyTopology(componentIds, input.dependencies);
  if (topology.cyclic_component_ids.length > 0) return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: false,
    policy_valid: true,
    schema_errors: [],
    facts: null,
    diagnostics: [{
      code: "anonymous_dependency_cycle",
      component_ids: topology.cyclic_component_ids
    }]
  };

  const { reads, writes } = accessMaps(input);
  const collectionsByComponent = collectionMaps(input);
  const weightByComponent = new Map(
    input.components.map(({ component_id, weight }) => [component_id, weight])
  );
  const context = {
    reads,
    writes,
    collectionsByComponent,
    orderedSequences: input.collections.filter(
      ({ collection_kind }) => collection_kind === "ordered_sequence"
    ),
    topologicalOrder: topology.ordered,
    outgoing: topology.outgoing,
    reachable: reachability(componentIds, topology.outgoing),
    directEdges: new Set(input.dependencies.map((dependency) =>
      `${dependency.prerequisite_component_id}\u0000${dependency.dependent_component_id}`
    )),
    weightByComponent,
    criticalPathRank: criticalPathRanks(componentIds, topology, weightByComponent)
  };
  let hierarchyUnits = componentIds.map((componentId) => ({
    member_component_ids: [componentId]
  }));
  const hierarchyRounds = [];
  const hierarchyCycleBlocks = [];
  const hierarchyOrderBlocks = [];

  while (true) {
    const candidates = [];
    for (let leftIndex = 0; leftIndex < hierarchyUnits.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < hierarchyUnits.length;
        rightIndex += 1
      ) {
        const candidate = candidateFor(
          hierarchyUnits[leftIndex],
          hierarchyUnits[rightIndex],
          context,
          policy
        );
        if (!candidate) continue;
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0) break;

    let selectedClusters = null;
    let selectedCandidates = null;
    for (const tier of candidateTiers(candidates)) {
      const clusters = candidateClusters(tier);
      const orderSafeClusters = [];
      for (const cluster of clusters) {
        const violations = orderedSequenceViolations(cluster, context);
        if (violations.length === 0) {
          orderSafeClusters.push(cluster);
          continue;
        }
        hierarchyOrderBlocks.push({
          ...hierarchyMergeFacts(cluster, context, tier),
          violations
        });
      }
      if (orderSafeClusters.length === 0) continue;
      if (clusterMergesWouldCycle(
        hierarchyUnits,
        orderSafeClusters,
        input.dependencies
      )) {
        hierarchyCycleBlocks.push(...orderSafeClusters.map((cluster) =>
          hierarchyMergeFacts(cluster, context, tier)
        ));
        continue;
      }
      selectedClusters = orderSafeClusters;
      selectedCandidates = tier;
      break;
    }
    if (!selectedClusters) break;
    hierarchyRounds.push({
      round: hierarchyRounds.length + 1,
      merges: selectedClusters.map((cluster) =>
        hierarchyMergeFacts(cluster, context, selectedCandidates)
      )
    });
    hierarchyUnits = replaceClusters(hierarchyUnits, selectedClusters);
  }

  const hierarchyPartition = selectHierarchyPartition(
    hierarchyUnits,
    context,
    policy
  );
  const units = hierarchyPartition.units;

  const finalUnits = finalizeUnits(units, context);
  const finalUnitByComponent = new Map();
  for (const unit of finalUnits) {
    for (const componentId of unit.member_component_ids) {
      finalUnitByComponent.set(componentId, unit.unit_id);
    }
  }
  const quotientPairs = new Map();
  for (const dependency of input.dependencies) {
    const prerequisiteUnitId = finalUnitByComponent.get(
      dependency.prerequisite_component_id
    );
    const dependentUnitId = finalUnitByComponent.get(dependency.dependent_component_id);
    if (prerequisiteUnitId === dependentUnitId) continue;
    const key = `${prerequisiteUnitId}\u0000${dependentUnitId}`;
    const current = quotientPairs.get(key) ?? {
      prerequisite_unit_id: prerequisiteUnitId,
      dependent_unit_id: dependentUnitId,
      source_dependency_count: 0
    };
    current.source_dependency_count += 1;
    quotientPairs.set(key, current);
  }
  const quotientArcs = [...quotientPairs.values()].sort((left, right) => compareIds(
    `${left.prerequisite_unit_id}\u0000${left.dependent_unit_id}`,
    `${right.prerequisite_unit_id}\u0000${right.dependent_unit_id}`
  ));
  const quotientTopology = dependencyTopology(
    finalUnits.map(({ unit_id }) => unit_id),
    quotientArcs.map((arc) => ({
      prerequisite_component_id: arc.prerequisite_unit_id,
      dependent_component_id: arc.dependent_unit_id
    }))
  );

  const hierarchyMerges = hierarchyRounds.flatMap(({ round, merges }) =>
    merges.map((merge) => ({ round, ...merge }))
  );
  const targetCutMerges = hierarchyMerges.filter(
    ({ combined_weight }) => combined_weight > policy.target_unit_weight
  );
  const oversizedComponentIds = input.components
    .filter(({ weight }) => weight > policy.max_unit_weight)
    .map(({ component_id }) => component_id)
    .sort(compareIds);
  const totalWeight = finalUnits.reduce((sum, { weight }) => sum + weight, 0);
  const meanUnitWeight = totalWeight / finalUnits.length;
  const finalUnitWeights = new Map(
    finalUnits.map(({ unit_id, weight }) => [unit_id, weight])
  );
  const quotientCriticalRanks = criticalPathRanks(
    finalUnits.map(({ unit_id }) => unit_id),
    quotientTopology,
    finalUnitWeights
  );
  const inputCriticalPathWeight = Math.max(0, ...context.criticalPathRank.values());
  const plannedCriticalPathWeight = Math.max(0, ...quotientCriticalRanks.values());

  const pairFacts = componentPairFacts(input, topology);
  const directionConflicts = pairFacts.filter(
    ({ direction_conflict_resource_ids }) => direction_conflict_resource_ids.length > 0
  );
  const unexplainedWriteRead = pairFacts.filter(
    ({ unexplained_write_read_resource_ids }) =>
      unexplained_write_read_resource_ids.length > 0
  );

  return {
    partitioner_version: PARTITIONER_VERSION,
    authority: { kind: "advisory_local", authoritative: false },
    input_valid: true,
    policy_valid: true,
    schema_errors: [],
    facts: {
      input_component_count: componentIds.length,
      input_dependency_count: input.dependencies.length,
      input_resource_count: input.resources.length,
      input_access_count: input.accesses.length,
      input_collection_count: input.collections.length,
      component_pair_facts: pairFacts,
      direction_conflict_pair_count: directionConflicts.length,
      unexplained_write_read_pair_count: unexplainedWriteRead.length,
      algorithm: "capacity_independent_critical_path_merge_hierarchy",
      unit_count_monotone_by_construction: true,
      target_unit_weight: policy.target_unit_weight,
      max_unit_weight: policy.max_unit_weight,
      total_component_weight: totalWeight,
      target_weight_unit_lower_bound: Math.ceil(totalWeight / policy.target_unit_weight),
      input_critical_path_weight: inputCriticalPathWeight,
      planned_critical_path_weight: plannedCriticalPathWeight,
      critical_path_serialization_cost:
        plannedCriticalPathWeight - inputCriticalPathWeight,
      hierarchy_rounds: hierarchyRounds,
      hierarchy_root_count: hierarchyUnits.length,
      hierarchy_merge_count: hierarchyMerges.length,
      desired_unit_count: hierarchyPartition.desired_unit_count,
      available_hierarchy_cut_counts: hierarchyPartition.available_unit_counts,
      selected_partition_serialization_loss:
        hierarchyPartition.selected_cost.serialization_loss_sum,
      final_unit_count: finalUnits.length,
      final_units: finalUnits,
      unit_weight_balance: {
        minimum: Math.min(...finalUnits.map(({ weight }) => weight)),
        maximum: Math.max(...finalUnits.map(({ weight }) => weight)),
        mean: meanUnitWeight,
        maximum_absolute_deviation: Math.max(
          ...finalUnits.map(({ weight }) => Math.abs(weight - meanUnitWeight))
        )
      },
      quotient_dependency_arcs: quotientArcs,
      quotient_topological_layers: quotientTopology.layers,
      unresolved_merge_candidates: [],
      blocked_by_weight_count: targetCutMerges.length,
      blocked_by_weight_candidates: targetCutMerges,
      blocked_by_cycle_count: hierarchyCycleBlocks.length,
      blocked_by_cycle_candidates: hierarchyCycleBlocks,
      blocked_by_ordered_sequence_count: hierarchyOrderBlocks.length,
      blocked_by_ordered_sequence_candidates: hierarchyOrderBlocks,
      oversized_component_ids: oversizedComponentIds
    },
    diagnostics: [
      ...directionConflicts.map((pair) => ({
        code: "dependency_scope_direction_conflict",
        left_component_id: pair.left_component_id,
        right_component_id: pair.right_component_id,
        resource_ids: pair.direction_conflict_resource_ids
      })),
      ...unexplainedWriteRead.map((pair) => ({
        code: "write_read_overlap_without_dependency",
        left_component_id: pair.left_component_id,
        right_component_id: pair.right_component_id,
        resource_ids: pair.unexplained_write_read_resource_ids
      })),
      ...oversizedComponentIds.map((componentId) => ({
        code: "component_exceeds_max_unit_weight",
        component_id: componentId,
        weight: weightByComponent.get(componentId),
        max_unit_weight: policy.max_unit_weight
      })),
      ...hierarchyOrderBlocks.map((block) => ({
        code: "ordered_sequence_noncontiguous_contraction",
        member_component_ids: block.combined_member_component_ids,
        violations: block.violations
      }))
    ]
  };
}

function anonymousPlanningInputFromDecomposition(decomposition, options = {}) {
  if (!decomposition?.schema_valid || !decomposition?.facts) {
    throw new TypeError("decomposition must contain valid facts");
  }
  const accesses = options.accesses ?? [];
  const resources = [...new Set(accesses.map(({ resource_id }) => resource_id))]
    .sort(compareIds)
    .map((resourceId) => ({ resource_id: resourceId }));
  const weightByComponent = new Map(
    (options.component_weights ?? []).map(({ component_id, weight }) => [component_id, weight])
  );
  return {
    graph_version: INPUT_VERSION,
    components: decomposition.facts.components.map((component) => ({
      component_id: component.component_id,
      weight: weightByComponent.get(component.component_id) ??
        component.complexity.behavior_claim_count
    })),
    dependencies: decomposition.facts.behavior_dependency_arcs.map((arc) => ({
      prerequisite_component_id: arc.prerequisite_component_id,
      dependent_component_id: arc.dependent_component_id
    })),
    resources,
    accesses: structuredClone(accesses),
    collections: decomposition.facts.collection_overlay.attachments
      .filter(({ target_component_ids }) => target_component_ids.length > 0)
      .map((attachment) => ({
        collection_id: attachment.collection_id,
        ...(attachment.collection_kind
          ? { collection_kind: attachment.collection_kind }
          : {}),
        member_component_ids: attachment.target_component_ids
      }))
  };
}

export {
  ANONYMOUS_COARSENING_POLICY_SCHEMA,
  ANONYMOUS_PLANNING_INPUT_SCHEMA,
  INPUT_VERSION,
  MERGE_SIGNALS,
  PARTITIONER_VERSION,
  POLICY_VERSION,
  anonymousPlanningInputFromDecomposition,
  planAnonymousStructuralCoarsening,
  validateReferences as validateAnonymousPlanningInputReferences
};
