import { AsyncLocalStorage } from "node:async_hooks";

const contexts = new AsyncLocalStorage();

export async function withAuthenticatedTestExecution(contract, operation) {

  const { assertAuthenticatedLauncherAgentSessionContract } = await import("../stdio-mcp-conduit-authority.mjs");
  return contexts.run(assertAuthenticatedLauncherAgentSessionContract(contract), operation);
}

export function authenticatedTestExecutionBackend() {
  const contract = contexts.getStore();
  if (contract === undefined) throw Object.assign(new Error("test execution requires an authenticated session context"),
    { code: "test_execution_authenticated_context_missing" });
  return contract.execution_backend;
}
