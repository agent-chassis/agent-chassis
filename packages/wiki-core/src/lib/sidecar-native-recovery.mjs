export const RETAINED_ANSWER_NEXT_ACTION =
  "The complete original answer is retained; follow next_calls, or name one of its collections " +
  "with a row id, path, symbol or relationship in detail, to read that part without evaluating " +
  "the question again.";

export function describeNativeSymbolRecovery(result, { callGraphQuery = false, resolutionState = "unresolved" } = {}) {
  const limited = Array.isArray(result?.dependency_limitations) ? result.dependency_limitations.length : 0;
  const action = [unresolvedNextAction(result, callGraphQuery, resolutionState), limited === 0 ? null
    : `Dependency resolution was incomplete for ${limited} provider project${limited === 1 ? "" : "s"} this ` +
      "answer may depend on (dependency_limitations): an absent or unresolved result there is not an " +
      "authoritative no-match. Make the reported dependencies available offline; an explicit code-index " +
      "build attempts those projects again, as does automatic preparation once their inputs change."]
    .filter(Boolean).join(" ") || null;

  return action !== null && result?.staleness === "stale"
    ? `${action} This answer describes the selected graph_snapshot checkout inputs and publication; ` +
      "a symbol added since then appears after the refresh publishes."
    : action;
}

function unresolvedNextAction(result, callGraphQuery, resolutionState) {
  if (
    result?.scip_state?.scip_available !== true ||
    result?.scip_state?.graph_available !== true ||
    (callGraphQuery && result?.scip_state?.call_graph_available === false)
  ) {
    return "Committed preparation attempts every applicable SCIP provider project and publishes what " +
      "they produce; a project whose provider is not installed, or that could not be indexed while its " +
      "dependencies were missing, is listed with its reason in " +
      "graph_snapshot.provider_coverage.inactive_projects. Provision the provider or make the " +
      "dependencies available, then prepare again. When no SCIP provider applies to the checkout " +
      "sources, symbol results stay unavailable. Status is read-only. Unsupported call " +
      "attribution is not repaired by provisioning; use definition or reference results.";
  }
  if (resolutionState === "unresolved") {
    return "Retry with an exact SCIP symbol or a repo-relative path, 1-based line, and optional character.";
  }
  return null;
}
