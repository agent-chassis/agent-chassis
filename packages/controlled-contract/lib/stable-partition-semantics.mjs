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

function evaluateExactPartition({ source_population: source, parts, identity = (value) => value }) {
  requireCompleteAuthority(source);
  if (!Array.isArray(parts)) refuse(
    "stable_partition_invalid", "partition parts must be one complete closed array"
  );
  let partitionWork = parts.length;
  for (const part of parts) {
    if (!Array.isArray(part?.members)) continue;
    partitionWork += part.members.length;
    if (!Number.isSafeInteger(partitionWork)) refuse(
      "stable_partition_work_measure_invalid", "partition work must be a safe integer"
    );
  }
  assertStableSemanticWork(partitionWork, "stable_partition_work_limit_exceeded");
  const sourceByKey = new Map(source.members.map((member) => [
    stableSemanticKey(identity(member)), member
  ]));
  const assigned = new Map();
  const partIds = new Set();
  const normalizedParts = [];
  for (const [partIndex, part] of parts.entries()) {
    if (typeof part?.part_id !== "string" || !Array.isArray(part.members)) refuse(
      "stable_partition_part_invalid", "each partition part has an identity and members",
      { part_index: partIndex }
    );
    if (partIds.has(part.part_id)) refuse(
      "stable_partition_part_duplicate", "partition part identities must be unique",
      { part_id: part.part_id }
    );
    partIds.add(part.part_id);
    const local = new Set();
    const members = [];
    for (const [memberIndex, member] of part.members.entries()) {
      const key = stableSemanticKey(identity(member));
      if (local.has(key)) refuse(
        "stable_partition_member_duplicate",
        "normalized duplicate membership inside one part is forbidden",
        { part_id: part.part_id, member_index: memberIndex }
      );
      local.add(key);
      if (!sourceByKey.has(key)) refuse(
        "stable_partition_member_extra", "partition parts are closed over the source population",
        { part_id: part.part_id, member_identity: key }
      );
      if (assigned.has(key)) refuse(
        "stable_partition_overlap", "partition parts must be pairwise disjoint",
        { first_part_id: assigned.get(key), second_part_id: part.part_id,
          member_identity: key }
      );
      assigned.set(key, part.part_id);
      members.push(sourceByKey.get(key));
    }
    normalizedParts.push({
      part_id: part.part_id,
      members: members.sort((left, right) => compareCodeUnits(
        stableSemanticKey(identity(left)), stableSemanticKey(identity(right))
      ))
    });
  }
  const missing = [...sourceByKey.keys()].filter((key) => !assigned.has(key));
  if (missing.length > 0) refuse(
    "stable_partition_member_missing", "the exact union of partition parts must equal source",
    { missing_member_identities: missing.sort(compareCodeUnits) }
  );
  normalizedParts.sort((left, right) => compareCodeUnits(left.part_id, right.part_id));
  return Object.freeze({
    partition_version: "controlled-contract.exact-partition.v1",
    source_population_id: source.population_id,
    source_cardinality: source.cardinality,
    part_count: normalizedParts.length,
    parts: Object.freeze(normalizedParts.map(
      (part) => Object.freeze(canonicalizeStableValue(part))
    ))
  });
}

export { evaluateExactPartition };
