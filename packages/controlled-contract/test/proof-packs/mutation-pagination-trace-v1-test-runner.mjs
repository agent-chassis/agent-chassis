import {
  canonicalJsonBytes,
  sha256
} from "../../lib/deterministic-projection-primitives.mjs";
import {
  MUTATION_PAGINATION_TRACE_TRANSFORMER
} from "../../lib/mutation-pagination-trace-projection.mjs";

function executeMutationPaginationProjection(sourceBytes) {
  if (!Array.isArray(sourceBytes) ||
      sourceBytes.length !== MUTATION_PAGINATION_TRACE_TRANSFORMER.source_count) {
    throw new TypeError("mutation pagination projection requires its closed source tuple");
  }
  const values = MUTATION_PAGINATION_TRACE_TRANSFORMER.parse_sources(sourceBytes);
  const digests = sourceBytes.map(sha256);
  const first = canonicalJsonBytes(MUTATION_PAGINATION_TRACE_TRANSFORMER.transform(
    structuredClone(values), [...digests]
  ), { file: true });
  const second = canonicalJsonBytes(MUTATION_PAGINATION_TRACE_TRANSFORMER.transform(
    structuredClone(values), [...digests]
  ), { file: true });
  if (!first.equals(second)) throw new TypeError("mutation projection is nondeterministic");
  MUTATION_PAGINATION_TRACE_TRANSFORMER.validate_result(JSON.parse(first));
  return first;
}

function projectMutationPaginationPopulation(resultBytes, populationId) {
  const value = MUTATION_PAGINATION_TRACE_TRANSFORMER.validate_result(
    JSON.parse(resultBytes)
  );
  const projection = MUTATION_PAGINATION_TRACE_TRANSFORMER.projections[populationId];
  if (!projection) throw new TypeError(`unknown pagination population: ${populationId}`);
  return projection.project(value);
}

export {
  executeMutationPaginationProjection,
  projectMutationPaginationPopulation
};
