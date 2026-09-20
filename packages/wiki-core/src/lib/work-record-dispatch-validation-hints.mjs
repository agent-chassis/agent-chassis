

export function collectValidationHints({
  policy,
  parserDiagnostics,
  unit,
  selectedUnit,
  reportOnly
}) {
  const hints = [];

  for (const diagnostic of Array.isArray(parserDiagnostics) ? parserDiagnostics : []) {
    if (diagnostic.code === "stale_projection") {
      hints.push("Projection metadata is stale; refresh generated projections before launch.");
    }
  }

  if (policy?.split_recommendation?.required) {
    hints.push(policy.split_recommendation.reason);
  }

  if (unit.kind === "work_item" && selectedUnit?.kind === "slice") {
    hints.push(`Selected slice ${unit.address} is being evaluated independently of the parent tracker.`);
  }

  if (reportOnly) {
    hints.push("Compatibility/report mode is non-authoritative for worker launch.");
  }

  return [...new Set(hints)];
}
