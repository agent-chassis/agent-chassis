

function requireCallable(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

export async function delegateToHostWriteAuthority({
  invoke,
  onThrew,
  onMissingResult
} = {}) {
  requireCallable(invoke, "invoke");
  requireCallable(onThrew, "onThrew");
  requireCallable(onMissingResult, "onMissingResult");

  let result;
  try {
    result = await invoke();
  } catch (err) {
    return onThrew(err);
  }
  if (!result || typeof result !== "object") {
    return onMissingResult();
  }
  return result;
}

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
