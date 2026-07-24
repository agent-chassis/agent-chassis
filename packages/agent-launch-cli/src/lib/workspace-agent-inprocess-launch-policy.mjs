

export function attachDispatchProvenanceToSupervisedResult(
  supervised,
  attachToFinalResult
) {
  if (
    !supervised ||
    typeof supervised !== "object" ||
    typeof supervised.probe !== "function" ||
    typeof attachToFinalResult !== "function"
  ) {
    return supervised;
  }
  const innerProbe = supervised.probe;
  return {
    ...supervised,
    probe: async () => {
      const probed = await innerProbe();
      if (
        probed &&
        typeof probed === "object" &&
        probed.final_result &&
        typeof probed.final_result === "object"
      ) {
        return {
          ...probed,
          final_result: await attachToFinalResult(probed.final_result)
        };
      }
      return probed;
    }
  };
}
