

import {
  STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER,
  buildManagedStdioMcpCompositionRefusal,
  isManagedStdioMcpCompositionAuthority,
  projectManagedStdioMcpCompositionAuthority
} from "./stdio-mcp-conduit-composition-compatibility.mjs";

export function createManagedStdioMcpCompositionGate({
  managedStdioMcpCompositionAuthority,
  testCompositionFact
}) {
  const resolveManagedStdioMcpComposition = () => {
    if (managedStdioMcpCompositionAuthority === null) {
      return Object.freeze({
        available: false,
        gate_outcome: "missing_fact",
        fact: null,
        blocker: buildManagedStdioMcpCompositionRefusal("missing_fact")
      });
    }
    if (!isManagedStdioMcpCompositionAuthority(managedStdioMcpCompositionAuthority)) {
      return Object.freeze({
        available: false,
        gate_outcome: "malformed_fact",
        fact: null,
        blocker: buildManagedStdioMcpCompositionRefusal("malformed_fact")
      });
    }
    return projectManagedStdioMcpCompositionAuthority(
      managedStdioMcpCompositionAuthority,
      testCompositionFact
    );
  };
  const gateManagedExecutor = (executor) => async (input) => {
    const projection = resolveManagedStdioMcpComposition();
    if (projection.available !== true) {
      return {
        accepted: false,
        refusal: {
          code: STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER,
          reason: projection.blocker.cause,
          detail: {
            cause: projection.blocker.cause,
            recovery: projection.blocker.recovery,
            gate_outcome: projection.blocker.gate_outcome
          }
        }
      };
    }
    return executor(input);
  };
  return { resolveManagedStdioMcpComposition, gateManagedExecutor };
}
