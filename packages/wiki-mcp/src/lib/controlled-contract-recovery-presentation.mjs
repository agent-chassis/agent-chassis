

export function projectControlledContractCoverageDescribeForRole(result, {
  sessionRole,
  shouldExposeTool
}) {
  if (sessionRole === null) return result;
  const visible = (tool) => shouldExposeTool(sessionRole, tool);
  return {
    ...result,
    supported_next_calls: Object.freeze(
      result.supported_next_calls.filter(visible)),
    next_calls: Object.freeze(
      result.next_calls.filter(({ tool }) => visible(tool)))
  };
}
