export function dropObservedTwentyFirstRelatedPath(contract) {
  const relatedPaths = [...contract.observed.complete.related_paths];
  relatedPaths.splice(20, 1);
  return {
    ...contract,
    observed: {
      ...contract.observed,
      complete: {
        ...contract.observed.complete,
        related_paths: relatedPaths
      }
    }
  };
}
